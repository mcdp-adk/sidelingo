import { describe, expect, it } from "vitest";
import { providerClient } from "./provider";
import type { Preset } from "./presets";
import { DEFAULT_SETTINGS, resolveProviderConnection } from "./settings";

describe("Named Preset keys", () => {
  it.each<[Preset, string]>([
    ["openai", "synthetic-openai-from-environment"],
    ["openrouter", "synthetic-openrouter-from-environment"],
    ["deepseek", "synthetic-deepseek-from-environment"],
    ["ollama-cloud", "synthetic-ollama-from-environment"],
  ])("uses %s's own environment variable for both Bearer headers", async (preset, expectedKey) => {
    const settings = {
      ...DEFAULT_SETTINGS,
      activePreset: preset,
      presets: {
        ...DEFAULT_SETTINGS.presets,
        [preset]: { ...DEFAULT_SETTINGS.presets[preset], model: "model" },
      },
    };
    const connection = resolveProviderConnection(settings, {
      enteredKey: null,
      environment: {
        OPENAI_API_KEY: "synthetic-openai-from-environment",
        OPENROUTER_API_KEY: "synthetic-openrouter-from-environment",
        DEEPSEEK_API_KEY: "synthetic-deepseek-from-environment",
        OLLAMA_API_KEY: "synthetic-ollama-from-environment",
      },
    });
    expect(connection).toHaveProperty("configuration");
    if (!("configuration" in connection)) throw new Error("The supplied key must make the connection ready");
    const authorizations: (string | null)[] = [];
    const client = providerClient(async (url, { headers }) => {
      authorizations.push(new Headers(headers).get("Authorization"));
      return url.endsWith("/models") ? new Response(JSON.stringify({ data: [] })) : new Response("data: [DONE]\n\n");
    });
    const signal = new AbortController().signal;
    for await (const _ of client.streamChat(connection.configuration, [{ role: "user", content: "hello" }], signal)) {
      /* Both calls use the actual public producer's result. */
    }
    await client.listModels(connection.configuration, signal);
    expect(authorizations).toEqual([`Bearer ${expectedKey}`, `Bearer ${expectedKey}`]);
  });

  it("prefers an entered key to its named environment key for both Bearer headers", async () => {
    const enteredKey = "synthetic-openai-entered-override";
    const environmentKey = "synthetic-openai-from-environment";
    const settings = {
      ...DEFAULT_SETTINGS,
      activePreset: "openai" as const,
      presets: {
        ...DEFAULT_SETTINGS.presets,
        openai: { ...DEFAULT_SETTINGS.presets.openai, model: "model" },
      },
    };
    const resolved = resolveProviderConnection(settings, {
      enteredKey,
      environment: { OPENAI_API_KEY: environmentKey },
    });
    expect(resolved).toHaveProperty("configuration");
    if (!("configuration" in resolved)) throw new Error("Both supplied keys must make the connection ready");

    const authorizations: (string | null)[] = [];
    const client = providerClient(async (url, { headers }) => {
      authorizations.push(new Headers(headers).get("Authorization"));
      return url.endsWith("/models") ? new Response(JSON.stringify({ data: [] })) : new Response("data: [DONE]\n\n");
    });
    const signal = new AbortController().signal;
    for await (const _ of client.streamChat(resolved.configuration, [{ role: "user", content: "hello" }], signal)) {
      /* Consume the public stream to send the chat request. */
    }
    await client.listModels(resolved.configuration, signal);
    expect(authorizations).toEqual([`Bearer ${enteredKey}`, `Bearer ${enteredKey}`]);
  });
});

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
