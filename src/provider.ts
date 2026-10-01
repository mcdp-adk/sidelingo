/** Where to reach a Provider over the OpenAI Chat Completions protocol. */
export interface ProviderConfiguration {
  /** Used as entered, with or without `/v1`. */
  baseUrl: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** The `fetch` the client sends through: `tauri-plugin-http`'s in the app. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface ProviderClient {
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
    async *streamChat({ baseUrl, model }, messages, signal) {
      const response = await transport(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: true }),
        signal,
      });
      if (!response.ok) {
        // Categorised errors come with #51.
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      for await (const data of serverSentData(response.body!)) {
        if (data === "[DONE]") return;
        const chunk = JSON.parse(data);
        // Only the content counts; `reasoning_content` and `reasoning` are the model thinking aloud.
        for (const choice of (chunk.choices ?? []) as ChunkChoice[]) {
          if (choice.delta?.content) yield choice.delta.content;
        }
      }
    },
  };
}

/** The `data` of each server-sent event line, skipping comments such as `: keep-alive`. */
async function* serverSentData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  const reader = body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
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
