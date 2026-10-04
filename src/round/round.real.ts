import { expect, it } from "vitest";
import { providerClient } from "../provider/provider";
import { run, type Input, type RoundState } from "./round";
import twoLines from "./fixtures/two-lines.png?inline";

// Read before anything is sent; the key itself is never printed.
const key = import.meta.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is not set: the real-Provider check needs an OpenRouter key.");

const configuration = {
  provider: {
    preset: "openrouter",
    baseUrl: "",
    model: "~openai/gpt-luna-latest",
    reasoningEffort: "low",
    key,
  },
  targetLanguage: "zh-Hans",
} as const;

async function lastState(input: Input): Promise<RoundState> {
  let last: RoundState | undefined;
  for await (const state of run(providerClient(fetch), input, configuration, new AbortController().signal)) {
    last = state;
  }
  return last!;
}

it.each<[string, Input]>([
  ["a multi-line text Input", { kind: "text", text: "The cat sat\non the mat.\nIt was warm." }],
  ["an image Input", { kind: "image", dataUrl: twoLines }],
])("OpenRouter structures and translates %s", async (_, input) => {
  const state = await lastState(input);
  expect(state.outcome, JSON.stringify(state)).toBe("done");
  expect(state.source.text.trim()).not.toBe("");
  expect(state.translation.text.trim()).not.toBe("");
});
