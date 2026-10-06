import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigurationFailure } from "./settings";
import { customSettings, ended, settle, startCore, type Reply } from "../testing/core";

/** A ciphertext `unprotect_secret` can't decrypt for this Windows user. */
const UNDECRYPTABLE = "bm90LWEtRFBBUEktY2lwaGVydGV4dA==";
const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions";
const CUSTOM_CHAT = "https://provider.test/v1/chat/completions";
const LINE = "A single line";
/** Structuring's reply that keeps `LINE` as it is. */
const LINE_KEPT: Reply = [{ content: LINE }];

/** What one copy leads to: the readiness failure the Session publishes, or the request it sends. */
type Outcome = { failure: ConfigurationFailure } | { sent: { url: string; authorization: string | null } };

/**
 * Copies a line, which Structuring keeps as it is, and waits until the Session either publishes a readiness failure or ends the Round.
 * `afterCopy` runs once the copy has been delivered.
 */
async function copyOnce(
  core: Awaited<ReturnType<typeof startCore>>,
  afterCopy?: () => Promise<void>,
): Promise<Outcome> {
  core.provider.reply(LINE_KEPT, [{ content: "Translated" }]);
  await core.copy(LINE);
  await afterCopy?.();
  const view = await core.until((view) => view.configurationFailure !== null || ended(view));
  await settle();
  if (view.configurationFailure) {
    expect(core.provider.requests).toEqual([]);
    return { failure: view.configurationFailure };
  }
  expect(core.provider.requests).toHaveLength(2);
  const { url, headers } = core.provider.requests[1]!;
  return { sent: { url, authorization: headers.get("authorization") } };
}

const openai = (openai: Record<string, unknown>) => ({ schemaVersion: 1, activePreset: "openai", presets: { openai } });

interface ReadinessRow {
  name: string;
  settings: unknown;
  keyEnvironment?: Record<string, string>;
  secrets?: Record<string, string>;
  /**
   * A document Rust writes just before the copy. Its saved key `ciphertext` is still decrypting when
   * the Input arrives, and decrypts to `key` only after it.
   */
  changedTo?: { settings: unknown; ciphertext: string; key: string };
  outcome: Outcome;
}

const readiness: ReadinessRow[] = [
  {
    name: "no active Preset asks the user to choose a Provider, even with a named launch key",
    settings: { schemaVersion: 1 },
    keyEnvironment: { OPENAI_API_KEY: "launch-key" },
    outcome: { failure: { kind: "no-provider" } },
  },
  {
    name: "a Custom Preset without a Model names the Model",
    settings: customSettings({ model: "" }),
    outcome: { failure: { kind: "missing-model" } },
  },
  {
    name: "a Custom Preset without a Base URL names the Base URL",
    settings: customSettings({ baseUrl: "" }),
    outcome: { failure: { kind: "missing-base-url" } },
  },
  {
    name: "a missing Model is named before a missing key",
    settings: openai({ model: "" }),
    outcome: { failure: { kind: "missing-model" } },
  },
  {
    name: "an unset launch key is named when no key is saved",
    settings: openai({ model: "gpt-test" }),
    outcome: { failure: { kind: "missing-key", cause: "environment-unset", variable: "OPENAI_API_KEY" } },
  },
  {
    name: "a saved key that can't be decrypted is named, even with a launch key",
    settings: openai({ model: "gpt-test", keyCiphertext: UNDECRYPTABLE }),
    keyEnvironment: { OPENAI_API_KEY: "launch-key" },
    outcome: {
      failure: { kind: "missing-key", cause: "saved-key-could-not-decrypt", variable: "OPENAI_API_KEY" },
    },
  },
  {
    name: "Custom never runs keyless when its saved key can't be decrypted",
    settings: customSettings({ keyCiphertext: UNDECRYPTABLE }),
    outcome: { failure: { kind: "missing-key", cause: "saved-key-could-not-decrypt", variable: null } },
  },
  {
    name: "a named launch key is used when no key is saved",
    settings: openai({ model: "gpt-test" }),
    keyEnvironment: { OPENAI_API_KEY: "launch-key" },
    outcome: { sent: { url: OPENAI_CHAT, authorization: "Bearer launch-key" } },
  },
  {
    name: "a saved key that decrypts is used instead of the launch key",
    settings: openai({ model: "gpt-test", keyCiphertext: "saved-ciphertext" }),
    keyEnvironment: { OPENAI_API_KEY: "launch-key" },
    secrets: { "saved-ciphertext": "saved-key" },
    outcome: { sent: { url: OPENAI_CHAT, authorization: "Bearer saved-key" } },
  },
  {
    name: "Custom with a saved key that decrypts sends it",
    settings: customSettings({ keyCiphertext: "saved-ciphertext" }),
    secrets: { "saved-ciphertext": "saved-key" },
    outcome: { sent: { url: CUSTOM_CHAT, authorization: "Bearer saved-key" } },
  },
  {
    name: "Custom with no key saved runs keyless",
    settings: customSettings(),
    outcome: { sent: { url: CUSTOM_CHAT, authorization: null } },
  },
  {
    name: "a changed document applies to an Input that arrives at once after it, before the store has published it",
    settings: customSettings(),
    changedTo: {
      settings: customSettings({ baseUrl: "https://next.test/v1", keyCiphertext: "next-ciphertext" }),
      ciphertext: "next-ciphertext",
      key: "next-key",
    },
    outcome: { sent: { url: "https://next.test/v1/chat/completions", authorization: "Bearer next-key" } },
  },
];

