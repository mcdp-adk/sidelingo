import { initialTargetLanguage, TARGET_LANGUAGES, type TargetLanguage } from "./languages";
import type { ProviderConfiguration } from "./provider";
import type { KeySourcesSnapshot } from "./credentials";
import { isReasoningEffort, PRESET_REGISTRY, PRESETS, type Preset, type ReasoningEffort } from "./presets";

/**
 * The settings model, shared by both windows: the document's schema, its defaults, its
 * validation, and the values derived from it. Rust stores the document without knowing its fields.
 */

export const SCHEMA_VERSION = 1;

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
  targetLanguage: TargetLanguage;
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
  const targetLanguage = field(document, "targetLanguage", isTargetLanguage, DEFAULT_SETTINGS.targetLanguage);
  if (activePreset === undefined || targetLanguage === undefined) {
    return null;
  }
  return { schemaVersion: SCHEMA_VERSION, activePreset, presets: values, targetLanguage };
}

/**
 * How to reach the active Preset's Provider, or null when a Round can't send anything.
 * The connection producer selects credentials before either Provider operation sends.
 */
export function providerConfiguration(
  settings: Settings,
  keySources?: KeySourcesSnapshot,
): ProviderConfiguration | null {
  const resolved = resolveProviderConnection(settings, keySources);
  return "configuration" in resolved && resolved.configuration.model ? resolved.configuration : null;
}

export type ConnectionFailure = "no-provider" | "missing-key" | "missing-base-url";

/** Connection readiness shared by Rounds and model lists; a list needs no selected model. */
export function resolveProviderConnection(
  settings: Settings,
  keySources?: KeySourcesSnapshot,
): { configuration: ProviderConfiguration } | { error: ConnectionFailure } {
  const preset = settings.activePreset;
  if (!preset) return { error: "no-provider" };
  const variable = PRESET_REGISTRY[preset].keyVariable;
  const key = keySources?.enteredKey || (variable ? keySources?.environment?.[variable] : null);
  if (variable && !key) return { error: "missing-key" };
  const baseUrl = PRESET_REGISTRY[preset].baseUrl ?? settings.presets.custom.baseUrl;
  if (!baseUrl) return { error: "missing-base-url" };
  const { model, reasoningEffort } = settings.presets[preset];
  return { configuration: { preset, baseUrl, model, reasoningEffort, key } };
}
