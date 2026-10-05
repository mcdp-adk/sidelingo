import { describe, expect, it } from "vitest";
import type { Input, RoundError, RoundPane, RoundState } from "./round";
import { customSettings, startCore, type Core, type Reply, type SentRequest } from "../testing/core";

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

/** A Round's published states, from the panes' text. */
const structuring = (source: string): RoundState => ({
  stage: "structuring",
  outcome: "running",
  source: { text: source, status: "streaming" },
  translation: { text: "", status: "waiting" },
});
const translating = (source: string, translation: string): RoundState => ({
  stage: "translating",
  outcome: "running",
  source: { text: source, status: "done" },
  translation: { text: translation, status: "streaming" },
});
const done = (source: string, translation: string): RoundState => ({
  stage: "done",
  outcome: "done",
  source: { text: source, status: "done" },
  translation: { text: translation, status: "done" },
});
/** A Source text streamed in one chunk, then translated in one chunk. */
const structuredThenTranslated = (source: string, translation: string) => [
  structuring(""),
  structuring(source),
  translating(source, ""),
  translating(source, translation),
  done(source, translation),
];
/** A single line translated in one chunk. */
const translatedAtOnce = (source: string, translation: string) => [
  translating(source, ""),
  translating(source, translation),
  done(source, translation),
];

/** What the fake Provider received, as a row expects it. */
const sentAs = ({ method, url, headers, body }: SentRequest) => ({
  method,
  url,
  authorization: headers.get("authorization"),
  body,
});

const CHAT = "https://provider.test/v1/chat/completions";
const IMAGE_PART = { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } };
const textPart = (text: string) => ({ type: "text", text });

interface RequestOptions {
  fields?: object;
  model?: string;
  url?: string;
  authorization?: string | null;
}

/** A Structuring request for `part` (the copied text or image), with no body field other than `fields`. */
const structuringRequest = (
  part: object,
  { fields = {}, model = "test-model", url = CHAT, authorization = null }: RequestOptions = {},
) => ({
  method: "POST",
  url,
  authorization,
  body: {
    model,
    stream: true,
    ...fields,
    messages: [
      { role: "system", content: expect.stringMatching(/^You turn an Input into faithful, readable Source text\./) },
      { role: "user", content: [part] },
    ],
  },
});

/** A Translation request for the whole `source` into `language`, with no body field other than `fields`. */
const translationRequest = (
  source: string,
  {
    language = "English",
    fields = {},
    model = "test-model",
    url = CHAT,
    authorization = null,
  }: RequestOptions & {
    language?: string;
  } = {},
) => ({
  method: "POST",
  url,
  authorization,
  body: {
    model,
    stream: true,
    ...fields,
    messages: [
      {
        role: "system",
        // Read Frog's prompt, filled in: no placeholder is left.
        content: expect.stringMatching(
          new RegExp(
            `^You are a professional ${language} native translator who needs to fluently translate text into ${language}\\.\\n` +
              "[^{}]*\\n4\\. For content that should not be translated \\(such as proper nouns, code, etc\\.\\), keep the original text\\.\\n" +
              "[^{}]*\\nWebpage title: No title available\\nWebpage summary: No summary available$",
          ),
        ),
      },
      { role: "user", content: `Translate to ${language}:\n\n\n${source}` },
    ],
  },
});

/** Holds a stream until released. */
function hold() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  return { wait, release };
}
const midRound = hold();

interface PipelineRow {
  name: string;
  /** The stored settings document; a Custom Preset when absent. */
  settings?: unknown;
  keyEnvironment?: Record<string, string>;
  input: Input | string;
  replies: Reply[];
  /** Runs once the Round has started. */
  meanwhile?: (core: Core) => Promise<void>;
  /** Every distinct Round state the Session publishes, in order. */
  shown: RoundState[];
  /** What each request carried, in order. */
  sent: ReturnType<typeof structuringRequest>[];
}