describe("Configuration readiness", () => {
  it.each(readiness)("$name", async ({ settings, keyEnvironment, secrets, changedTo, outcome }) => {
    let decrypt = () => {};
    const decrypting = new Promise<string | undefined>((resolve) => (decrypt = () => resolve(changedTo?.key)));
    const core = await startCore({
      settings,
      keyEnvironment,
      secrets,
      commands: changedTo && {
        unprotect_secret: ({ ciphertext }) =>
          ciphertext === changedTo.ciphertext ? decrypting : (secrets?.[ciphertext as string] ?? null),
      },
    });
    if (changedTo) await core.changeSettings(changedTo.settings);
    const releaseKey = async () => {
      await settle();
      decrypt();
    };
    expect(await copyOnce(core, changedTo && releaseKey)).toEqual(outcome);
  });
});

const REJECTED_VERSION = {
  schemaVersion: 99,
  activePreset: "custom",
  presets: { custom: { baseUrl: "https://provider.test/v1", model: "rejected-model" } },
};
const REJECTED_FIELD = customSettings({}, { displayMode: "everything" });
/** DeepSeek offers no `medium` effort. */
const REJECTED_EFFORT = {
  schemaVersion: 1,
  activePreset: "deepseek",
  presets: { deepseek: { model: "deepseek-test", reasoningEffort: "medium" } },
};

/** What Rust's `read_settings` answers. */
type Stored = { status: "missing" | "invalidJson" | "unreadable" } | { status: "document"; document: unknown };

interface LoadingRow {
  name: string;
  stored: Stored;
  /** Whether Rust sets the file aside when asked; false when it changed since it was read. */
  setAside?: boolean;
  /** The recovery commands the store invokes, in order. */
  recovery: unknown[];
  outcome: Outcome;
}

const setAside = (reason: "invalidJson" | "schema", expectedDocument: unknown) => ({
  command: "set_aside_broken_settings",
  args: { reason, expectedDocument },
});
const notified = { command: "show_native_notification" };
const ready = { sent: { url: CUSTOM_CHAT, authorization: null } };
const defaults = { failure: { kind: "no-provider" } } as const;

const loading: LoadingRow[] = [
  {
    name: "a missing document loads defaults and sets nothing aside",
    stored: { status: "missing" },
    recovery: [],
    outcome: defaults,
  },
  {
    name: "an unreadable document loads defaults and sets nothing aside",
    stored: { status: "unreadable" },
    recovery: [],
    outcome: defaults,
  },
  {
    name: "a document holding JSON null is set aside as rejected by the schema, and defaults load",
    stored: { status: "document", document: null },
    recovery: [setAside("schema", null), notified],
    outcome: defaults,
  },
  {
    name: "a document that isn't JSON is set aside, and defaults load",
    stored: { status: "invalidJson" },
    recovery: [setAside("invalidJson", null), notified],
    outcome: defaults,
  },
  {
    name: "a document with another schema version is set aside, and defaults load",
    stored: { status: "document", document: REJECTED_VERSION },
    recovery: [setAside("schema", REJECTED_VERSION), notified],
    outcome: defaults,
  },
  {
    name: "a document with one invalid field is set aside whole, and defaults load",
    stored: { status: "document", document: REJECTED_FIELD },
    recovery: [setAside("schema", REJECTED_FIELD), notified],
    outcome: defaults,
  },
  {
    name: "a document with an effort its Preset doesn't offer is set aside whole, and defaults load",
    stored: { status: "document", document: REJECTED_EFFORT },
    recovery: [setAside("schema", REJECTED_EFFORT), notified],
    outcome: defaults,
  },
  {
    name: "a rejected document Rust doesn't set aside still loads defaults, with no notification",
    stored: { status: "document", document: REJECTED_VERSION },
    setAside: false,
    recovery: [setAside("schema", REJECTED_VERSION)],
    outcome: defaults,
  },
  {
    name: "a document that leaves fields out loads it with defaults for the rest",
    stored: {
      status: "document",
      document: { schemaVersion: 1, activePreset: "custom", presets: { custom: customSettings().presets.custom } },
    },
    recovery: [],
    outcome: ready,
  },
];

