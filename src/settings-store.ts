import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, parseSettings, SCHEMA_VERSION, type Settings } from "./settings";
import { PRESETS, type Preset } from "./presets";
import { readEnteredKeys, type EnteredKeys, type KeySourcesSnapshot } from "./credentials";

let settings: Settings = DEFAULT_SETTINGS;
let enteredKeys = Object.fromEntries(PRESETS.map((preset) => [preset, null])) as EnteredKeys;
let revision = 0;
let pending = Promise.resolve();
const subscribers = new Set<() => void>();

function accept(document: unknown): Promise<void> {
  const current = ++revision;
  const parsed = parseSettings(document);
  const next = parsed ?? DEFAULT_SETTINGS;
  pending = readEnteredKeys(next).then((keys) => {
    // A later document must not be replaced by an older, slower decryption.
    if (current !== revision) return;
    settings = next;
    enteredKeys = keys;
    for (const notify of subscribers) notify();
  });
  return pending;
}

/** Both windows subscribe before reading, so a concurrent patch cannot be missed. */
export async function startSettingsStore(): Promise<void> {
  let changed = false;
  await listen("settings-document-changed", ({ payload }) => {
    changed = true;
    void accept(payload);
  });
  const document = await invoke("read_settings");
  if (!changed) void accept(document);
  // Initialization waits for the newest document, including one arriving during decryption.
  let latest: Promise<void>;
  do {
    latest = pending;
    await latest;
  } while (latest !== pending);
}

export function currentSettings(): Settings {
  return settings;
}

export function currentEnteredKey(preset: Preset | null): string | null {
  return preset ? enteredKeys[preset] : null;
}

export function currentKeySources(preset: Preset | null): KeySourcesSnapshot {
  return { enteredKey: currentEnteredKey(preset) };
}

export function useSettings(): Settings {
  return useSyncExternalStore((notify) => {
    subscribers.add(notify);
    return () => subscribers.delete(notify);
  }, currentSettings);
}

/** Rust merges only the changed fields, preserving concurrent changes from the other window. */
export async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  await invoke("patch_settings", { patch: { schemaVersion: SCHEMA_VERSION, ...patch } });
}
