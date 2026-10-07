import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  changedSettings,
  DEFAULT_SETTINGS,
  parseSettings,
  roundConfiguration,
  SCHEMA_VERSION,
  type Settings,
  type SettingsChange,
} from "./settings";
import { PRESETS, PRESET_REGISTRY, type Preset } from "../provider/presets";
import {
  readEnteredKeys,
  readKeyEnvironment,
  unprotectSecret,
  type EnteredKeys,
  type KeyEnvironmentSnapshot,
  type KeySourcesSnapshot,
} from "../provider/credentials";
import { strings } from "../i18n";

/** One document's Settings with the credentials decrypted from it, published together. */
export interface SettingsSnapshot {
  settings: Settings;
  /** The entered key and launch environment key for `preset`; none without a Preset. */
  keySources(preset: Preset | null): KeySourcesSnapshot;
  proxyPassword: string | null;
  /** Changes exactly when the Round configuration changes. */
  roundConfigurationRevision: number;
}

let keyEnvironment: KeyEnvironmentSnapshot = Object.fromEntries(
  PRESETS.map((preset) => PRESET_REGISTRY[preset].keyVariable)
    .filter((variable): variable is NonNullable<typeof variable> => variable !== null)
    .map((variable) => [variable, null]),
) as KeyEnvironmentSnapshot;
let snapshot = snapshotOf(
  DEFAULT_SETTINGS,
  Object.fromEntries(PRESETS.map((preset) => [preset, null])) as EnteredKeys,
  null,
  0,
);
/** How many documents `accept` has started on, so an older, slower decryption can't win. */
let accepting = 0;
/** Rust's revision of the newest document taken; Rust counts every document it writes. */
let takenRevision = -1;
let pending = Promise.resolve();
const subscribers = new Set<() => void>();
const roundConfigurationSubscribers = new Set<() => void>();

function snapshotOf(
  settings: Settings,
  enteredKeys: EnteredKeys,
  proxyPassword: string | null,
  roundConfigurationRevision: number,
): SettingsSnapshot {
  const environment = keyEnvironment;
  return {
    settings,
    keySources(preset) {
      const variable = preset ? PRESET_REGISTRY[preset].keyVariable : null;
      return {
        enteredKey: preset ? enteredKeys[preset] : null,
        ...(variable ? { environment: { [variable]: environment[variable] } } : {}),
      };
    },
    proxyPassword,
    roundConfigurationRevision,
  };
}

function accept(document: unknown): Promise<void> {
  const current = ++accepting;
  const parsed = parseSettings(document);
  const next = parsed ?? DEFAULT_SETTINGS;
  pending = Promise.all([readEnteredKeys(next), unprotectSecret(next.proxy.passwordCiphertext)]).then(
    ([keys, password]) => {
      // A later document must not be replaced by an older, slower decryption.
      if (current !== accepting) return;
      const changed =
        JSON.stringify(roundConfiguration(next)) !== JSON.stringify(roundConfiguration(snapshot.settings));
      snapshot = snapshotOf(next, keys, password, snapshot.roundConfigurationRevision + (changed ? 1 : 0));
      for (const notify of subscribers) notify();
      if (changed) for (const notify of roundConfigurationSubscribers) notify();
    },
  );
  return pending;
}

/** What `read_settings` answers and each patch broadcasts, with the revision Rust gives every document it writes. */
type SettingsRead = (
  { status: "missing" | "invalidJson" | "unreadable" } | { status: "document"; document: unknown }
) & {
  revision: number;
};

/** Takes a document Rust wrote when it's newer than the one taken last; one that arrives late changes nothing. */
function takeIfNewer(read: SettingsRead) {
  if (read.status !== "document" || read.revision <= takenRevision) return;
  takenRevision = read.revision;
  void accept(read.document);
}

/** Both windows subscribe before reading, so a concurrent patch cannot be missed. */
export async function startSettingsStore(): Promise<void> {
  // Every snapshot carries the launch environment, the first included.
  keyEnvironment = await readKeyEnvironment();
  // An event can arrive after the read or the Round that already took its document.
  await listen<SettingsRead>("settings-document-changed", ({ payload }) => takeIfNewer(payload));
  const stored = await invoke<SettingsRead>("read_settings");
  if (stored.revision > takenRevision) {
    takenRevision = stored.revision;
    let document: unknown;
    let brokenReason: "invalidJson" | "schema" | undefined;
    if (stored.status === "invalidJson") {
      brokenReason = "invalidJson";
    } else if (stored.status === "document") {
      document = stored.document;
      if (document === null || parseSettings(document) === null) {
        brokenReason = "schema";
        document = undefined;
      }
    }
    let quarantined = false;
    if (brokenReason) {
      quarantined = await invoke<boolean>("set_aside_broken_settings", {
        reason: brokenReason,
        expectedDocument: stored.status === "document" ? stored.document : null,
      }).catch((error) => {
        console.error("Could not set aside broken settings:", error);
        return false;
      });
    }
    // A patch from the other window while this one set the file aside wins.
    const current = takenRevision === stored.revision;
    if (current) accept(document);
    if (quarantined && current) {
      void invoke("show_native_notification", {
        title: strings.settingsRecoveredTitle,
        body: strings.settingsRecoveredBody,
        target: null,
      }).catch((error) => console.error("Could not show settings recovery notification:", error));
    }
  }
  await latestSettings();
}

/**
 * The newest document's snapshot, once its credentials are decrypted. The newest is the one Rust holds now, even when
 * its event hasn't reached this webview yet.
 */
export async function latestSettings(): Promise<SettingsSnapshot> {
  takeIfNewer(await invoke<SettingsRead>("read_settings"));
  let latest: Promise<void>;
  do {
    latest = pending;
    await latest;
  } while (latest !== pending);
  return snapshot;
}

/** The snapshot published last; a new object whenever it changes. */
export function settingsSnapshot(): SettingsSnapshot {
  return snapshot;
}

/** Calls `notify` after each published snapshot, until the returned function unsubscribes. */
export function subscribeSettings(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

/** Calls `notify` after each snapshot whose Round configuration changed, until the returned function unsubscribes. */
export function onRoundConfigurationChange(notify: () => void): () => void {
  roundConfigurationSubscribers.add(notify);
  return () => roundConfigurationSubscribers.delete(notify);
}

export function useSettings(): SettingsSnapshot {
  return useSyncExternalStore(subscribeSettings, settingsSnapshot);
}

/**
 * Saves `change` when the schema accepts it over the published settings, and refuses it with an error, sending
 * nothing, when it doesn't. Rust merges only the changed fields, preserving concurrent changes from the other window.
 */
export async function saveSettings(change: SettingsChange): Promise<void> {
  if (!changedSettings(snapshot.settings, change)) {
    throw new Error(`Settings can't hold this change, so it wasn't saved: ${JSON.stringify(change)}`);
  }
  await invoke("patch_settings", { patch: { schemaVersion: SCHEMA_VERSION, ...change } });
}