describe("Loading the settings document", () => {
  it.each(loading)("$name", async ({ stored, setAside = true, recovery, outcome }) => {
    const core = await startCore({
      commands: {
        read_settings: () => stored,
        set_aside_broken_settings: () => setAside,
        show_native_notification: () => null,
      },
    });
    const recoveryCommands = core.invoked
      .filter(({ command }) => command === "set_aside_broken_settings" || command === "show_native_notification")
      .map(({ command, args }) => (command === "show_native_notification" ? { command } : { command, args }));
    expect(recoveryCommands).toEqual(recovery);
    expect(await copyOnce(core)).toEqual(outcome);
  });
});

describe("The UI language", () => {
  afterEach(() => {
    vi.stubGlobal("navigator", { language: "en-US" });
    vi.resetModules();
  });

  // Any Chinese display language gives Simplified Chinese, anything else English (#29 → Languages).
  // The recovery notification is the core's own text that reaches the Rust side.
  it.each([
    { displayLanguage: "zh-CN", title: "设置已恢复" },
    { displayLanguage: "zh-TW", title: "设置已恢复" },
    { displayLanguage: "zh-HK", title: "设置已恢复" },
    { displayLanguage: "en-US", title: "Settings recovered" },
    { displayLanguage: "ja-JP", title: "Settings recovered" },
    { displayLanguage: "fr-CA", title: "Settings recovered" },
  ])(
    "under $displayLanguage, the settings recovery notification is titled $title",
    async ({ displayLanguage, title }) => {
      vi.stubGlobal("navigator", { language: displayLanguage });
      vi.resetModules();
      const harness = await import("../testing/core");
      const core = await harness.startCore({
        commands: {
          read_settings: () => ({ status: "invalidJson" }),
          set_aside_broken_settings: () => true,
          show_native_notification: () => null,
        },
      });
      const notifications = core.invoked.filter(({ command }) => command === "show_native_notification");
      expect(notifications.map(({ args }) => (args as { title: string }).title)).toEqual([title]);
    },
  );
});

describe("The initial Target language", () => {
  afterEach(() => {
    vi.stubGlobal("navigator", { language: "en-US" });
    vi.resetModules();
  });

  it.each(
    [
      { displayLanguage: "en-US", stored: undefined, language: "English" },
      { displayLanguage: "fr-CA", stored: undefined, language: "French" },
      { displayLanguage: "ja-JP", stored: undefined, language: "Japanese" },
      { displayLanguage: "sv-SE", stored: undefined, language: "English" },
      { displayLanguage: "zh-CN", stored: undefined, language: "Simplified Chinese" },
      { displayLanguage: "zh-SG", stored: undefined, language: "Simplified Chinese" },
      { displayLanguage: "zh-TW", stored: undefined, language: "Traditional Chinese" },
      { displayLanguage: "zh-HK", stored: undefined, language: "Traditional Chinese" },
      { displayLanguage: "zh-MO", stored: undefined, language: "Traditional Chinese" },
      { displayLanguage: "fr-CA", stored: "ja", language: "Japanese" },
    ].map((row) => ({
      ...row,
      name: `under ${row.displayLanguage}, ${row.stored === undefined ? "a document with no Target language" : `a stored ${row.stored}`} translates into ${row.language}`,
    })),
  )("$name", async ({ displayLanguage, stored, language }) => {
    vi.stubGlobal("navigator", { language: displayLanguage });
    vi.resetModules();
    const harness = await import("../testing/core");
    const core = await harness.startCore({
      settings: harness.customSettings({}, stored === undefined ? {} : { targetLanguage: stored }),
    });
    core.provider.reply(LINE_KEPT, [{ content: "Translated" }]);
    await core.copy(LINE);
    await core.roundEnds();
    const translation = core.provider.requests.at(-1)!;
    expect(translation.body.messages[1].content.split(":\n")[0]).toBe(`Translate to ${language}`);
  });
});
