import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, parseSettings, SCHEMA_VERSION, type Settings } from "./settings";

let settings: Settings = DEFAULT_SETTINGS;
const subscribers = new Set<() => void>();

function accept(document: unknown) {
  settings = parseSettings(document) ?? DEFAULT_SETTINGS;
  for (const notify of subscribers) notify();
}

/** Both windows subscribe before reading, so a concurrent patch cannot be missed. */
export async function startSettingsStore(): Promise<void> {
  let changed = false;
  await listen("settings-document-changed", ({ payload }) => {
    changed = true;
    accept(payload);
  });
  const document = await invoke("read_settings");
  if (!changed) accept(document);
}

export function currentSettings(): Settings {
  return settings;
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
