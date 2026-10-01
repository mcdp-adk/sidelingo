import { fetch } from "@tauri-apps/plugin-http";
import { englishName, type TargetLanguage } from "./languages";
import { providerClient, type ChatMessage, type ProviderConfiguration } from "./provider";
import * as structuring from "./prompts/structuring";
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
  stage: "structuring" | "translating" | "done";
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

function structuringMessages(inputText: string): ChatMessage[] {
  const tokens = { input: inputText };
  return [
    { role: "system", content: fill(structuring.system, tokens) },
    {
      role: "user",
      content: [{ type: "text", text: fill(structuring.prompt, tokens) }],
    },
  ];
}

/** Hides a leading reasoning block, buffering partial markers so they never flash in the window. */
async function* withoutReasoning(deltas: AsyncGenerator<string>): AsyncGenerator<string> {
  const opening = "<think>";
  const closing = "</think>";
  let prefix = "";
  let hiddenTail = "";
  let state: "checking-prefix" | "reasoning" | "content" = "checking-prefix";

  for await (const delta of deltas) {
    if (state === "content") {
      yield delta;
      continue;
    }

    if (state === "reasoning") {
      const hidden = hiddenTail + delta;
      const end = hidden.indexOf(closing);
      if (end >= 0) {
        state = "content";
        const content = hidden.slice(end + closing.length);
        if (content) yield content;
      } else {
        hiddenTail = hidden.slice(-(closing.length - 1));
      }
      continue;
    }

    prefix += delta;
    if (opening.startsWith(prefix)) {
      if (prefix === opening) {
        state = "reasoning";
        prefix = "";
      }
      continue;
    }
    if (prefix.startsWith(opening)) {
      state = "reasoning";
      const hidden = prefix.slice(opening.length);
      prefix = "";
      const end = hidden.indexOf(closing);
      if (end >= 0) {
        state = "content";
        const content = hidden.slice(end + closing.length);
        if (content) yield content;
      } else {
        hiddenTail = hidden.slice(-(closing.length - 1));
      }
      continue;
    }

    state = "content";
    yield prefix;
    prefix = "";
  }

  // A normal response may finish while its opening marker is still only a partial match.
  if (state === "checking-prefix" && prefix) yield prefix;
}

/**
 * Runs Structuring for text with a line break, then streams one Translation of the whole
 * Source text. A single line goes straight to Translation. Aborting `signal` cancels every call.
 */
export async function* run(
  input: Input,
  configuration: RoundConfiguration,
  signal: AbortSignal,
): AsyncGenerator<RoundState> {
  const text = input.text.trim();
  let sourceText = text;
  const multiline = /[\r\n]/.test(text);
  if (multiline) {
    sourceText = "";
    let source = { text: sourceText };
    const translation = { text: "" };
    yield { stage: "structuring", source, translation };
    for await (const delta of withoutReasoning(
      client.streamChat(configuration.provider, structuringMessages(text), signal),
    )) {
      sourceText += delta;
      source = { text: sourceText };
      yield { stage: "structuring", source, translation };
    }
  }
  const source = { text: sourceText };
  let translated = "";
  const messages = translationMessages(sourceText, configuration.targetLanguage);
  yield { stage: "translating", source, translation: { text: translated } };
  for await (const delta of withoutReasoning(client.streamChat(configuration.provider, messages, signal))) {
    translated += delta;
    yield { stage: "translating", source, translation: { text: translated } };
  }
  yield { stage: "done", source, translation: { text: translated } };
}
