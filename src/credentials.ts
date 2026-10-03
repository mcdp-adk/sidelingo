import { invoke } from "@tauri-apps/api/core";
import { PRESET_REGISTRY, PRESETS, type Preset } from "./presets";
import type { Settings } from "./settings";

/** Plaintext is held only in the running app; settings contain DPAPI ciphertext. */
export type EnteredKeys = Record<Preset, string | null>;

type KeyVariable = NonNullable<(typeof PRESET_REGISTRY)[Preset]["keyVariable"]>;
export type KeyEnvironmentSnapshot = Record<KeyVariable, string | null>;

/** The running app's sources for a Preset; environment values never belong in Settings. */
export interface KeySourcesSnapshot {
  enteredKey: string | null;
  environment?: Partial<Record<KeyVariable, string | null>>;
}

/** Reads the fixed environment-key snapshot captured by Rust when the app launched. */
export async function readKeyEnvironment(): Promise<KeyEnvironmentSnapshot> {
  return invoke<KeyEnvironmentSnapshot>("read_key_environment");
}

export async function readEnteredKeys(settings: Settings): Promise<EnteredKeys> {
  const entries = await Promise.all(
    PRESETS.map(async (preset) => {
      const ciphertext = settings.presets[preset].keyCiphertext;
      const key = await unprotectSecret(ciphertext);
      return [preset, key] as const;
    }),
  );
  return Object.fromEntries(entries) as EnteredKeys;
}

/** Both keys and proxy passwords use the same current-user DPAPI adapter. */
export async function unprotectSecret(ciphertext: string | null): Promise<string | null> {
  return ciphertext ? invoke<string | null>("unprotect_secret", { ciphertext }) : null;
}

export async function protectSecret(secret: string): Promise<string | null> {
  return secret ? invoke<string>("protect_secret", { secret }) : null;
}
