import { afterEach, describe, expect, it, vi } from "vitest";

const DAY = 24 * 60 * 60 * 1_000;

/** Lets the core finish what a timer started, such as a check and the status it publishes. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

interface Row {
  name: string;
  /** Whether automatic checks are on in the stored document. */
  automaticUpdates: boolean;
  /** Whether the updater's check fails, as it does with no network. */
  checkFails?: boolean;
  /** Whether the user switches automatic checks off once the window has started. */
  switchOff?: boolean;
  /** Checks the updater was asked for at startup, just before a day has passed, and just after. */
  checks: [number, number, number];
}

const rows: Row[] = [
  { name: "checks at startup and again once a day has passed", automaticUpdates: true, checks: [1, 1, 2] },
  {
    name: "a failed automatic check shows no error, and the next day checks again",
    automaticUpdates: true,
    checkFails: true,
    checks: [1, 1, 2],
  },
  {
    name: "switching automatic checks off stops the check a day brings",
    automaticUpdates: true,
    switchOff: true,
    checks: [1, 1, 1],
  },
  {
    name: "with automatic checks off, nothing checks at startup or a day later",
    automaticUpdates: false,
    checks: [0, 0, 0],
  },
];

describe("Automatic update checks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it.each(rows)("$name", async ({ automaticUpdates, checkFails = false, switchOff = false, checks }) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // Each row starts a fresh Pin webview, with no check left over from another row.
    vi.resetModules();
    const harness = await import("../testing/core");
    const document = harness.customSettings({}, { automaticUpdates });
    const core = await harness.startCore({
      settings: document,
      commands: {
        "plugin:updater|check": () => {
          if (checkFails) throw new Error("error sending request");
          return null;
        },
      },
    });
    const checked = () => core.invoked.filter(({ command }) => command === "plugin:updater|check").length;

    await settle();
    const atStartup = checked();
    if (switchOff) await core.changeSettings({ ...document, automaticUpdates: false });
    await vi.advanceTimersByTimeAsync(DAY - 1_000);
    await settle();
    const beforeADay = checked();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect([atStartup, beforeADay, checked()]).toEqual(checks);
    // Each finished check publishes its result to the settings window, without an error even when it failed.
    const results = core.updateStatuses.filter(({ checking }) => !checking);
    expect(results.map(({ checkError }) => checkError)).toEqual(Array(checks[2]).fill(null));
  });
});
