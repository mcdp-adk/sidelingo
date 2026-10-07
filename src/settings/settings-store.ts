import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Proxy } from "@tauri-apps/plugin-http";
import {
  changedSettings,
  connectionOf,
  DEFAULT_SETTINGS,
  parseSettings,
  proxyConfiguration,
  roundReadiness,
  SCHEMA_VERSION,
  type Connection,
  type RoundReadiness,
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

/** One document's Settings with what is resolved from them and the credentials decrypted from it, published together. */
export interface SettingsSnapshot {
  settings: Settings;
  /** The entered key and launch environment key for `preset`. */
  keySources(preset: Preset): KeySourcesSnapshot;
  proxyPassword: string | null;
  /** The selected proxy, with its decrypted password; none follows the System proxy. */
  proxy: Proxy | undefined;
  /** How to reach each Preset's Provider. A Preset's value is a new object exactly when its connection changes. */
  connections: Record<Preset, Connection>;
  /** The Round configuration for the active Preset, or the failure that stops a Round. */
  roundReadiness: RoundReadiness;
  /** Changes exactly when `roundReadiness` changes. */
  roundReadinessRevision: number;
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
  null,
);
/** How many documents `accept` has started on, so an older, slower decryption can't win. */
let accepting = 0;
/** Rust's revision of the newest document taken; Rust counts every document it writes. */
let takenRevision = -1;
let pending = Promise.resolve();
const subscribers = new Set<() => void>();
const roundReadinessSubscribers = new Set<() => void>();

/** `next`, or `previous` when it holds the same values, so an unchanged value keeps its identity. */
function kept<T>(previous: T | undefined, next: T): T {
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

/** The snapshot of `settings`, keeping from `previous` every resolved value that hasn't changed. */
function snapshotOf(
  settings: Settings,
  enteredKeys: EnteredKeys,
  proxyPassword: string | null,
  previous: SettingsSnapshot | null,
): SettingsSnapshot {
  const environment = keyEnvironment;
  const keySources = (preset: Preset): KeySourcesSnapshot => {
    const variable = PRESET_REGISTRY[preset].keyVariable;
    return {
      enteredKey: enteredKeys[preset],
      ...(variable ? { environment: { [variable]: environment[variable] } } : {}),
    };
  };
  const proxy = proxyConfiguration(settings, proxyPassword);
  const connections = Object.fromEntries(
    PRESETS.map((preset) => [
      preset,
      kept(previous?.connections[preset], connectionOf(settings, preset, keySources(preset), proxy)),
    ]),
  ) as Record<Preset, Connection>;
  const readiness = kept(previous?.roundReadiness, roundReadiness(settings, connections));
  const changed = previous !== null && readiness !== previous.roundReadiness;
  return {
    settings,
    keySources,
    proxyPassword,
    proxy,
    connections,
    roundReadiness: readiness,
    roundReadinessRevision: (previous?.roundReadinessRevision ?? 0) + (changed ? 1 : 0),
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
      const previous = snapshot;
      snapshot = snapshotOf(next, keys, password, previous);
      for (const notify of subscribers) notify();
      if (snapshot.roundReadinessRevision !== previous.roundReadinessRevision) {
        for (const notify of roundReadinessSubscribers) notify();
      }
    },
  );
  return pending;
}

/** What `read_settings` answers and each patch broadcasts, with the revision Rust gives every document it writes. */
export type SettingsRead = (
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
      // Rust sets the file aside only while it still holds the revision judged here.
      quarantined = await invoke<boolean>("set_aside_broken_settings", {
        revision: stored.revision,
        reason: brokenReason,
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

/** Calls `notify` after each snapshot whose `roundReadiness` changed, until the returned function unsubscribes. */
export function onRoundReadinessChange(notify: () => void): () => void {
  roundReadinessSubscribers.add(notify);
  return () => roundReadinessSubscribers.delete(notify);
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
