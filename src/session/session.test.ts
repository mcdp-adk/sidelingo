import { describe, expect, it } from "vitest";
import { customSettings, settle, startCore, type Core, type Reply, type SentRequest } from "../testing/core";

const OVERLONG = "x".repeat(10_001);
const LONGEST = "a".repeat(10_000);
const UNAVAILABLE = { status: 503, message: "Unavailable" };

/** A reply that streams `partial`, holds until `release()`, then streams `rest`. */
function held(partial: string, rest: string) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  return { reply: [{ content: partial }, { wait }, { content: rest }], release };
}

/**
 * Resolves once the shown Round has stopped running with this Translated text, and the Session has
 * finished with it: a Round's last state is published before the Session decides whether it is reusable.
 */
const shows = async (core: Core, text: string) => {
  await core.until((state) => state.round?.state.outcome !== "running" && state.round?.state.translation.text === text);
  await settle();
};

const failed = async (core: Core) => {
  await core.until((state) => state.round?.state.outcome === "failed");
  await settle();
};

const streaming = (core: Core, text: string) => core.until((state) => state.round?.state.translation.text === text);

/** Structuring's reply that keeps a one-line Input as it is, so its Translation request carries the Input. */
const kept = (input: string): Reply => [{ content: input }];

/** Each request as "Structuring: <Input>" or "<Target language>: <Source text>"; every Source text here is one line. */
const asked = ({ body }: SentRequest) => {
  const user = body.messages[1].content;
  if (Array.isArray(user)) return `Structuring: ${user[0].text}`;
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
  /** The Translated text shown at the end, or null when no Round is shown. */
  shown: string | null;
  paused?: boolean;
  overlong?: boolean;
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
    overlong: true,
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
      expect(core.session.state().round?.state.translation.text).toBe("Done");
      expect(core.provider.requests).toHaveLength(2);
      await core.hide();
      await core.show("Configured");
      await shows(core, "Japanese");
    },
    asked: [...requestsFor("Configured"), ...requestsFor("Configured", "Japanese")],
    shown: "Japanese",
  },
];

describe("The Session's Input rules", () => {
  it.each(rows)("$name", async ({ act, asked: expected, cancelled, shown, paused = false, overlong = false }) => {
    const core = await startCore({ settings: customSettings({}, { targetLanguage: "en" }) });

    await act(core);
    await settle();

    expect(core.provider.requests.map(asked)).toEqual(expected);
    if (cancelled) {
      expect(core.provider.requests.flatMap(({ signal }, index) => (signal.aborted ? [index] : []))).toEqual(cancelled);
    }
    const state = core.session.state();
    expect({
      shown: state.round?.state.translation.text ?? null,
      outcome: state.round?.state.outcome ?? null,
      paused: state.paused,
      overlong: state.overlong,
    }).toEqual({ shown, outcome: shown === null ? null : "done", paused, overlong });
  });
});
