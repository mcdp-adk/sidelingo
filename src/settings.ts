import { TARGET_LANGUAGES, type TargetLanguage } from "./languages";
import type { ProviderConfiguration } from "./provider";

/**
 * The settings model, shared by both windows: the document's schema, its defaults, its
 * validation, and the values derived from it. Rust stores the document without knowing its fields.
 */

export const SCHEMA_VERSION = 1;

export const PRESETS = ["openai", "openrouter", "deepseek", "ollama-cloud", "custom"] as const;
export type Preset = (typeof PRESETS)[number];

export interface Settings {
  schemaVersion: typeof SCHEMA_VERSION;
  /** None until the user chooses a Provider. */
  activePreset: Preset | null;
  presets: { custom: { baseUrl: string; model: string } };
  targetLanguage: TargetLanguage;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  activePreset: null,
  presets: { custom: { baseUrl: "", model: "" } },
  // The Windows display language takes over in #47.
  targetLanguage: "en",
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
  const custom = presets && field(presets, "custom", isJsonObject, {});
  const defaults = DEFAULT_SETTINGS.presets.custom;
  const baseUrl = custom && field(custom, "baseUrl", isString, defaults.baseUrl);
  const model = custom && field(custom, "model", isString, defaults.model);
  const activePreset = field(document, "activePreset", isPreset, DEFAULT_SETTINGS.activePreset);
  const targetLanguage = field(document, "targetLanguage", isTargetLanguage, DEFAULT_SETTINGS.targetLanguage);
  if (baseUrl === undefined || model === undefined || activePreset === undefined || targetLanguage === undefined) {
    return null;
  }
  return { schemaVersion: SCHEMA_VERSION, activePreset, presets: { custom: { baseUrl, model } }, targetLanguage };
}

/**
 * How to reach the active Preset's Provider, or null when a Round can't send anything.
 * Only Custom, which needs no key, is reachable so far; #44 adds the keyed Presets and #45
 * says why nothing was sent.
 */
export function providerConfiguration(settings: Settings): ProviderConfiguration | null {
  if (settings.activePreset !== "custom") return null;
  const { baseUrl, model } = settings.presets.custom;
  return baseUrl && model ? { baseUrl, model } : null;
}
