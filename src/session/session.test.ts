import { describe, expect, it } from "vitest";
import type { Input } from "../round/round";
import type { PinContent, PinView } from "./session";
import {
  customSettings,
  ended,
  settle,
  showsError,
  startCore,
  type Core,
  type Reply,
  type SentRequest,
} from "../testing/core";

const OVERLONG = "x".repeat(10_001);
const IMAGE: Input = { kind: "image", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const LONGEST = "a".repeat(10_000);
const UNAVAILABLE = { status: 503, message: "Unavailable" };

/** A reply that streams `partial`, holds until `release()`, then streams `rest`. */
function held(partial: string, rest: string) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  return { reply: [{ content: partial }, { wait }, { content: rest }], release };
}

/** The Translated text shown, or null when no Round's panes show. */
const translated = ({ content }: PinView) => (content?.kind === "round" ? content.translation.text : null);

/**
 * Resolves once the shown Round has ended with this Translated text, and the Session has finished with it:
 * a Round's last state is published before the Session decides whether it is reusable.
 */
const shows = async (core: Core, text: string) => {
  await core.until((view) => ended(view) && translated(view) === text);
  await settle();
};

const failed = async (core: Core) => {
  await core.until(showsError);
  await settle();
};

const streaming = (core: Core, text: string) => core.until((view) => translated(view) === text);

/** Structuring's reply that keeps a one-line Input as it is, so its Translation request carries the Input. */
const kept = (input: string): Reply => [{ content: input }];

/**
 * Each request as "Structuring: <Input>", "Structuring: an image", or "<Target language>: <Source text>";
 * every Source text here is one line.
 */
const asked = ({ body }: SentRequest) => {
  const user = body.messages[1].content;
  if (Array.isArray(user)) return `Structuring: ${user[0].type === "image_url" ? "an image" : user[0].text}`;
  const [, language, source] = /^Translate to (\w+):\n[\s\S]*\n(.*)$/.exec(user)!;
  return `${language}: ${source}`;
};
const requestsFor = (input: string, language = "English") => [`Structuring: ${input}`, `${language}: ${input}`];

interface Row {
  name: string;
  /** Plays Rust's events, the Provider's replies and the user's controls. */
  act(core: Core): Promise<void>;
  /** The requests sent, in order. */
  asked: string[];
  /** Indexes of the requests whose signal the Session aborted: a Round's requests share one signal, so its finished Structuring request is listed too. (Other rows don't look.) */
  cancelled?: number[];
  /** The Translated text shown at the end, or null when no Round's panes show. */
  shown: string | null;
  /** What the panes show at the end; a fully successful Round's when absent. */
  content?: PinContent["kind"];
  paused?: boolean;
}

