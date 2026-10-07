import { describe, expect, it } from "vitest";
import { providerClient } from "./provider";
import type { Preset } from "./presets";
import { settingsSnapshot } from "../settings/settings-store";
import { startCore } from "../testing/core";

// The Round's requests are proven through the webview core (`round.test.ts`). The model list has no owner there
// yet: only the settings window asks for it, on the connection the settings snapshot publishes for its Preset.
describe("Listing a named Preset's models", () => {
  const environment = {
    OPENAI_API_KEY: "key-in-OPENAI_API_KEY",
    OPENROUTER_API_KEY: "key-in-OPENROUTER_API_KEY",
    DEEPSEEK_API_KEY: "key-in-DEEPSEEK_API_KEY",
    OLLAMA_API_KEY: "key-in-OLLAMA_API_KEY",
  };

  async function listModelsFor(preset: Preset) {
    await startCore({ settings: { schemaVersion: 1, activePreset: preset }, keyEnvironment: environment });
    const connection = settingsSnapshot().connections[preset];
    if (!("connection" in connection)) throw new Error("The supplied keys must make the connection ready");
    const calls: { method: string | undefined; url: string; authorization: string | null }[] = [];
    const client = providerClient(async (url, { method, headers }) => {
      calls.push({ method, url, authorization: new Headers(headers).get("Authorization") });
      return new Response(JSON.stringify({ data: [{ id: "listed-model" }] }));
    });
    expect(await client.listModels(connection.connection, new AbortController().signal)).toEqual(["listed-model"]);
    return calls;
  }

  it.each<[Preset, string, string]>([
    ["openai", "https://api.openai.com/v1/models", "OPENAI_API_KEY"],
    ["openrouter", "https://openrouter.ai/api/v1/models", "OPENROUTER_API_KEY"],
    ["deepseek", "https://api.deepseek.com/models", "DEEPSEEK_API_KEY"],
    ["ollama-cloud", "https://ollama.com/v1/models", "OLLAMA_API_KEY"],
  ])("%s asks its own endpoint with its own launch key", async (preset, url, variable) => {
    expect(await listModelsFor(preset)).toEqual([{ method: "GET", url, authorization: `Bearer key-in-${variable}` }]);
  });
});
