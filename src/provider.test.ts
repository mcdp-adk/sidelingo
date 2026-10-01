import { describe, expect, it } from "vitest";
import { providerClient } from "./provider";
import type { Preset } from "./presets";

describe("Named Preset endpoints", () => {
  it.each<[Preset, string]>([
    ["openai", "https://api.openai.com/v1"],
    ["openrouter", "https://openrouter.ai/api/v1"],
    ["deepseek", "https://api.deepseek.com"],
    ["ollama-cloud", "https://ollama.com/v1"],
  ])("sends %s requests to its fixed Base URL with its documented effort choices", async (preset, base) => {
    const calls: { url: string; method: string | undefined }[] = [];
    let chatBody: any;
    const client = providerClient(async (url, { method, body }) => {
      calls.push({ url, method });
      if (body) chatBody = JSON.parse(body as string);
      return url.endsWith("/models") ? new Response(JSON.stringify({ data: [] })) : new Response("data: [DONE]\n\n");
    });
    const configuration = {
      preset,
      baseUrl: "https://ignored.invalid",
      model: "model",
      reasoningEffort: "low" as const,
    };
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
    expect(chatBody).toMatchObject(
      preset === "openrouter" ? { reasoning: { effort: "low" } } : { reasoning_effort: "low" },
    );
    expect(chatBody).not.toHaveProperty(preset === "openrouter" ? "reasoning_effort" : "reasoning");
    const remainingChoices =
      preset === "deepseek"
        ? ([null, "none", "high", "max"] as const)
        : ([null, "none", "medium", "high", "xhigh", "max"] as const);
    for (const reasoningEffort of remainingChoices) {
      for await (const _ of client.streamChat(
        { ...configuration, reasoningEffort },
        [{ role: "user", content: "hello" }],
        signal,
      )) {
        /* Consume the public stream to send this configuration. */
      }
      expect(calls.at(-1)).toEqual({ method: "POST", url: `${base}/chat/completions` });
      if (reasoningEffort === null) {
        expect(chatBody).not.toHaveProperty("reasoning_effort");
        expect(chatBody).not.toHaveProperty("reasoning");
      } else {
        expect(chatBody).toMatchObject(
          preset === "openrouter" ? { reasoning: { effort: reasoningEffort } } : { reasoning_effort: reasoningEffort },
        );
        expect(chatBody).not.toHaveProperty(preset === "openrouter" ? "reasoning_effort" : "reasoning");
      }
    }
  });

  it.each(["medium", "xhigh"] as const)(
    "rejects DeepSeek's unsupported %s effort before sending",
    async (reasoningEffort) => {
      let sent = false;
      const client = providerClient(async () => {
        sent = true;
        return new Response("data: [DONE]\n\n");
      });
      const completion = client.streamChat(
        { preset: "deepseek", baseUrl: "https://ignored.invalid", model: "model", reasoningEffort },
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
      );
      await expect(completion.next()).rejects.toThrow(RangeError);
      expect(sent).toBe(false);
    },
  );
});
