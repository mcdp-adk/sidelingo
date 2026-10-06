import { PRESET_REGISTRY, type Preset, type ReasoningEffort } from "./presets";
import type { ClientOptions, Proxy } from "@tauri-apps/plugin-http";

/** Where to reach a Provider over the OpenAI Chat Completions protocol. */
export interface ProviderConfiguration {
  preset: Preset;
  /** Used as entered, with or without `/v1`. */
  baseUrl: string;
  model: string;
  /** Default omits the field; explicit none remains a sent level. */
  reasoningEffort?: ReasoningEffort | null;
  key?: string | null;
  /** Absent follows the System proxy; a Manual proxy is fixed with the Round. */
  proxy?: Proxy;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string | (TextContentPart | ImageContentPart)[];
}

/** A text part in a multimodal chat message. */
export interface TextContentPart {
  type: "text";
  text: string;
}

/** A vision Input carried by the Chat Completions protocol. */
export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

/** The `fetch` the client sends through: `tauri-plugin-http`'s in the app. */
export type Transport = (url: string, init: RequestInit & ClientOptions) => Promise<Response>;

/** A cause the UI can name, with the Provider's detail preserved in message. */
export class ProviderError extends Error {
  constructor(
    readonly category: "network" | "provider-http" | "provider-error" | "empty-response",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderClient {
  /** Lists the Provider's model ids without requiring a model to be selected. */
  listModels(configuration: ProviderConfiguration, signal: AbortSignal): Promise<string[]>;
  /** Streams one chat completion's content deltas. */
  streamChat(
    configuration: ProviderConfiguration,
    messages: ChatMessage[],
    signal: AbortSignal,
  ): AsyncGenerator<string>;
}

interface ChunkChoice {
  delta?: { content?: string | null };
}

export function providerClient(transport: Transport): ProviderClient {
  return {
    async listModels(configuration, signal) {
      const response = await request(
        transport,
        `${baseOf(configuration)}/models`,
        { method: "GET", headers: keyHeaders(configuration.key), signal },
        configuration.proxy,
      );
      let document;
      try {
        document = await response.json();
      } catch (reason) {
        if (signal.aborted) throw reason;
        throw new ProviderError("empty-response", "The Provider returned an invalid model list.");
      }
      if (!Array.isArray(document?.data) || document.data.some((entry: unknown) => !isModel(entry))) {
        throw new ProviderError("empty-response", "The Provider returned an invalid model list.");
      }
      return document.data.map(({ id }: { id: string }) => id);
    },
    async *streamChat({ preset, baseUrl, model, reasoningEffort, key, proxy }, messages, signal) {
      const effortField = PRESET_REGISTRY[preset].effortField;
      const effort =
        reasoningEffort == null
          ? {}
          : { [effortField]: effortField === "reasoning" ? { effort: reasoningEffort } : reasoningEffort };
      const response = await request(
        transport,
        `${baseOf({ preset, baseUrl })}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...keyHeaders(key) },
          body: JSON.stringify({ model, messages, stream: true, ...effort }),
          signal,
        },
        proxy,
      );
      if (response.body === null) return;
      for await (const data of serverSentData(response.body, signal)) {
        if (data === "[DONE]") return;
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          throw new ProviderError("provider-error", data);
        }
        if (typeof chunk !== "object" || chunk === null || Array.isArray(chunk)) {
          throw new ProviderError("provider-error", data);
        }
        if (chunk?.error !== undefined) {
          const message = typeof chunk.error?.message === "string" ? chunk.error.message : data;
          throw new ProviderError("provider-error", message);
        }
        // Only the content counts; `reasoning_content` and `reasoning` are the model thinking aloud.
        const choices = chunk.choices ?? [];
        if (!Array.isArray(choices)) throw new ProviderError("provider-error", data);
        for (const choice of choices as ChunkChoice[]) {
          if (typeof choice !== "object" || choice === null || Array.isArray(choice)) {
            throw new ProviderError("provider-error", data);
          }
          const content = choice.delta?.content;
          if (content != null && typeof content !== "string") throw new ProviderError("provider-error", data);
          if (content) yield content;
        }
      }
    },
  };
}

function isModel(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string";
}

function keyHeaders(key: string | null | undefined): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** The shared HTTP boundary keeps both client operations' errors consistent. */
async function request(transport: Transport, url: string, init: RequestInit, proxy?: Proxy): Promise<Response> {
  let response;
  try {
    // Limit connection setup only: long reasoning and streamed responses have no total timeout.
    response = await transport(url, { ...init, connectTimeout: 10_000, ...(proxy ? { proxy } : {}) });
  } catch (reason) {
    if (init.signal?.aborted) throw reason;
    throw networkError(reason);
  }
  if (!response.ok) {
    let body;
    try {
      body = await response.text();
    } catch (reason) {
      if (init.signal?.aborted) throw reason;
      throw networkError(reason);
    }
    let message = body;
    try {
      const document = JSON.parse(body);
      if (typeof document?.error?.message === "string") message = document.error.message;
    } catch {
      // A non-JSON error body is also the Provider's verbatim detail.
    }
    throw new ProviderError("provider-http", message, response.status);
  }
  return response;
}

function networkError(reason: unknown): ProviderError {
  return new ProviderError("network", reason instanceof Error ? reason.message : String(reason));
}

function baseOf({ preset, baseUrl }: Pick<ProviderConfiguration, "preset" | "baseUrl">): string {
  return (PRESET_REGISTRY[preset].baseUrl ?? baseUrl).replace(/\/+$/, "");
}

/** The `data` of each server-sent event line, skipping comments such as `: keep-alive`. */
async function* serverSentData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  const reader = body.getReader();
  const next = async () => {
    try {
      return await reader.read();
    } catch (reason) {
      if (signal.aborted) throw reason;
      throw networkError(reason);
    }
  };
  for (let read = await next(); !read.done; read = await next()) {
    buffered += decoder.decode(read.value, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop()!;
    yield* dataOf(lines);
  }
  // A stream that ends without a final line break still ends its last line.
  yield* dataOf([buffered + decoder.decode()]);
}

function* dataOf(lines: string[]): Generator<string> {
  for (const line of lines) {
    if (line.startsWith("data:")) yield line.slice("data:".length).trim();
  }
}
