import { invoke } from "@tauri-apps/api/core";
import { PRESET_REGISTRY, PRESETS, type Preset } from "./presets";
import type { Settings } from "./settings";

/** Plaintext is held only in the running app; settings contain DPAPI ciphertext. */
export type EnteredKeys = Record<Preset, string | null>;

type KeyVariable = NonNullable<(typeof PRESET_REGISTRY)[Preset]["keyVariable"]>;

/** The running app's sources for a Preset; environment values never belong in Settings. */
export interface KeySourcesSnapshot {
  enteredKey: string | null;
  environment?: Partial<Record<KeyVariable, string | null>>;
}

export async function readEnteredKeys(settings: Settings): Promise<EnteredKeys> {
  const entries = await Promise.all(
    PRESETS.map(async (preset) => {
      const ciphertext = settings.presets[preset].keyCiphertext;
      const key = ciphertext ? await invoke<string | null>("unprotect_secret", { ciphertext }) : null;
      return [preset, key] as const;
    }),
  );
  return Object.fromEntries(entries) as EnteredKeys;
}
