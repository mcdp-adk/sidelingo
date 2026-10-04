import { afterEach, describe, expect, it, vi } from "vitest";
import { customSettings, startCore, type Core, type SentRequest } from "../testing/core";

const OVERLONG = "x".repeat(10_001);
const LONGEST = "a".repeat(10_000);
const UNAVAILABLE = { status: 503, message: "Unavailable" };

/** A reply that streams `partial`, holds until `release()`, then streams `rest`. */
function held(partial: string, rest: string) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  return { reply: [{ content: partial }, { wait }, { content: rest }], release };
}

/** Lets anything the Session does next happen, such as a request it shouldn't send. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

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

/** Each request as "<Target language>: <Input>"; every Input here is one line, so a Round sends one request. */
const asked = ({ body }: SentRequest) => {
  const [, language, input] = /^Translate to (\w+):\n[\s\S]*\n(.*)$/.exec(body.messages[1].content)!;
  return `${language}: ${input}`;
};

interface Row {
  name: string;
  /** Plays Rust's events, the Provider's replies and the user's controls. */
  act(core: Core): Promise<void>;
  /** The requests sent, in order. */
  asked: string[];
  /** Indexes of the requests the Session cancelled mid-stream. (A finished request's signal may abort too, so other rows don't look.) */
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
      core.provider.reply([{ content: "Done" }]);
      await core.copy("Same");
      await shows(core, "Done");
      await core.copy("Same");
    },
    asked: ["English: Same"],
    shown: "Done",
  },
  {
    name: "a new copy cancels the Round in flight, and its later text never shows",
    async act(core) {
      const first = held("Partial", " obsolete");
      core.provider.reply(first.reply, [{ content: "Second done" }]);
      await core.copy("First");
      await streaming(core, "Partial");
      await core.copy("Second");
      await shows(core, "Second done");
      first.release();
    },
    asked: ["English: First", "English: Second"],
    cancelled: [0],
    shown: "Second done",
  },
  {
    name: "showing the window with the last successful Input reuses it",
    async act(core) {
      core.provider.reply([{ content: "Done" }]);
      await core.copy("Reused");
      await shows(core, "Done");
      await core.hide();
      await core.show("Reused");
    },
    asked: ["English: Reused"],
    shown: "Done",
  },
  {
    name: "showing the window reuses the last successful Input after a Display mode change",
    async act(core) {
      core.provider.reply([{ content: "Done" }]);
      await core.copy("Reused");
      await shows(core, "Done");
      await core.changeSettings(customSettings({}, { displayMode: "both" }));
      await core.hide();
      await core.show("Reused");
    },
    asked: ["English: Reused"],
    shown: "Done",
  },
  {
    name: "showing the window with nothing usable keeps the shown result",
    async act(core) {
      core.provider.reply([{ content: "Done" }]);
      await core.copy("Kept");
      await shows(core, "Done");
      await core.hide();
      await core.show(null);
    },
    asked: ["English: Kept"],
    shown: "Done",
  },
  {
    name: "a Round still running when the window shows keeps running",
    async act(core) {
      const round = held("Partial", " and the rest");
      core.provider.reply(round.reply);
      await core.copy("Running");
      await streaming(core, "Partial");
      await core.hide();
      await core.show("Running");
      round.release();
      await shows(core, "Partial and the rest");
    },
    asked: ["English: Running"],
    shown: "Partial and the rest",
  },
  {
    name: "a Round that finishes while the window is hidden is reused",
    async act(core) {
      const round = held("Partial", " and the rest");
      core.provider.reply(round.reply);
      await core.copy("Hidden");
      await streaming(core, "Partial");
      await core.hide();
      round.release();
      await shows(core, "Partial and the rest");
      await core.show("Hidden");
    },
    asked: ["English: Hidden"],
    shown: "Partial and the rest",
  },
  {
    name: "a failed Round is not reused",
    async act(core) {
      core.provider.reply(UNAVAILABLE, [{ content: "Retried" }]);
      await core.copy("Failing");
      await failed(core);
      await core.hide();
      await core.show("Failing");
      await shows(core, "Retried");
    },
    asked: ["English: Failing", "English: Failing"],
    shown: "Retried",
  },
  {
    name: "a partial Round is not reused",
    async act(core) {
      core.provider.reply([{ content: "Partial" }, { drop: true }], [{ content: "Retried" }]);
      await core.copy("Dropping");
      await failed(core);
      await core.hide();
      await core.show("Dropping");
      await shows(core, "Retried");
    },
    asked: ["English: Dropping", "English: Dropping"],
    shown: "Retried",
  },
  {
    name: "a pause ignores copies",
    async act(core) {
      core.provider.reply([{ content: "Done" }]);
      await core.copy("Before");
      await shows(core, "Done");
      core.session.toggleClipboardPause();
      await core.copy("Ignored");
    },
    asked: ["English: Before"],
    shown: "Done",
    paused: true,
  },
  {
    name: "hiding the window resets a pause",
    async act(core) {
      core.provider.reply([{ content: "Done" }], [{ content: "Followed" }]);
      await core.copy("Before");
      await shows(core, "Done");
      core.session.toggleClipboardPause();
      await core.hide();
      await core.copy("After");
      await shows(core, "Followed");
    },
    asked: ["English: Before", "English: After"],
    shown: "Followed",
  },
  {
    name: "an Input of exactly 10,000 characters starts at once",
    async act(core) {
      core.provider.reply([{ content: "Done" }]);
      await core.copy(LONGEST);
      await shows(core, "Done");
    },
    asked: [`English: ${LONGEST}`],
    shown: "Done",
  },
  {
    name: "an Input over 10,000 characters waits for Process anyway, clearing the shown result",
    async act(core) {
      core.provider.reply([{ content: "Done" }]);
      await core.copy("Short");
      await shows(core, "Done");
      await core.copy(OVERLONG);
    },
    asked: ["English: Short"],
    shown: null,
    overlong: true,
  },
  {
    name: "Process anyway runs an Input over 10,000 characters",
    async act(core) {
      core.provider.reply([{ content: "Processed" }]);
      await core.copy(OVERLONG);
      // The Pin window's Process anyway is Regenerate on the waiting Input.
      core.session.regenerate();
      await shows(core, "Processed");
    },
    asked: [`English: ${OVERLONG}`],
    shown: "Processed",
  },
  {
    name: "a new copy replaces an Input waiting for Process anyway",
    async act(core) {
      core.provider.reply([{ content: "Followed" }]);
      await core.copy(OVERLONG);
      await core.copy("Next");
      await shows(core, "Followed");
    },
    asked: ["English: Next"],
    shown: "Followed",
  },
  {
    name: "Regenerate reruns a reused Round",
    async act(core) {
      core.provider.reply([{ content: "Original" }], [{ content: "Regenerated" }]);
      await core.copy("Again");
      await shows(core, "Original");
      await core.hide();
      await core.show("Again");
      core.session.regenerate();
      await shows(core, "Regenerated");
    },
    asked: ["English: Again", "English: Again"],
    shown: "Regenerated",
  },
  {
    name: "Regenerate cancels the Round in flight and reruns its Input",
    async act(core) {
      const first = held("Partial", " obsolete");
      core.provider.reply(first.reply, [{ content: "Regenerated" }]);
      await core.copy("Again");
      await streaming(core, "Partial");
      core.session.regenerate();
      await shows(core, "Regenerated");
      first.release();
    },
    asked: ["English: Again", "English: Again"],
    cancelled: [0],
    shown: "Regenerated",
  },
  {
    name: "Regenerate retries after a failure",
    async act(core) {
      core.provider.reply(UNAVAILABLE, [{ content: "Retried" }]);
      await core.copy("Failing");
      await failed(core);
      core.session.regenerate();
      await shows(core, "Retried");
    },
    asked: ["English: Failing", "English: Failing"],
    shown: "Retried",
  },
  {
    name: "a failed Regenerate leaves the earlier success not reusable",
    async act(core) {
      core.provider.reply([{ content: "Original" }], UNAVAILABLE, [{ content: "Rerun" }]);
      await core.copy("Again");
      await shows(core, "Original");
      core.session.regenerate();
      await failed(core);
      await core.hide();
      await core.show("Again");
      await shows(core, "Rerun");
    },
    asked: ["English: Again", "English: Again", "English: Again"],
    shown: "Rerun",
  },
  {
    name: "a configuration change during a Round lets it finish but makes it not reusable",
    async act(core) {
      const round = held("Partial", " and the rest");
      core.provider.reply(round.reply, [{ content: "Japanese" }]);
      await core.copy("Configured");
      await streaming(core, "Partial");
      await core.changeSettings(customSettings({}, { targetLanguage: "ja" }));
      await settle();
      expect(core.provider.requests).toHaveLength(1);
      round.release();
      await shows(core, "Partial and the rest");
      await core.hide();
      await core.show("Configured");
      await shows(core, "Japanese");
    },
    asked: ["English: Configured", "Japanese: Configured"],
    shown: "Japanese",
  },
  {
    name: "a configuration change keeps the shown result but makes it not reusable",
    async act(core) {
      core.provider.reply([{ content: "Done" }], [{ content: "Japanese" }]);
      await core.copy("Configured");
      await shows(core, "Done");
      await core.changeSettings(customSettings({}, { targetLanguage: "ja" }));
      await settle();
      expect(core.session.state().round?.state.translation.text).toBe("Done");
      expect(core.provider.requests).toHaveLength(1);
      await core.hide();
      await core.show("Configured");
      await shows(core, "Japanese");
    },
    asked: ["English: Configured", "Japanese: Configured"],
    shown: "Japanese",
  },
];

describe("The Session's Input rules", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(rows)("$name", async ({ act, asked: expected, cancelled, shown, paused = false, overlong = false }) => {
    // A cancelled Round leaves no error behind, not even in the log.
    const logged = vi.spyOn(console, "error");
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
    expect(logged).not.toHaveBeenCalled();
  });
});
