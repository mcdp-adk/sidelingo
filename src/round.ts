import { fetch } from "@tauri-apps/plugin-http";
import { englishName, type TargetLanguage } from "./languages";
import { providerClient, type ChatMessage, type ProviderConfiguration } from "./provider";
import * as translation from "./prompts/translation";

/** What one copy hands sidelingo; the Rust ↔ TypeScript interface's Input. */
export type Input = { kind: "text"; text: string };

/** What a Round runs with, fixed when it starts. */
export interface RoundConfiguration {
  provider: ProviderConfiguration;
  targetLanguage: TargetLanguage;
}

/** A Round's progress, from its first update to its last. */
export interface RoundState {
  source: { text: string };
  translation: { text: string };
}

const client = providerClient(fetch);

/** Read Frog's fallbacks for the Document Metadata, which a copy never has. */
const METADATA_FALLBACKS = { webTitle: "No title available", webSummary: "No summary available" };

/** Fills `{{token}}` placeholders in one pass, so text filled in is never filled again. */
function fill(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, token: string) => tokens[token] ?? placeholder);
}

function translationMessages(sourceText: string, targetLanguage: TargetLanguage): ChatMessage[] {
  const tokens = { ...METADATA_FALLBACKS, targetLanguage: englishName(targetLanguage), input: sourceText };
  return [
    { role: "system", content: fill(translation.system, tokens) },
    { role: "user", content: fill(translation.prompt, tokens) },
  ];
}

/**
 * The Round pipeline: runs one Round on `input`, yielding its state from the Translated
 * text's first token on. Text with no line break after trimming is its own Source text,
 * with no call; aborting `signal` cancels every call.
 */
export async function* run(
  input: Input,
  configuration: RoundConfiguration,
  signal: AbortSignal,
): AsyncGenerator<RoundState> {
  const text = input.text.trim();
  // Multi-line text goes through Structuring, which #36 brings; until then it yields nothing.
  if (/[\r\n]/.test(text)) return;
  const source = { text };
  let translated = "";
  const messages = translationMessages(text, configuration.targetLanguage);
  for await (const delta of client.streamChat(configuration.provider, messages, signal)) {
    translated += delta;
    yield { source, translation: { text: translated } };
  }
}