const rows: Row[] = [
  {
    name: "copying the same Input twice sends nothing",
    async act(core) {
      core.provider.reply(kept("Same"), [{ content: "Done" }]);
      await core.copy("Same");
      await shows(core, "Done");
      await core.copy("Same");
    },
    asked: requestsFor("Same"),
    shown: "Done",
  },
  {
    name: "a new copy cancels the Round in flight, and its later text never shows",
    async act(core) {
      const first = held("Partial", " obsolete");
      core.provider.reply(kept("First"), first.reply, kept("Second"), [{ content: "Second done" }]);
      await core.copy("First");
      await streaming(core, "Partial");
      await core.copy("Second");
      await shows(core, "Second done");
      first.release();
    },
    asked: [...requestsFor("First"), ...requestsFor("Second")],
    cancelled: [0, 1],
    shown: "Second done",
  },
  {
    name: "showing the window with the last successful Input reuses it",
    async act(core) {
      core.provider.reply(kept("Reused"), [{ content: "Done" }]);
      await core.copy("Reused");
      await shows(core, "Done");
      await core.hide();
      await core.show("Reused");
    },
    asked: requestsFor("Reused"),
    shown: "Done",
  },
  {
    name: "showing the window reuses the last successful Input after a Display mode change",
    async act(core) {
      core.provider.reply(kept("Reused"), [{ content: "Done" }]);
      await core.copy("Reused");
      await shows(core, "Done");
      await core.changeSettings(customSettings({}, { displayMode: "both" }));
      await core.hide();
      await core.show("Reused");
    },
    asked: requestsFor("Reused"),
    shown: "Done",
  },
  {
    name: "showing the window with nothing usable keeps the shown result",
    async act(core) {
      core.provider.reply(kept("Kept"), [{ content: "Done" }]);
      await core.copy("Kept");
      await shows(core, "Done");
      await core.hide();
      await core.show(null);
    },
    asked: requestsFor("Kept"),
    shown: "Done",
  },
  {
    name: "a Round still running when the window shows keeps running",
    async act(core) {
      const pending = held("Partial", " and the rest");
      core.provider.reply(kept("Running"), pending.reply);
      await core.copy("Running");
      await streaming(core, "Partial");
      await core.hide();
      await core.show("Running");
      pending.release();
      await shows(core, "Partial and the rest");
    },
    asked: requestsFor("Running"),
    shown: "Partial and the rest",
  },
  {
    name: "a Round that finishes while the window is hidden is reused",
    async act(core) {
      const pending = held("Partial", " and the rest");
      core.provider.reply(kept("Hidden"), pending.reply);
      await core.copy("Hidden");
      await streaming(core, "Partial");
      await core.hide();
      pending.release();
      await shows(core, "Partial and the rest");
      await core.show("Hidden");
    },
    asked: requestsFor("Hidden"),
    shown: "Partial and the rest",
  },
  {
    name: "showing the window with the image of the last no-text Round reuses it",
    async act(core) {
      core.provider.reply([{ content: "NO_TEXT" }]);
      await core.copy(IMAGE);
      await core.roundEnds();
      await core.hide();
      await core.show(IMAGE);
    },
    asked: ["Structuring: an image"],
    shown: null,
    content: "no-text",
  },
  {
    name: "a failed Round is not reused",
    async act(core) {
      core.provider.reply(UNAVAILABLE, kept("Failing"), [{ content: "Retried" }]);
      await core.copy("Failing");
      await failed(core);
      await core.hide();
      await core.show("Failing");
      await shows(core, "Retried");
    },
    asked: ["Structuring: Failing", ...requestsFor("Failing")],
    shown: "Retried",
  },
  {
    name: "a partial Round is not reused",
    async act(core) {
      core.provider.reply(kept("Dropping"), [{ content: "Partial" }, { drop: true }], kept("Dropping"), [
        { content: "Retried" },
      ]);
      await core.copy("Dropping");
      await failed(core);
      await core.hide();
      await core.show("Dropping");
      await shows(core, "Retried");
    },
    asked: [...requestsFor("Dropping"), ...requestsFor("Dropping")],
    shown: "Retried",
  },
  {
    name: "a pause ignores copies",
    async act(core) {
      core.provider.reply(kept("Before"), [{ content: "Done" }]);
      await core.copy("Before");
      await shows(core, "Done");
      core.session.toggleClipboardPause();
      await core.copy("Ignored");
    },
    asked: requestsFor("Before"),
    shown: "Done",
    paused: true,
  },
  {
    name: "hiding the window resets a pause",
    async act(core) {
      core.provider.reply(kept("Before"), [{ content: "Done" }], kept("After"), [{ content: "Followed" }]);
      await core.copy("Before");
      await shows(core, "Done");
      core.session.toggleClipboardPause();
      await core.hide();
      await core.copy("After");
      await shows(core, "Followed");
    },
    asked: [...requestsFor("Before"), ...requestsFor("After")],
    shown: "Followed",
  },
  {
    name: "an Input of exactly 10,000 characters starts at once",
    async act(core) {
      core.provider.reply(kept(LONGEST), [{ content: "Done" }]);
      await core.copy(LONGEST);
      await shows(core, "Done");
    },
    asked: requestsFor(LONGEST),
    shown: "Done",
  },
  {
    name: "an Input over 10,000 characters waits for Process anyway, clearing the shown result",
    async act(core) {
      core.provider.reply(kept("Short"), [{ content: "Done" }]);
      await core.copy("Short");
      await shows(core, "Done");
      await core.copy(OVERLONG);
    },
    asked: requestsFor("Short"),
    shown: null,
    content: "overlong",
  },
  {
    name: "Process anyway runs an Input over 10,000 characters",
    async act(core) {
      core.provider.reply(kept(OVERLONG), [{ content: "Processed" }]);
      await core.copy(OVERLONG);
      // The Pin window's Process anyway is Regenerate on the waiting Input.
      core.session.regenerate();
      await shows(core, "Processed");
    },
    asked: requestsFor(OVERLONG),
    shown: "Processed",
  },
  {
    name: "a new copy replaces an Input waiting for Process anyway",
    async act(core) {
      core.provider.reply(kept("Next"), [{ content: "Followed" }]);
      await core.copy(OVERLONG);
      await core.copy("Next");
      await shows(core, "Followed");
    },
    asked: requestsFor("Next"),
    shown: "Followed",
  },
  {
    name: "Regenerate reruns a reused Round",
    async act(core) {
      core.provider.reply(kept("Again"), [{ content: "Original" }], kept("Again"), [{ content: "Regenerated" }]);
      await core.copy("Again");
      await shows(core, "Original");
      await core.hide();
      await core.show("Again");
      core.session.regenerate();
      await shows(core, "Regenerated");
    },
    asked: [...requestsFor("Again"), ...requestsFor("Again")],
    shown: "Regenerated",
  },
  {
    name: "Regenerate cancels the Round in flight and reruns its Input",
    async act(core) {
      const first = held("Partial", " obsolete");
      core.provider.reply(kept("Again"), first.reply, kept("Again"), [{ content: "Regenerated" }]);
      await core.copy("Again");
      await streaming(core, "Partial");
      core.session.regenerate();
      await shows(core, "Regenerated");
      first.release();
    },
    asked: [...requestsFor("Again"), ...requestsFor("Again")],
    cancelled: [0, 1],
    shown: "Regenerated",
  },
  {
    name: "Regenerate retries after a failure",
    async act(core) {
      core.provider.reply(UNAVAILABLE, kept("Failing"), [{ content: "Retried" }]);
      await core.copy("Failing");
      await failed(core);
      core.session.regenerate();
      await shows(core, "Retried");
    },
    asked: ["Structuring: Failing", ...requestsFor("Failing")],
    shown: "Retried",
  },
  {
    name: "a failed Regenerate leaves the earlier success not reusable",
    async act(core) {
      core.provider.reply(kept("Again"), [{ content: "Original" }], UNAVAILABLE, kept("Again"), [{ content: "Rerun" }]);
      await core.copy("Again");
      await shows(core, "Original");
      core.session.regenerate();
      await failed(core);
      await core.hide();
      await core.show("Again");
      await shows(core, "Rerun");
    },
    asked: [...requestsFor("Again"), "Structuring: Again", ...requestsFor("Again")],
    shown: "Rerun",
  },
  {
    name: "a configuration change during a Round lets it finish but makes it not reusable",
    async act(core) {
      const pending = held("Partial", " and the rest");
      core.provider.reply(kept("Configured"), pending.reply, kept("Configured"), [{ content: "Japanese" }]);
      await core.copy("Configured");
      await streaming(core, "Partial");
      await core.changeSettings(customSettings({}, { targetLanguage: "ja" }));
      await settle();
      expect(core.provider.requests).toHaveLength(2);
      pending.release();
      await shows(core, "Partial and the rest");
      await core.hide();
      await core.show("Configured");
      await shows(core, "Japanese");
    },
    asked: [...requestsFor("Configured"), ...requestsFor("Configured", "Japanese")],
    shown: "Japanese",
  },
  {
    name: "a configuration change keeps the shown result but makes it not reusable",
    async act(core) {
      core.provider.reply(kept("Configured"), [{ content: "Done" }], kept("Configured"), [{ content: "Japanese" }]);
      await core.copy("Configured");
      await shows(core, "Done");
      await core.changeSettings(customSettings({}, { targetLanguage: "ja" }));
      await settle();
      expect(translated(core.session.view())).toBe("Done");
      expect(core.provider.requests).toHaveLength(2);
      await core.hide();
      await core.show("Configured");
      await shows(core, "Japanese");
    },
    asked: [...requestsFor("Configured"), ...requestsFor("Configured", "Japanese")],
    shown: "Japanese",
  },
  {
    name: "a copy right after a configuration change runs with the new configuration",
    async act(core) {
      core.provider.reply(kept("Fresh"), [{ content: "Japanese" }]);
      await core.changeSettings(customSettings({}, { targetLanguage: "ja" }));
      await core.copy("Fresh");
      await shows(core, "Japanese");
    },
    asked: requestsFor("Fresh", "Japanese"),
    shown: "Japanese",
  },
  {
    name: "after the configuration is fixed under its notice, copying the same line again runs a Round (#112)",
    async act(core) {
      core.provider.reply(kept("Unconfigured"), [{ content: "Fixed" }]);
      await core.changeSettings({ schemaVersion: 1 });
      await core.copy("Unconfigured");
      await core.until((view) => view.configurationFailure !== null);
      await core.changeSettings(customSettings({}, { targetLanguage: "en" }));
      await settle();
      expect(core.provider.requests).toEqual([]);
      await core.copy("Unconfigured");
      await shows(core, "Fixed");
    },
    asked: requestsFor("Unconfigured"),
    shown: "Fixed",
  },
];

