import { initialTargetLanguage, TARGET_LANGUAGES, type TargetLanguage } from "./languages";
import type { ProviderConfiguration } from "./provider";
import type { KeySourcesSnapshot } from "./credentials";
import type { Proxy } from "@tauri-apps/plugin-http";
import { isReasoningEffort, PRESET_REGISTRY, PRESETS, type Preset, type ReasoningEffort } from "./presets";

/**
 * The settings model, shared by both windows: the document's schema, its defaults, its
 * validation, and the values derived from it. Rust stores the document without knowing its fields.
 */

export const SCHEMA_VERSION = 1;
export const DISPLAY_MODES = ["source", "translation", "both"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export type { Preset } from "./presets";

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
  hotkey: "Win+Alt+Q",
  displayMode: "translation",
  proxy: { mode: "system", url: "", username: "", passwordCiphertext: null },
};

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  if (
    activePreset === undefined ||
    targetLanguage === undefined ||
    hotkey === undefined ||
    displayMode === undefined ||
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
  };
}

/**
 * How to reach the active Preset's Provider, or null when a Round can't send anything.
 * The connection producer selects credentials before either Provider operation sends.
 */
export function providerConfiguration(
  settings: Settings,
  keySources?: KeySourcesSnapshot,
  proxyPassword: string | null = null,
): ProviderConfiguration | null {
  const resolved = resolveProviderConnection(settings, keySources, proxyPassword);
  return "configuration" in resolved && resolved.configuration.model ? resolved.configuration : null;
}

export type ConnectionFailure = "no-provider" | "missing-key" | "missing-base-url";

/** Connection readiness shared by Rounds and model lists; a list needs no selected model. */
export function resolveProviderConnection(
  settings: Settings,
  keySources?: KeySourcesSnapshot,
  proxyPassword: string | null = null,
): { configuration: ProviderConfiguration } | { error: ConnectionFailure } {
  const preset = settings.activePreset;
  if (!preset) return { error: "no-provider" };
  const variable = PRESET_REGISTRY[preset].keyVariable;
  const key = keySources?.enteredKey || (variable ? keySources?.environment?.[variable] : null);
  if (variable && !key) return { error: "missing-key" };
  const baseUrl = PRESET_REGISTRY[preset].baseUrl ?? settings.presets.custom.baseUrl;
  if (!baseUrl) return { error: "missing-base-url" };
  const { model, reasoningEffort } = settings.presets[preset];
  return {
    configuration: { preset, baseUrl, model, reasoningEffort, key, proxy: proxyConfiguration(settings, proxyPassword) },
  };
}

/** The selected global proxy, carrying this connection's decrypted password. */
function proxyConfiguration(settings: Settings, password: string | null): Proxy | undefined {
  if (settings.proxy.mode === "system") return undefined;
  const { url, username } = settings.proxy;
  return { all: { url, ...(username || password ? { basicAuth: { username, password: password ?? "" } } : {}) } };
}
