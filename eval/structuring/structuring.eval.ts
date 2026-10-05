import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { providerClient, type ProviderConfiguration } from "../../src/provider/provider";
import { run, type RoundState } from "../../src/round/round";
import { fixtures, type Fixture } from "./fixtures";

// The eval has no pass or fail (ADR 0006): it writes each Round's result for the agent to read against the fixture's note.
const outputFolder = join(import.meta.dirname, "output");

/** The two reference models, at reasoning effort low; keys are read from the environment and never printed or written. */
const models: { name: string; provider: ProviderConfiguration }[] = [
  {
    name: "openrouter-gpt-luna-latest",
    provider: {
      preset: "openrouter",
      baseUrl: "",
      model: "~openai/gpt-luna-latest",
      reasoningEffort: "low",
      key: requiredKey("OPENROUTER_API_KEY"),
    },
  },
  {
    name: "ollama-cloud-deepseek-v4.1-flash",
    provider: {
      preset: "ollama-cloud",
      baseUrl: "",
      model: "deepseek-v4.1-flash",
      reasoningEffort: "low",
      key: requiredKey("OLLAMA_API_KEY"),
    },
  },
];

function requiredKey(variable: string): string {
  const key = process.env[variable];
  if (!key) throw new Error(`${variable} is not set: pnpm eval:structuring needs both reference models' keys.`);
  return key;
}

interface Result {
  state: RoundState;
  /** Milliseconds from the Round's start to its first Translated text; absent when none arrived. */
  firstTranslatedToken?: number;
  total: number;
}

async function runRound(fixture: Fixture, provider: ProviderConfiguration): Promise<Result> {
  const configuration = { provider, targetLanguage: "zh-Hans" } as const;
  const start = performance.now();
  let firstTranslatedToken: number | undefined;
  let state: RoundState | undefined;
  for await (state of run(providerClient(fetch), fixture.input, configuration, new AbortController().signal)) {
    if (firstTranslatedToken === undefined && state.translation.text) firstTranslatedToken = performance.now() - start;
  }
  return { state: state!, firstTranslatedToken, total: performance.now() - start };
}

/** A fence longer than any backtick run in the text, so the output shows as written. */
function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}markdown\n${text}\n${fence}`;
}

const milliseconds = (value: number | undefined) => (value === undefined ? "none" : `${Math.round(value)} ms`);

function report(fixture: Fixture, model: string, { state, firstTranslatedToken, total }: Result): string {
  const error = state.source.error ?? state.translation.error;
  return [
    `# ${fixture.name} (${fixture.group}) on ${model}`,
    "",
    `- Outcome: ${state.outcome}`,
    `- Time to first Translated token: ${milliseconds(firstTranslatedToken)}`,
    `- Round time: ${milliseconds(total)}`,
    ...(error
      ? [`- Error: ${error.stage}, ${error.category}${error.status ? ` ${error.status}` : ""}: ${error.detail}`]
      : []),
    "",
    `Good output: ${fixture.note}`,
    "",
    "## Input",
    "",
    fixture.input.kind === "text" ? fenced(fixture.input.text) : "(image)",
    "",
    "## Source text",
    "",
    fenced(state.source.text),
    "",
    "## Translated text",
    "",
    fenced(state.translation.text),
    "",
  ].join("\n");
}

rmSync(outputFolder, { recursive: true, force: true });

// Models run side by side; each runs its fixtures one at a time so their latencies don't overlap.
it.concurrent.each(models)("$name", async ({ name, provider }) => {
  const folder = join(outputFolder, name);
  mkdirSync(folder, { recursive: true });
  const summary = ["| Fixture | Group | Outcome | First Translated token | Round |", "| --- | --- | --- | --- | --- |"];
  for (const fixture of fixtures) {
    const result = await runRound(fixture, provider);
    writeFileSync(join(folder, `${fixture.name}.md`), report(fixture, name, result));
    summary.push(
      `| ${fixture.name} | ${fixture.group} | ${result.state.outcome} | ${milliseconds(result.firstTranslatedToken)} | ${milliseconds(result.total)} |`,
    );
  }
  writeFileSync(join(folder, "summary.md"), `# ${name}\n\n${summary.join("\n")}\n`);
});