describe("The Session's Input rules", () => {
  it.each(rows)("$name", async ({ act, asked: expected, cancelled, shown, content = "round", paused = false }) => {
    const core = await startCore({ settings: customSettings({}, { targetLanguage: "en" }) });

    await act(core);
    await settle();

    expect(core.provider.requests.map(asked)).toEqual(expected);
    if (cancelled) {
      expect(core.provider.requests.flatMap(({ signal }, index) => (signal.aborted ? [index] : []))).toEqual(cancelled);
    }
    const view = core.session.view();
    // A shown Round finished in full: its Translation can be copied.
    expect({
      shown: translated(view),
      content: view.content?.kind,
      copyable: view.canCopyTranslation,
      paused: view.paused,
    }).toEqual({ shown, content, copyable: content === "round", paused });
  });
});

interface ViewRow {
  name: string;
  /** The stored settings document; a Custom Preset when absent. */
  settings?: unknown;
  /** Plays Rust's events and the Provider's replies. */
  act(core: Core): Promise<void>;
  /** The Pin view at the end. */
  view: PinView;
}

const viewRows: ViewRow[] = [
  {
    name: "before any Input, the window shows the empty hint and offers neither Regenerate nor a copy",
    async act() {},
    view: {
      roundId: null,
      configurationFailure: null,
      content: { kind: "hint" },
      paused: false,
      canRegenerate: false,
      canCopySource: false,
      canCopyTranslation: false,
    },
  },
  {
    name: "an Input over 10,000 characters shows the overlong notice and offers Regenerate, not a copy",
    async act(core) {
      await core.copy(OVERLONG);
    },
    view: {
      roundId: null,
      configurationFailure: null,
      content: { kind: "overlong" },
      paused: false,
      canRegenerate: true,
      canCopySource: false,
      canCopyTranslation: false,
    },
  },
  {
    name: "a configuration failure with no Round shows only its notice, not the empty hint",
    settings: { schemaVersion: 1 },
    async act(core) {
      await core.copy("Unconfigured");
      await core.until((view) => view.configurationFailure !== null);
    },
    view: {
      roundId: null,
      configurationFailure: { kind: "no-provider" },
      content: null,
      paused: false,
      canRegenerate: true,
      canCopySource: false,
      canCopyTranslation: false,
    },
  },
  {
    name: "under a notice, a change outside the Round configuration sends nothing and keeps the notice",
    settings: { schemaVersion: 1 },
    async act(core) {
      await core.copy("Unconfigured");
      await core.until((view) => view.configurationFailure !== null);
      await core.changeSettings({ schemaVersion: 1, displayMode: "both" });
      await settle();
      expect(core.provider.requests).toEqual([]);
    },
    view: {
      roundId: null,
      configurationFailure: { kind: "no-provider" },
      content: null,
      paused: false,
      canRegenerate: true,
      canCopySource: false,
      canCopyTranslation: false,
    },
  },
  {
    name: "a Round configuration change clears the notice its advice no longer fits, and sends nothing",
    settings: { schemaVersion: 1 },
    async act(core) {
      await core.copy("Unconfigured");
      await core.until((view) => view.configurationFailure !== null);
      await core.changeSettings(customSettings({ model: "" }));
      await core.until((view) => view.configurationFailure === null);
      await settle();
      expect(core.provider.requests).toEqual([]);
    },
    view: {
      roundId: null,
      configurationFailure: null,
      content: { kind: "hint" },
      paused: false,
      canRegenerate: true,
      canCopySource: false,
      canCopyTranslation: false,
    },
  },
  {
    name: "a configuration failure after a Round keeps that Round under its notice, still copyable",
    async act(core) {
      core.provider.reply(kept("Earlier"), [{ content: "Done" }]);
      await core.copy("Earlier");
      await shows(core, "Done");
      await core.changeSettings({ schemaVersion: 1 });
      await core.copy("Unconfigured");
      await core.until((view) => view.configurationFailure !== null);
    },
    view: {
      roundId: expect.any(Number),
      configurationFailure: { kind: "no-provider" },
      content: {
        kind: "round",
        source: { text: "Earlier", progress: null, error: null },
        translation: { text: "Done", progress: null, error: null, mutedSource: null },
      },
      paused: false,
      canRegenerate: true,
      canCopySource: true,
      canCopyTranslation: true,
    },
  },
];

describe("What the Pin window shows", () => {
  it.each(viewRows)("$name", async ({ settings, act, view }) => {
    const core = await startCore(settings === undefined ? {} : { settings });

    await act(core);
    await settle();

    expect(core.session.view()).toEqual(view);
  });
});
