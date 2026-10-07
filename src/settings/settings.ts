import { initialTargetLanguage, TARGET_LANGUAGES, type TargetLanguage } from "../languages";
import type { ProviderConfiguration } from "../provider/provider";
import type { KeySourcesSnapshot } from "../provider/credentials";
import type { Proxy } from "@tauri-apps/plugin-http";
import { isReasoningEffort, PRESET_REGISTRY, PRESETS, type Preset, type ReasoningEffort } from "../provider/presets";

/**
 * The settings model, shared by both windows: the document's schema, its defaults, its
 * validation, and the values derived from it. Rust stores the document without knowing its fields.
 */

export const SCHEMA_VERSION = 1;
export const DISPLAY_MODES = ["source", "translation", "both"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export type { Preset } from "../provider/presets";

type KeyVariable = NonNullable<(typeof PRESET_REGISTRY)[Preset]["keyVariable"]>;

type PresetSettings = {
  [P in Preset]: {
    model: string;
    reasoningEffort: ReasoningEffort | null;
    keyCiphertext: string | null;
  } & (P extends "custom" ? { baseUrl: string } : {});
};

export interface Settings {
  schemaVersion: typeof SCHEMA_VERSION;
  /** None until the user chooses a Provider. */
  activePreset: Preset | null;
  presets: PresetSettings;
  proxy: { mode: "system" | "manual"; url: string; username: string; passwordCiphertext: string | null };
  targetLanguage: TargetLanguage;
  hotkey: string | null;
  displayMode: DisplayMode;
  automaticUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  activePreset: null,
  presets: {
    openai: { model: "", reasoningEffort: null, keyCiphertext: null },
    openrouter: { model: "", reasoningEffort: null, keyCiphertext: null },
    deepseek: { model: "", reasoningEffort: null, keyCiphertext: null },
    "ollama-cloud": { model: "", reasoningEffort: null, keyCiphertext: null },
    custom: { baseUrl: "", model: "", reasoningEffort: null, keyCiphertext: null },
  },
  targetLanguage: initialTargetLanguage(navigator.language),
  hotkey: "Ctrl+Shift+Q",
  displayMode: "translation",
  automaticUpdates: true,
  proxy: { mode: "system", url: "", username: "", passwordCiphertext: null },
};

/** A change to some settings, in their own shape; a saved document merges it in field by field. */
export type SettingsChange = {
  [K in Exclude<keyof Settings, "schemaVersion" | "presets" | "proxy">]?: Settings[K];
} & {
  presets?: { [P in Preset]?: Partial<PresetSettings[P]> };
  proxy?: Partial<Settings["proxy"]>;
};

/** A change to `preset`'s fields alone; a key computed from a Preset would escape `SettingsChange`'s check. */
export function presetChange<P extends Preset>(preset: P, fields: Partial<PresetSettings[P]>): SettingsChange {
  return { presets: { [preset]: fields } };
}

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `document` with `patch` merged in as Rust merges it: objects field by field, anything else replaced. */
function merged(document: unknown, patch: unknown): unknown {
  if (!isJsonObject(patch)) return patch;
  const result = isJsonObject(document) ? { ...document } : {};
  for (const [key, value] of Object.entries(patch)) result[key] = merged(result[key], value);
  return result;
}

/**
 * `settings` with `change` merged in, or null when the schema rejects the result. Each field's rule is independent of
 * the others, so a change valid on these settings is valid on any valid document.
 */
export function changedSettings(settings: Settings, change: SettingsChange): Settings | null {
  return parseSettings(merged(settings, change));
}

/** `document[key]` when it passes `valid`, `fallback` when absent, and `undefined` when invalid. */
function field<T>(
  document: JsonObject,
  key: string,
  valid: (value: unknown) => value is T,
  fallback: T,
): T | undefined {
  if (!(key in document)) return fallback;
  return valid(document[key]) ? document[key] : undefined;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isPreset = (value: unknown): value is Preset | null => value === null || PRESETS.includes(value as Preset);
const isTargetLanguage = (value: unknown): value is TargetLanguage =>
  TARGET_LANGUAGES.includes(value as TargetLanguage);

/**
 * The settings a stored document holds, with defaults for what it leaves out: the defaults
 * alone when there is no document, and null when the schema rejects it.
 */
export function parseSettings(document: unknown): Settings | null {
  if (document === null || document === undefined) return DEFAULT_SETTINGS;
  if (!isJsonObject(document) || document.schemaVersion !== SCHEMA_VERSION) return null;
  const presets = field(document, "presets", isJsonObject, {});
  if (!presets) return null;
  const values = { ...DEFAULT_SETTINGS.presets };
  for (const preset of PRESETS) {
    const stored = field(presets, preset, isJsonObject, {});
    if (!stored) return null;
    const model = field(stored, "model", isString, DEFAULT_SETTINGS.presets[preset].model);
    const keyCiphertext = field(
      stored,
      "keyCiphertext",
      (value): value is string | null => value === null || isString(value),
      null,
    );
    const reasoningEffort = field(
      stored,
      "reasoningEffort",
      (value): value is ReasoningEffort | null => isReasoningEffort(preset, value),
      DEFAULT_SETTINGS.presets[preset].reasoningEffort,
    );
    if (model === undefined || reasoningEffort === undefined || keyCiphertext === undefined) return null;
    if (preset === "custom") {
      const baseUrl = field(stored, "baseUrl", isString, DEFAULT_SETTINGS.presets.custom.baseUrl);
      if (baseUrl === undefined) return null;
      values.custom = { model, baseUrl, reasoningEffort, keyCiphertext };
    } else values[preset] = { model, reasoningEffort, keyCiphertext };
  }
  const activePreset = field(document, "activePreset", isPreset, DEFAULT_SETTINGS.activePreset);
  const storedProxy = field(document, "proxy", isJsonObject, {});
  if (!storedProxy) return null;
  const mode = field(
    storedProxy,
    "mode",
    (value): value is "system" | "manual" => value === "system" || value === "manual",
    "system",
  );
  const url = field(storedProxy, "url", isString, "");
  const username = field(storedProxy, "username", isString, "");
  const passwordCiphertext = field(
    storedProxy,
    "passwordCiphertext",
    (value): value is string | null => value === null || isString(value),
    null,
  );
  const targetLanguage = field(document, "targetLanguage", isTargetLanguage, DEFAULT_SETTINGS.targetLanguage);
  const hotkey = field(
    document,
    "hotkey",
    (value): value is string | null => value === null || isString(value),
    DEFAULT_SETTINGS.hotkey,
  );
  const displayMode = field(
    document,
    "displayMode",
    (value): value is DisplayMode => DISPLAY_MODES.includes(value as DisplayMode),
    DEFAULT_SETTINGS.displayMode,
  );
  const automaticUpdates = field(
    document,
    "automaticUpdates",
    (value): value is boolean => typeof value === "boolean",
    DEFAULT_SETTINGS.automaticUpdates,
  );
  if (
    activePreset === undefined ||
    targetLanguage === undefined ||
    hotkey === undefined ||
    displayMode === undefined ||
    automaticUpdates === undefined ||
    mode === undefined ||
    url === undefined ||
    username === undefined ||
    passwordCiphertext === undefined
  ) {
    return null;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    activePreset,
    presets: values,
    proxy: { mode, url, username, passwordCiphertext },
    targetLanguage,
    hotkey,
    displayMode,
    automaticUpdates,
  };
}

/** The settings a Round runs with; the Display mode, hotkey and update checks change nothing it sends. */
export function roundConfiguration({ activePreset, presets, proxy, targetLanguage }: Settings) {
  return { activePreset, presets, proxy, targetLanguage };
}

/**
 * How to reach the active Preset's Provider, or why a Round can't send anything.
 * The connection producer selects credentials before either Provider operation sends.
 */
export function providerConfiguration(
  settings: Settings,
  keySources?: KeySourcesSnapshot,
  proxyPassword: string | null = null,
): { configuration: ProviderConfiguration } | { error: ConfigurationFailure } {
  const preset = settings.activePreset;
  if (preset && !settings.presets[preset].model) return { error: { kind: "missing-model" } };
  return resolveProviderConnection(settings, keySources, proxyPassword);
}

export type ConnectionFailure =
  | { kind: "no-provider" }
  | { kind: "missing-base-url" }
  | { kind: "missing-key"; cause: "environment-unset"; variable: KeyVariable }
  | { kind: "missing-key"; cause: "saved-key-could-not-decrypt"; variable: KeyVariable | null };

export type ConfigurationFailure = ConnectionFailure | { kind: "missing-model" };

/** Connection readiness shared by Rounds and model lists; a list needs no selected model. */
export function resolveProviderConnection(
  settings: Settings,
  keySources?: KeySourcesSnapshot,
  proxyPassword: string | null = null,
): { configuration: ProviderConfiguration } | { error: ConnectionFailure } {
  const preset = settings.activePreset;
  if (!preset) return { error: { kind: "no-provider" } };
  const variable = PRESET_REGISTRY[preset].keyVariable;
  const baseUrl = PRESET_REGISTRY[preset].baseUrl ?? settings.presets.custom.baseUrl;
  if (!baseUrl) return { error: { kind: "missing-base-url" } };
  const savedKeyCiphertext = settings.presets[preset].keyCiphertext;
  const enteredKey = keySources?.enteredKey;
  if (savedKeyCiphertext !== null && enteredKey == null) {
    return { error: { kind: "missing-key", cause: "saved-key-could-not-decrypt", variable } };
  }
  const key = enteredKey || (variable ? keySources?.environment?.[variable] : null);
  if (variable && !key) return { error: { kind: "missing-key", cause: "environment-unset", variable } };
  const { model, reasoningEffort } = settings.presets[preset];
  return {
    configuration: { preset, baseUrl, model, reasoningEffort, key, proxy: proxyConfiguration(settings, proxyPassword) },
  };
}

/** The selected global proxy, carrying this connection's decrypted password. */
export function proxyConfiguration(settings: Settings, password: string | null): Proxy | undefined {
  if (settings.proxy.mode === "system") return undefined;
  const { url, username } = settings.proxy;
  return { all: { url, ...(username || password ? { basicAuth: { username, password: password ?? "" } } : {}) } };
}
