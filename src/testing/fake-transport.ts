import type { Transport } from "../provider/provider";

/** One step of a scripted 200 stream. */
export type Step =
  /** A chunk carrying this content delta. */
  | { content: string }
  /** A server-sent `data:` line, verbatim. */
  | { data: string }
  /** A server-sent comment line, such as a keep-alive. */
  | { comment: string }
  /** An `error` object inside the stream, as some Providers send. */
  | { error: string }
  /** Holds the stream here until the promise settles. */
  | { wait: Promise<void> }
  /** The connection drops mid-stream. */
  | { drop: true };

/** What the fake Provider answers one request with. */
export type Reply =
  /** A 200 server-sent stream of these steps, ending with `[DONE]` unless it drops. */
  | Step[]
  /** An HTTP reply; `message` arrives as `{ error: { message } }`, and `dropBody` cuts the body short. */
  | { status: number; message?: string; dropBody?: true }
  /** No response at all: the connection fails with this reason. */
  | { refuse: string };

/** A request as the fake Provider received it. */
export interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  /** The JSON body, parsed. */
  body: any;
  /** Aborted once the sender cancels the request. */
  signal: AbortSignal;
}

const encoder = new TextEncoder();

/**
 * The network edge of the webview core: a fetch-shaped transport that answers each request with
 * the next scripted reply and records what it received. A request with no reply left fails.
 */
export class FakeTransport {
  readonly requests: SentRequest[] = [];
  private readonly replies: (Reply | ((request: SentRequest) => Reply))[] = [];

  /** Queues replies, one per request in the order they arrive. */
  reply(...replies: (Reply | ((request: SentRequest) => Reply))[]): this {
    this.replies.push(...replies);
    return this;
  }

  readonly fetch: Transport = async (url, init) => {
    const signal = init.signal ?? new AbortController().signal;
    const request: SentRequest = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      signal,
    };
    this.requests.push(request);
    const next = this.replies.shift();
    if (next === undefined) throw new Error(`No reply scripted for request ${this.requests.length}: ${url}`);
    const reply = typeof next === "function" ? next(request) : next;
    signal.throwIfAborted();
    if ("refuse" in reply) throw new TypeError(reply.refuse);
    if (Array.isArray(reply)) return new Response(stream(reply, signal));
    const body = reply.message === undefined ? null : JSON.stringify({ error: { message: reply.message } });
    if (reply.dropBody) return new Response(truncated(body ?? ""), { status: reply.status });
    return new Response(body, { status: reply.status });
  };
}

/** Sends one chunk per read, so the reader has taken every chunk before a later step drops the connection. */
function stream(steps: Step[], signal: AbortSignal): ReadableStream<Uint8Array> {
  const remaining = [...steps];
  let ended = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const end = (reason?: unknown) => {
    if (ended) return;
    ended = true;
    if (reason === undefined) controller.close();
    else controller.error(reason);
  };
  signal.addEventListener("abort", () => end(signal.reason), { once: true });
  const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));
  return new ReadableStream(
    {
      start(started) {
        controller = started;
      },
      async pull() {
        while (!ended) {
          const step = remaining.shift();
          if (step === undefined) {
            send("[DONE]");
            return end();
          }
          if ("wait" in step) await step.wait;
          else if ("drop" in step) return end(new TypeError("The connection dropped."));
          else if ("content" in step) {
            return send(JSON.stringify({ choices: [{ delta: { content: step.content } }] }));
          } else if ("error" in step) return send(JSON.stringify({ error: { message: step.error } }));
          else if ("comment" in step)
            return controller.enqueue(
              encoder.encode(`: ${step.comment}

`),
            );
          else return send(step.data);
        }
      },
    },
    { highWaterMark: 0 },
  );
}

/** Sends the first half of `text`, then drops the connection. */
function truncated(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, Math.floor(text.length / 2))));
      controller.error(new TypeError("The connection dropped."));
    },
  });
}
