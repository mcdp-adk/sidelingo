import { describe, expect, it } from "vitest";
import type { Input, RoundError } from "./round";
import type { PinContent, PinPane, PinView } from "../session/session";
import { customSettings, startCore, type Core, type Reply, type SentRequest } from "../testing/core";

const IMAGE: Input = { kind: "image", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const LINES = "A wrapped line\ncontinues here";
const EMPTY = "The Provider returned an empty response.";
/** Structuring's reply for "A single line" that keeps it as it is. */
const LINE_STRUCTURED: Reply = [{ content: "A single line" }];
const DROPPED = "The connection dropped.";

/** What the Pin window shows of a Round: its panes, and which of them can be copied. */
interface Shown {
  content: PinContent | null;
  canCopySource: boolean;
  canCopyTranslation: boolean;
}
const shownIn = ({ content, canCopySource, canCopyTranslation }: PinView): Shown => ({
  content,
  canCopySource,
  canCopyTranslation,
});

const pane = (text: string, rest: Partial<PinPane> = {}): PinPane => ({ text, progress: null, error: null, ...rest });
/** A shown Round's panes; the Translation pane shows `mutedSource` muted when shown alone. */
const roundOf = (source: PinPane, translation: PinPane, mutedSource: string | null = null): PinContent => ({
  kind: "round",
  source,
  translation: { ...translation, mutedSource },
});

interface Row {
  name: string;
  input: Input | string;
  /** The Custom Preset's reasoning effort; Default when absent. */
  reasoningEffort?: string;
  replies: Reply[];
  shown: Shown;
}

/**
 * Structuring fails: whatever streamed stays in Source, the error shows in both panes, Translation never starts,
 * and nothing can be copied.
 */
function structuringFails(row: { name: string; input: Input | string; reasoningEffort?: string; reply: Reply }) {
  return (error: Omit<RoundError, "stage">, streamed = ""): Row => {
    const failure = { stage: "structuring", ...error } as const;
    return {
      ...row,
      replies: [row.reply],
      shown: {
        content: roundOf(pane(streamed, { error: failure }), pane("", { error: failure }), streamed || null),
        canCopySource: false,
        canCopyTranslation: false,
      },
    };
  };
}

/**
 * Translation fails: the completed Source text stays and can be copied, and whatever streamed stays in Translation,
 * which can't be.
 */
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
      shown: {
        content: roundOf(pane(row.source), pane(streamed, { error: failure }), streamed ? null : row.source),
        canCopySource: true,
        canCopyTranslation: false,
      },
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
    replies: [LINE_STRUCTURED, { status: 400, message: "Unsupported effort" }],
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
    replies: [LINE_STRUCTURED, { status: 400, message: "Rejected" }],
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
      replies: [LINE_STRUCTURED, { status, message: `Refused ${status}` }],
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
    replies: [LINE_STRUCTURED, [{ content: "Partial translation" }, { drop: true }]],
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
  it.each(rows)("$name", async ({ input, reasoningEffort, replies, shown }) => {
    const core = await startCore({ settings: customSettings(reasoningEffort ? { reasoningEffort } : {}) });
    core.provider.reply(...replies);
    await core.copy(input);

    expect(shownIn(await core.roundEnds())).toEqual(shown);
    // Nothing more is sent after a failure: Translation never starts once Structuring fails.
    expect(core.provider.requests).toHaveLength(replies.length);
  });
});

/**
 * What the Pin window shows as a Round runs, from the panes' text. A pane with no text yet shows the stage's status
 * line, and the Translation pane shows streamed Source text muted until Translated text arrives.
 */
/** Structuring has started and nothing has streamed: both panes show its status line. */
const structuringStarts: Shown = {
  content: roundOf(pane("", { progress: "structuring" }), pane("", { progress: "structuring" })),
  canCopySource: false,
  canCopyTranslation: false,
};
const structuring = (source: string): Shown => ({
  content: roundOf(pane(source), pane("", { progress: "structuring" }), source),
  canCopySource: false,
  canCopyTranslation: false,
});
const translationStarts = (source: string): Shown => ({
  content: roundOf(pane(source), pane("", { progress: "translating" }), source),
  canCopySource: true,
  canCopyTranslation: false,
});
const translating = (source: string, translation: string): Shown => ({
  content: roundOf(pane(source), pane(translation)),
  canCopySource: true,
  canCopyTranslation: false,
});
const done = (source: string, translation: string): Shown => ({
  content: roundOf(pane(source), pane(translation)),
  canCopySource: true,
  canCopyTranslation: true,
});
/** A Source text streamed in one chunk, then translated in one chunk. */
const structuredThenTranslated = (source: string, translation: string) => [
  structuringStarts,
  structuring(source),
  translationStarts(source),
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
      { role: "system", content: expect.stringMatching(/^You lay out an Input as Source text /) },
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
  /** Everything distinct the Pin window shows of the Round, in order. */
  shown: Shown[];
  /** What each request carried, in order. */
  sent: ReturnType<typeof structuringRequest>[];
}