const pipeline: PipelineRow[] = [
  {
    name: "a single line skips Structuring, so its Source text is done at once",
    input: "  Une seule ligne  ",
    replies: [[{ content: "A single" }, { content: " line" }]],
    shown: [
      translating("Une seule ligne", ""),
      translating("Une seule ligne", "A single"),
      translating("Une seule ligne", "A single line"),
      done("Une seule ligne", "A single line"),
    ],
    sent: [translationRequest("Une seule ligne")],
  },
  {
    name: "a line ending in a line break is a single line",
    input: "Une ligne\r\n",
    replies: [[{ content: "A line" }]],
    shown: translatedAtOnce("Une ligne", "A line"),
    sent: [translationRequest("Une ligne")],
  },
  {
    name: "multi-line text streams Structuring, then one Translation of the complete Source text",
    input: LINES,
    replies: [[{ content: "## Clean" }, { content: "\nwith the rest" }], [{ content: "Translated" }]],
    shown: [
      structuring(""),
      structuring("## Clean"),
      structuring("## Clean\nwith the rest"),
      translating("## Clean\nwith the rest", ""),
      translating("## Clean\nwith the rest", "Translated"),
      done("## Clean\nwith the rest", "Translated"),
    ],
    sent: [structuringRequest(textPart(LINES)), translationRequest("## Clean\nwith the rest")],
  },
  {
    name: "an image runs Structuring on the image, then one Translation of its Source text",
    input: IMAGE,
    replies: [[{ content: "Text in the image" }], [{ content: "Translated" }]],
    shown: structuredThenTranslated("Text in the image", "Translated"),
    sent: [structuringRequest(IMAGE_PART), translationRequest("Text in the image")],
  },
  {
    name: "an image whose Source text is exactly NO_TEXT ends the Round as no text, never showing NO_TEXT",
    input: IMAGE,
    replies: [[{ content: " \nNO" }, { content: "_TEXT\n " }]],
    shown: [
      structuring(""),
      {
        stage: "no-text",
        outcome: "no-text",
        source: { text: "", status: "done" },
        translation: { text: "", status: "skipped" },
      },
    ],
    sent: [structuringRequest(IMAGE_PART)],
  },
  {
    name: "an image's Source text that starts like NO_TEXT shows once it differs",
    input: IMAGE,
    replies: [[{ content: "NO" }, { content: " entry" }], [{ content: "Translated" }]],
    shown: structuredThenTranslated("NO entry", "Translated"),
    sent: [structuringRequest(IMAGE_PART), translationRequest("NO entry")],
  },
  {
    name: "an image whose Source text only contains NO_TEXT is translated",
    input: IMAGE,
    replies: [[{ content: "The label reads NO_TEXT" }], [{ content: "Translated" }]],
    shown: structuredThenTranslated("The label reads NO_TEXT", "Translated"),
    sent: [structuringRequest(IMAGE_PART), translationRequest("The label reads NO_TEXT")],
  },
  {
    name: "multi-line text whose Source text is exactly NO_TEXT is translated",
    input: LINES,
    replies: [[{ content: "NO_TEXT" }], [{ content: "Translated" }]],
    shown: structuredThenTranslated("NO_TEXT", "Translated"),
    sent: [structuringRequest(textPart(LINES)), translationRequest("NO_TEXT")],
  },
  ...["", "\n \t"].map((leading): PipelineRow => ({
    name: `marked reasoning${leading ? " after whitespace" : ""}, split across chunks, is removed from both stages`,
    input: LINES,
    replies: [
      [{ content: `${leading}<thi` }, { content: "nk>private structure</th" }, { content: "ink>## Source" }],
      [{ content: `${leading}<think>private translation</th` }, { content: "ink>Translated" }],
    ],
    shown: structuredThenTranslated("## Source", "Translated"),
    sent: [structuringRequest(textPart(LINES)), translationRequest("## Source")],
  })),
  {
    name: "reasoning with only a closing marker shows until the marker arrives, then is removed from both stages",
    input: LINES,
    replies: [
      [{ content: "Unmarked structure" }, { content: "</th" }, { content: "ink>" }, { content: "## Source" }],
      [{ content: "Unmarked translation" }, { content: "</th" }, { content: "ink>" }, { content: "Translated" }],
    ],
    shown: [
      structuring(""),
      structuring("Unmarked structure"),
      structuring("Unmarked structure</th"),
      structuring(""),
      structuring("## Source"),
      translating("## Source", ""),
      translating("## Source", "Unmarked translation"),
      translating("## Source", "Unmarked translation</th"),
      translating("## Source", ""),
      translating("## Source", "Translated"),
      done("## Source", "Translated"),
    ],
    sent: [structuringRequest(textPart(LINES)), translationRequest("## Source")],
  },
  {
    name: "reasoning fields and keep-alive comments in the stream are not shown",
    input: "A single line",
    replies: [
      [
        { comment: "keep-alive" },
        { data: '{"choices":[{"delta":{"reasoning_content":"leaked"}}]}' },
        { comment: "OPENROUTER PROCESSING" },
        { data: '{"choices":[{"delta":{"reasoning":"leaked"}}]}' },
        { content: "Translated" },
      ],
    ],
    shown: translatedAtOnce("A single line", "Translated"),
    sent: [translationRequest("A single line")],
  },
  {
    name: "at Default effort, both streamed requests carry only the Model and the prompts, Translation's in the Target language",
    settings: customSettings({ model: "seeded-model" }, { targetLanguage: "ja" }),
    input: LINES,
    replies: [[{ content: "## Source" }], [{ content: "Translated" }]],
    shown: structuredThenTranslated("## Source", "Translated"),
    sent: [
      structuringRequest(textPart(LINES), { model: "seeded-model" }),
      translationRequest("## Source", { language: "Japanese", model: "seeded-model" }),
    ],
  },
  {
    name: "Source text already in the Target language is still translated, into English while none is stored",
    input: "The quick brown fox",
    replies: [[{ content: "The quick brown fox" }]],
    shown: translatedAtOnce("The quick brown fox", "The quick brown fox"),
    sent: [translationRequest("The quick brown fox")],
  },
  ...["low", "none"].map((reasoningEffort): PipelineRow => ({
    name: `Custom's ${reasoningEffort} effort is sent as reasoning_effort in both stages`,
    settings: customSettings({ reasoningEffort }),
    input: LINES,
    replies: [[{ content: "## Source" }], [{ content: "Translated" }]],
    shown: structuredThenTranslated("## Source", "Translated"),
    sent: [
      structuringRequest(textPart(LINES), { fields: { reasoning_effort: reasoningEffort } }),
      translationRequest("## Source", { fields: { reasoning_effort: reasoningEffort } }),
    ],
  })),
  {
    name: "OpenRouter's effort is sent as reasoning.effort",
    settings: {
      schemaVersion: 1,
      activePreset: "openrouter",
      presets: { openrouter: { model: "router-model", reasoningEffort: "high" } },
    },
    keyEnvironment: { OPENROUTER_API_KEY: "router-key" },
    input: "A single line",
    replies: [[{ content: "Translated" }]],
    shown: translatedAtOnce("A single line", "Translated"),
    sent: [
      translationRequest("A single line", {
        fields: { reasoning: { effort: "high" } },
        model: "router-model",
        url: "https://openrouter.ai/api/v1/chat/completions",
        authorization: "Bearer router-key",
      }),
    ],
  },
  {
    name: "an effort changed during a Round leaves that Round's requests unchanged",
    settings: customSettings({ reasoningEffort: "low" }),
    input: LINES,
    replies: [[{ wait: midRound.wait }, { content: "## Source" }], [{ content: "Translated" }]],
    meanwhile: async (core) => {
      await core.changeSettings(customSettings({ reasoningEffort: "high" }));
      await new Promise((resolve) => setTimeout(resolve));
      midRound.release();
    },
    shown: structuredThenTranslated("## Source", "Translated"),
    sent: [
      structuringRequest(textPart(LINES), { fields: { reasoning_effort: "low" } }),
      translationRequest("## Source", { fields: { reasoning_effort: "low" } }),
    ],
  },
  ...[
    ["https://provider.test/v1", CHAT],
    ["https://provider.test/v1/", CHAT],
    ["https://provider.test/v1///", CHAT],
    ["https://provider.test", "https://provider.test/chat/completions"],
    ["https://provider.test//", "https://provider.test/chat/completions"],
  ].map(([baseUrl, url]): PipelineRow => ({
    name: `the Base URL ${baseUrl} is used as entered without trailing slashes`,
    settings: customSettings({ baseUrl }),
    input: "A single line",
    replies: [[{ content: "Translated" }]],
    shown: translatedAtOnce("A single line", "Translated"),
    sent: [translationRequest("A single line", { url })],
  })),
];

describe("The Round's pipeline", () => {
  it.each(pipeline)("$name", async ({ settings, keyEnvironment, input, replies, meanwhile, shown, sent }) => {
    const core = await startCore({ ...(settings === undefined ? {} : { settings }), keyEnvironment });
    const published: RoundState[] = [];
    core.session.subscribe(() => {
      const state = core.session.state().round?.state;
      if (state && JSON.stringify(state) !== JSON.stringify(published.at(-1))) published.push(state);
    });
    core.provider.reply(...replies);
    await core.copy(input);
    if (meanwhile) await core.until((state) => state.round !== null).then(() => meanwhile(core));

    await core.roundEnds();
    expect(published).toEqual(shown);
    expect(core.provider.requests.map(sentAs)).toEqual(sent);
  });
});
