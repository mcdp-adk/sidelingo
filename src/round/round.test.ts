import { describe, expect, it } from "vitest";
import type { Input, RoundError, RoundPane } from "./round";
import { customSettings, startCore, type Reply } from "../testing/core";

const IMAGE: Input = { kind: "image", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const LINES = "A wrapped line\ncontinues here";
const EMPTY = "The Provider returned an empty response.";
const DROPPED = "The connection dropped.";

interface Row {
  name: string;
  input: Input | string;
  /** The Custom Preset's reasoning effort; Default when absent. */
  reasoningEffort?: string;
  replies: Reply[];
  error: RoundError;
  source: RoundPane;
  translation: RoundPane;
}

/** Structuring fails: whatever streamed stays in Source, and Translation never starts. */
function structuringFails(row: { name: string; input: Input | string; reasoningEffort?: string; reply: Reply }) {
  return (error: Omit<RoundError, "stage">, streamed = ""): Row => {
    const failure = { stage: "structuring", ...error } as const;
    return {
      ...row,
      replies: [row.reply],
      error: failure,
      source: { text: streamed, status: "failed", error: failure },
      translation: { text: "", status: "skipped", error: failure },
    };
  };
}

/** Translation fails: the completed Source text stays, and whatever streamed stays in Translation. */
function translationFails(row: {
  name: string;
  input: Input | string;
  reasoningEffort?: string;
  replies: Reply[];
  source: string;
}) {
  return (error: Omit<RoundError, "stage">, streamed = ""): Row => {
    const failure = { stage: "translating", ...error } as const;
    return {
      ...row,
      error: failure,
      source: { text: row.source, status: "done" },
      translation: { text: streamed, status: "failed", error: failure },
    };
  };
}

const http = (status: number, detail: string, rest: Partial<RoundError> = {}) =>
  ({ category: "provider-http", status, detail, offersSettings: false, ...rest }) as const;
const providerError = (detail: string) => ({ category: "provider-error", detail, offersSettings: false }) as const;
const network = (detail: string) => ({ category: "network", detail, offersSettings: true }) as const;
const empty = { category: "empty-response", detail: EMPTY, offersSettings: false } as const;

/** Chunks a Provider may send that carry no content, which a stream tolerates before failing. */
const TOLERATED = [
  { data: "{}" },
  { data: '{"choices":[]}' },
  { data: '{"choices":[{}]}' },
  { data: '{"choices":[{"delta":{"content":null}}]}' },
  { data: '{"choices":[{"delta":{"role":"assistant"}}]}' },
  { data: '{"choices":[{"delta":{"reasoning_content":"thinking","reasoning":"thinking"}}]}' },
];

const rows: Row[] = [
  structuringFails({
    name: "an HTTP error during Structuring",
    input: LINES,
    reply: { status: 429, message: "Slow down\n  indented" },
  })(http(429, "Slow down\n  indented")),
  translationFails({
    name: "an HTTP error during Translation, after Structuring completed",
    input: LINES,
    replies: [[{ content: "## Source" }], { status: 429, message: "Slow down" }],
    source: "## Source",
  })(http(429, "Slow down")),
  translationFails({
    name: "an HTTP error for a single line, which goes straight to Translation",
    input: "A single line",
    replies: [{ status: 500, message: "Internal error" }],
    source: "A single line",
  })(http(500, "Internal error")),
  structuringFails({ name: "a 400 for an image Input", input: IMAGE, reply: { status: 400, message: "No images" } })(
    http(400, "No images", { hints: ["image-model-support"] }),
  ),
  translationFails({
    name: "a 400 during an image Input's Translation",
    input: IMAGE,
    replies: [[{ content: "Text in the image" }], { status: 400, message: "Rejected" }],
    source: "Text in the image",
  })(http(400, "Rejected", { hints: ["image-model-support"] })),
  translationFails({
    name: "a 400 for a request with a reasoning effort",
    input: "A single line",
    reasoningEffort: "low",
    replies: [{ status: 400, message: "Unsupported effort" }],
    source: "A single line",
  })(http(400, "Unsupported effort", { hints: ["reasoning-effort"] })),
  structuringFails({
    name: "a 400 for an image Input with a reasoning effort",
    input: IMAGE,
    reasoningEffort: "low",
    reply: { status: 400, message: "Rejected" },
  })(http(400, "Rejected", { hints: ["image-model-support", "reasoning-effort"] })),
  translationFails({
    name: "a 400 for a text Input at Default effort",
    input: "A single line",
    replies: [{ status: 400, message: "Rejected" }],
    source: "A single line",
  })(http(400, "Rejected")),
  structuringFails({
    name: "an image Input's error other than a 400",
    input: IMAGE,
    reasoningEffort: "low",
    reply: { status: 429, message: "Slow down" },
  })(http(429, "Slow down")),
  ...[401, 403, 404].map((status) =>
    translationFails({
      name: `an HTTP ${status}, which settings can fix`,
      input: "A single line",
      replies: [{ status, message: `Refused ${status}` }],
      source: "A single line",
    })(http(status, `Refused ${status}`, { offersSettings: true })),
  ),
  structuringFails({ name: "an error inside the stream", input: LINES, reply: [{ error: "Model overloaded" }] })(
    providerError("Model overloaded"),
  ),
  ...[
    ["unparsable data", "{broken"],
    ["choices that aren't a list", '{"choices":{}}'],
    ["a choice that isn't an object", '{"choices":[null]}'],
    ["data that isn't an object", "null"],
    ["content that isn't text", '{"choices":[{"delta":{"content":7}}]}'],
  ].map(([shape, data]) =>
    structuringFails({
      name: `malformed stream data (${shape}) after partial text`,
      input: LINES,
      reply: [...TOLERATED, { content: "## Partial" }, { data }],
    })(providerError(data), "## Partial"),
  ),
  structuringFails({ name: "an empty Structuring response", input: LINES, reply: [] })(empty),
  structuringFails({
    name: "a Structuring response holding only reasoning",
    input: LINES,
    reply: [{ content: "<think>private reasoning</think>" }],
  })(empty),
  structuringFails({ name: "an HTTP 204 for Structuring", input: LINES, reply: { status: 204 } })(empty),
  translationFails({
    name: "an empty Translation response",
    input: LINES,
    replies: [[{ content: "## Source" }], []],
    source: "## Source",
  })(empty),
  structuringFails({
    name: "a stream that drops after partial text",
    input: LINES,
    reply: [{ content: "## Partial" }, { drop: true }],
  })(network(DROPPED), "## Partial"),
  translationFails({
    name: "a Translation stream that drops after partial text",
    input: "A single line",
    replies: [[{ content: "Partial translation" }, { drop: true }]],
    source: "A single line",
  })(network(DROPPED), "Partial translation"),
  structuringFails({
    name: "an HTTP error whose body drops before it completes",
    input: LINES,
    reply: { status: 429, message: "Slow down", dropBody: true },
  })(network(DROPPED)),
  structuringFails({
    name: "a connection that fails before any response",
    input: LINES,
    reply: { refuse: "Connection refused" },
  })(network("Connection refused")),
];

describe("The Round's Provider errors", () => {
  it.each(rows)("$name", async ({ input, reasoningEffort, replies, error, source, translation }) => {
    const core = await startCore({ settings: customSettings(reasoningEffort ? { reasoningEffort } : {}) });
    core.provider.reply(...replies);
    await core.copy(input);

    expect(await core.roundEnds()).toEqual({ stage: error.stage, outcome: "failed", source, translation });
    // Nothing more is sent after a failure: Translation never starts once Structuring fails.
    expect(core.provider.requests).toHaveLength(replies.length);
  });
});