/** Each named Preset with its chat endpoint, its launch key variable and how it sends a `high` effort. */
const NAMED_PRESETS = [
  ["openai", "https://api.openai.com/v1/chat/completions", "OPENAI_API_KEY", { reasoning_effort: "high" }],
  [
    "openrouter",
    "https://openrouter.ai/api/v1/chat/completions",
    "OPENROUTER_API_KEY",
    { reasoning: { effort: "high" } },
  ],
  ["deepseek", "https://api.deepseek.com/chat/completions", "DEEPSEEK_API_KEY", { reasoning_effort: "high" }],
  ["ollama-cloud", "https://ollama.com/v1/chat/completions", "OLLAMA_API_KEY", { reasoning_effort: "high" }],
] as const;
/** Every named Preset's launch key, each a different value. */
const LAUNCH_KEYS = Object.fromEntries(NAMED_PRESETS.map(([, , variable]) => [variable, `key-in-${variable}`]));

const pipeline: PipelineRow[] = [
  {
    name: "a single line sends a Structuring request, then a Translation request of its Structuring result",
    input: "  `npm run build`  ",
    replies: [[{ content: "```sh\nnpm run build\n```" }], [{ content: "Translated" }]],
    shown: structuredThenTranslated("```sh\nnpm run build\n```", "Translated"),
    sent: [structuringRequest(textPart("`npm run build`")), translationRequest("```sh\nnpm run build\n```")],
  },
  {
    name: "multi-line text streams Structuring, then one Translation of the complete Source text",
    input: LINES,
    replies: [[{ content: "## Clean" }, { content: "\nwith the rest" }], [{ content: "Translated" }]],
    shown: [
      structuringStarts,
      structuring("## Clean"),
      structuring("## Clean\nwith the rest"),
      translationStarts("## Clean\nwith the rest"),
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
    shown: [structuringStarts, { content: { kind: "no-text" }, canCopySource: false, canCopyTranslation: false }],
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
      structuringStarts,
      structuring("Unmarked structure"),
      structuring("Unmarked structure</th"),
      structuringStarts,
      structuring("## Source"),
      translationStarts("## Source"),
      translating("## Source", "Unmarked translation"),
      translating("## Source", "Unmarked translation</th"),
      translationStarts("## Source"),
      translating("## Source", "Translated"),
      done("## Source", "Translated"),
    ],
    sent: [structuringRequest(textPart(LINES)), translationRequest("## Source")],
  },
  {
    name: "reasoning fields and keep-alive comments in the stream are not shown",
    input: "A single line",
    replies: [
      LINE_STRUCTURED,
      [
        { comment: "keep-alive" },
        { data: '{"choices":[{"delta":{"reasoning_content":"leaked"}}]}' },
        { comment: "OPENROUTER PROCESSING" },
        { data: '{"choices":[{"delta":{"reasoning":"leaked"}}]}' },
        { content: "Translated" },
      ],
    ],
    shown: structuredThenTranslated("A single line", "Translated"),
    sent: [structuringRequest(textPart("A single line")), translationRequest("A single line")],
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
    replies: [[{ content: "The quick brown fox" }], [{ content: "The quick brown fox" }]],
    shown: structuredThenTranslated("The quick brown fox", "The quick brown fox"),
    sent: [structuringRequest(textPart("The quick brown fox")), translationRequest("The quick brown fox")],
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
  ...NAMED_PRESETS.map(([preset, url, variable, fields]): PipelineRow => {
    const request = { fields, model: "named-model", url, authorization: `Bearer key-in-${variable}` };
    return {
      name: `${preset} sends both stages to its own endpoint, with its own launch key and its effort field`,
      settings: {
        schemaVersion: 1,
        activePreset: preset,
        presets: { [preset]: { model: "named-model", reasoningEffort: "high" } },
      },
      // Every named Preset's key is set, so each must pick its own.
      keyEnvironment: LAUNCH_KEYS,
      input: "A single line",
      replies: [LINE_STRUCTURED, [{ content: "Translated" }]],
      shown: structuredThenTranslated("A single line", "Translated"),
      sent: [structuringRequest(textPart("A single line"), request), translationRequest("A single line", request)],
    };
  }),
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
    replies: [LINE_STRUCTURED, [{ content: "Translated" }]],
    shown: structuredThenTranslated("A single line", "Translated"),
    sent: [structuringRequest(textPart("A single line"), { url }), translationRequest("A single line", { url })],
  })),
];

describe("The Round's pipeline", () => {
  it.each(pipeline)("$name", async ({ settings, keyEnvironment, input, replies, meanwhile, shown, sent }) => {
    const core = await startCore({ ...(settings === undefined ? {} : { settings }), keyEnvironment });
    const published: Shown[] = [];
    core.session.subscribe(() => {
      const view = core.session.view();
      const shown = shownIn(view);
      if (view.roundId !== null && JSON.stringify(shown) !== JSON.stringify(published.at(-1))) published.push(shown);
    });
    core.provider.reply(...replies);
    await core.copy(input);
    if (meanwhile) await core.until((view) => view.roundId !== null).then(() => meanwhile(core));

    await core.roundEnds();
    expect(published).toEqual(shown);
    expect(core.provider.requests.map(sentAs)).toEqual(sent);
  });
});
