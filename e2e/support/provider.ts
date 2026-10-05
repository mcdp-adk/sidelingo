import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

/** A request the fake Provider received, its body parsed as JSON. */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: any;
}

/** One step of a streamed reply. */
export type Step =
  /** A `choices[0].delta` chunk. */
  | { delta: { content?: string; reasoning_content?: string; reasoning?: string } }
  /** A Provider error object sent inside an HTTP 200 SSE response. */
  | { error: { message: string } }
  /** Literal SSE data, including malformed JSON from a Provider. */
  | { rawData: string }
  /** An SSE comment line, such as `keep-alive`. */
  | { comment: string }
  /** Drops the actual connection before the reply finishes. */
  | { drop: true }
  /** Holds the stream until the promise settles. */
  | { wait: Promise<unknown>; onReached?: () => void }
  /** Holds the stream like a real Provider still generating: a keep-alive comment every 250 ms until the promise settles. */
  | { keepAliveUntil: Promise<unknown> };

/** A real failed chat response, with the Provider's JSON error detail. */
export interface HttpReply {
  status: number;
  message: string;
  /** Sends all but the JSON body's last byte, holds, then drops the real connection. */
  dropAfterPartialBody?: { wait: Promise<unknown>; onReached?: () => void };
}

export type Script = Step[] | HttpReply | ((request: RecordedRequest) => Step[] | HttpReply);

export interface ModelReply {
  ids?: string[];
  status?: number;
  message?: string;
  wait?: Promise<unknown>;
}

/** Whether `request` asks for Structuring: its user message is a list of parts, where Translation's is a string. */
export const isStructuring = (request: RecordedRequest): boolean => Array.isArray(request.body.messages.at(-1).content);

/** Answers the Structuring of a copied text by keeping the text as it is, and every other request with `script`. */
export function keepingText(script: Script): (request: RecordedRequest) => Step[] | HttpReply {
  return (request) => {
    const text = isStructuring(request)
      ? request.body.messages.at(-1).content.find((part: { type: string }) => part.type === "text")?.text
      : undefined;
    if (text !== undefined) return [{ delta: { content: text } }];
    return typeof script === "function" ? script(request) : script;
  };
}

/** Keeps a copied text as its Source text, then streams back its last line, so a copied line comes back as its own translation. */
const echo: Script = keepingText(({ body }) => [
  { delta: { content: body.messages.at(-1).content.split("\n").at(-1) } },
]);

/** A local Provider speaking Chat Completions, scripted per test, recording every request. */
export class FakeProvider {
  /** Chat completions, kept separate so processing assertions exclude model-list fetches. */
  readonly requests: RecordedRequest[] = [];
  readonly modelRequests: RecordedRequest[] = [];
  /** Actual chat responses closed before the server finished sending them. */
  readonly interruptedRequests: RecordedRequest[] = [];
  private modelReply: ModelReply = {};
  private script: Script = echo;
  private readonly server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const recorded: RecordedRequest = {
      method: request.method!,
      path: request.url!,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    if (request.method === "GET" && request.url?.endsWith("/models")) {
      this.modelRequests.push(recorded);
      const reply = this.modelReply;
      if (reply.wait) await reply.wait;
      if (response.destroyed) return;
      response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          reply.message
            ? { error: { message: reply.message } }
            : { data: (reply.ids ?? ["fake-model"]).map((id) => ({ id })) },
        ),
      );
      return;
    }
    this.requests.push(recorded);
    response.once("close", () => {
      if (!response.writableFinished) this.interruptedRequests.push(recorded);
    });
    const reply = typeof this.script === "function" ? this.script(recorded) : this.script;
    if (Array.isArray(reply)) await stream(response, reply);
    else {
      const body = JSON.stringify({ error: { message: reply.message } });
      response.writeHead(reply.status, {
        "content-type": "application/json",
        ...(reply.dropAfterPartialBody && { "content-length": Buffer.byteLength(body) }),
      });
      if (reply.dropAfterPartialBody) {
        response.flushHeaders();
        await new Promise<void>((resolve) => response.write(body.slice(0, -1), () => resolve()));
        if (response.destroyed) return;
        reply.dropAfterPartialBody.onReached?.();
        await reply.dropAfterPartialBody.wait;
        response.destroy();
      } else response.end(body);
    }
  });

  /** Listens on 127.0.0.1 at `port`, or on a free port by default. */
  static async start(port = 0): Promise<FakeProvider> {
    const provider = new FakeProvider();
    provider.server.listen(port, "127.0.0.1");
    await once(provider.server, "listening");
    return provider;
  }

  /** A Base URL in the usual form, ending in `/v1`. */
  get baseUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  /** Forgets the requests so far and replies with `script` from now on, echoing without one. */
  reset(script: Script = echo): void {
    this.requests.length = 0;
    this.modelRequests.length = 0;
    this.interruptedRequests.length = 0;
    this.modelReply = {};
    this.script = script;
  }

  models(reply: ModelReply): void {
    this.modelReply = reply;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, "close");
  }
}

async function stream(response: ServerResponse, steps: Step[]) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const step of steps) {
    // The app may have cancelled the request.
    if (response.destroyed) return;
    if ("wait" in step) {
      step.onReached?.();
      await step.wait;
    } else if ("keepAliveUntil" in step) {
      let settled = false;
      void step.keepAliveUntil.then(() => (settled = true));
      while (!settled && !response.destroyed) {
        response.write(": keep-alive\n\n");
        await Promise.race([step.keepAliveUntil, new Promise((resolve) => setTimeout(resolve, 250))]);
      }
    } else if ("drop" in step) {
      response.destroy();
      return;
    } else if ("error" in step) {
      response.write(`data: ${JSON.stringify({ error: step.error })}\n\n`);
    } else if ("rawData" in step) {
      response.write(`data: ${step.rawData}\n\n`);
    } else if ("comment" in step) response.write(`: ${step.comment}\n\n`);
    else
      response.write(
        `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta: step.delta }] })}\n\n`,
      );
  }
  response.end("data: [DONE]\n\n");
}

/** A promise the test settles when it chooses, to hold a stream at a step. */
export function gate(): { wait: Promise<void>; open: () => void; reached: Promise<void>; signalReached: () => void } {
  let open!: () => void;
  let signalReached!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (signalReached = resolve));
  return { wait, open, reached, signalReached };
}
