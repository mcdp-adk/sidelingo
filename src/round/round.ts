import { englishName, type TargetLanguage } from "../languages";
import { ProviderError, type ChatMessage, type ProviderClient, type ProviderConfiguration } from "../provider/provider";
import * as structuring from "./prompts/structuring";
import * as translation from "./prompts/translation";

/** What one copy hands sidelingo; the Rust ↔ TypeScript interface's Input. */
export type Input = { kind: "text"; text: string } | { kind: "image"; dataUrl: string };

/** What a Round runs with, fixed when it starts. */
export interface RoundConfiguration {
  provider: ProviderConfiguration;
  targetLanguage: TargetLanguage;
}

export type RoundStage = "structuring" | "translating" | "done" | "no-text";
export type RoundOutcome = "running" | "done" | "no-text" | "failed";
export type RoundErrorHint = "image-model-support" | "reasoning-effort";

export interface RoundError {
  stage: "structuring" | "translating";
  category: ProviderError["category"];
  status?: number;
  detail: string;
  hints?: RoundErrorHint[];
  /** The Pin window offers Open settings: the cause is likely there (the Base URL, proxy, key or Model). */
  offersSettings: boolean;
}

export interface RoundPane {
  text: string;
  status: "waiting" | "streaming" | "done" | "failed" | "skipped";
  error?: RoundError;
}

/** A Round's progress, from its first update to its last. */
export interface RoundState {
  stage: RoundStage;
  outcome: RoundOutcome;
  source: RoundPane;
  translation: RoundPane;
}

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

function structuringMessages(input: Input): ChatMessage[] {
  return [
    { role: "system", content: structuring.system },
    {
      role: "user",
      content:
        input.kind === "text"
          ? [{ type: "text", text: fill(structuring.prompt, { input: input.text.trim() }) }]
          : [{ type: "image_url", image_url: { url: input.dataUrl } }],
    },
  ];
}

/** Streams cleaned snapshots, hiding recognized reasoning and clearing an unmarked prefix once its closer arrives. */
async function* withoutReasoning(deltas: AsyncGenerator<string>): AsyncGenerator<string> {
  const opening = "<think>";
  const closing = "</think>";
  let prefix = "";
  let hiddenTail = "";
  let content = "";
  let state: "checking-prefix" | "reasoning" | "unmarked" | "content" = "checking-prefix";

  for await (const delta of deltas) {
    if (state === "checking-prefix") {
      prefix += delta;
      const candidate = prefix.trimStart();
      if (opening.startsWith(candidate)) {
        if (candidate === opening) {
          state = "reasoning";
          prefix = "";
        }
        continue;
      }
      if (candidate.startsWith(opening)) {
        state = "reasoning";
        hiddenTail = candidate.slice(opening.length);
      } else {
        state = "unmarked";
        content = prefix;
      }
      prefix = "";
    } else if (state === "reasoning") hiddenTail += delta;
    else content += delta;

    if (state === "reasoning") {
      const end = hiddenTail.indexOf(closing);
      if (end < 0) {
        hiddenTail = hiddenTail.slice(-(closing.length - 1));
        continue;
      }
      content = hiddenTail.slice(end + closing.length);
      hiddenTail = "";
      state = "content";
    }
    if (state === "unmarked") {
      const end = content.indexOf(closing);
      if (end >= 0) {
        content = content.slice(end + closing.length);
        state = "content";
      }
    }
    // An empty replacement must clear content that streamed before an unmarked closer.
    yield content;
  }

  // A normal response may finish while its opening marker is still only a partial match.
  if (state === "checking-prefix" && prefix) yield prefix;
}

/**
 * Runs Structuring for images and text with a line break, then streams one Translation of the whole
 * Source text through `client`. A single line goes straight to Translation. Aborting `signal` cancels every call.
 */
export async function* run(
  client: ProviderClient,
  input: Input,
  configuration: RoundConfiguration,
  signal: AbortSignal,
): AsyncGenerator<RoundState> {
  const text = input.kind === "text" ? input.text.trim() : "";
  let sourceText = text;
  const needsStructuring = input.kind === "image" || /[\r\n]/.test(text);
  if (needsStructuring) {
    sourceText = "";
    let source: RoundPane = { text: sourceText, status: "streaming" };
    const translation: RoundPane = { text: "", status: "waiting" };
    yield { stage: "structuring", outcome: "running", source, translation };
    try {
      for await (const cleaned of withoutReasoning(
        client.streamChat(configuration.provider, structuringMessages(input), signal),
      )) {
        sourceText = cleaned;
        source = { text: sourceText, status: "streaming" };
        yield { stage: "structuring", outcome: "running", source, translation };
      }
      if (!sourceText.trim()) throw new ProviderError("empty-response", "The Provider returned an empty response.");
    } catch (reason) {
      if (signal.aborted) return;
      const error = roundError(reason, "structuring", input, configuration);
      yield {
        stage: "structuring",
        outcome: "failed",
        source: { text: sourceText, status: "failed", error },
        translation: { text: "", status: "skipped", error },
      };
      return;
    }
    source = { text: sourceText, status: "done" };
    if (input.kind === "image" && sourceText.trim() === "NO_TEXT") {
      yield {
        stage: "no-text",
        outcome: "no-text",
        source: { text: "", status: "done" },
        translation: { text: "", status: "skipped" },
      };
      return;
    }
  }
  const source: RoundPane = { text: sourceText, status: "done" };
  let translated = "";
  let translation: RoundPane = { text: translated, status: "streaming" };
  const messages = translationMessages(sourceText, configuration.targetLanguage);
  yield { stage: "translating", outcome: "running", source, translation };
  try {
    for await (const cleaned of withoutReasoning(client.streamChat(configuration.provider, messages, signal))) {
      translated = cleaned;
      translation = { text: translated, status: "streaming" };
      yield { stage: "translating", outcome: "running", source, translation };
    }
    if (!translated.trim()) throw new ProviderError("empty-response", "The Provider returned an empty response.");
  } catch (reason) {
    if (signal.aborted) return;
    const error = roundError(reason, "translating", input, configuration);
    yield {
      stage: "translating",
      outcome: "failed",
      source,
      translation: { text: translated, status: "failed", error },
    };
    return;
  }
  yield {
    stage: "done",
    outcome: "done",
    source,
    translation: { text: translated, status: "done" },
  };
}

function roundError(
  reason: unknown,
  stage: RoundError["stage"],
  input: Input,
  configuration: RoundConfiguration,
): RoundError {
  if (!(reason instanceof ProviderError)) throw reason;
  const hints: RoundErrorHint[] = [];
  if (reason.status === 400) {
    if (input.kind === "image") hints.push("image-model-support");
    if (configuration.provider.reasoningEffort != null) hints.push("reasoning-effort");
  }
  return {
    stage,
    category: reason.category,
    ...(reason.status === undefined ? {} : { status: reason.status }),
    detail: reason.message,
    ...(hints.length > 0 ? { hints } : {}),
    offersSettings:
      reason.category === "network" ||
      (reason.category === "provider-http" && [401, 403, 404].includes(reason.status ?? 0)),
  };
}
