import { describe, expect, it } from "vitest";
import { providerClient } from "./provider";
import type { Preset } from "./presets";

describe("Named Preset endpoints", () => {
  it.each<[Preset, string]>([
    ["openai", "https://api.openai.com/v1"],
    ["openrouter", "https://openrouter.ai/api/v1"],
    ["deepseek", "https://api.deepseek.com"],
    ["ollama-cloud", "https://ollama.com/v1"],
  ])("sends %s chat completions and model lists to its fixed Base URL", async (preset, base) => {
    const calls: { url: string; method: string | undefined }[] = [];
    const client = providerClient(async (url, { method }) => {
      calls.push({ url, method });
      return url.endsWith("/models") ? new Response(JSON.stringify({ data: [] })) : new Response("data: [DONE]\n\n");
    });
    const configuration = { preset, baseUrl: "https://ignored.invalid", model: "model" };
    const signal = new AbortController().signal;
    const completion = client.streamChat(configuration, [{ role: "user", content: "hello" }], signal);
    while (!(await completion.next()).done) {
      /* Consume through the real public client interface. */
    }
    await client.listModels(configuration, signal);
    expect(calls).toEqual([
      { method: "POST", url: `${base}/chat/completions` },
      { method: "GET", url: `${base}/models` },
    ]);
  });
});
