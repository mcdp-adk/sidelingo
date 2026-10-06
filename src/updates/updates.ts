import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { proxyConfiguration } from "../settings/settings";
import { latestSettings } from "../settings/settings-store";

interface UpdateStatus {
  checking: boolean;
  installing: boolean;
  upToDate: boolean;
  availableVersion: string | null;
  checkError: string | null;
  installError: string | null;
}

let status: UpdateStatus = {
  checking: false,
  installing: false,
  upToDate: false,
  availableVersion: null,
  checkError: null,
  installError: null,
};
let availableUpdate: Update | null = null;
/** An unreachable endpoint or proxy fails a check quickly. */
const CHECK_TIMEOUT_MS = 10_000;
/**
 * The SDK applies a check's timeout to the whole download too, which would cut off the installer
 * on a slow link, so the download gets a bound of its own.
 */
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const subscribers = new Set<() => void>();

function accept(next: UpdateStatus): void {
  status = next;
  for (const notify of subscribers) notify();
}

function publish(next: UpdateStatus): void {
  accept(next);
  // View synchronization failures must not replace an SDK operation's result.
  void emit("update-status-changed", next).catch((reason) => console.error(failureReason(reason)));
  void invoke("set_update_offer", {
    version: next.availableVersion,
    enabled: !next.checking && !next.installing,
  }).catch((reason) => console.error(failureReason(reason)));
}

/** SDK failures are shown without credential-bearing URL userinfo. */
function failureReason(reason: unknown): string {
  return String(reason).replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@");
}

async function checkForUpdates(manual: boolean): Promise<void> {
  if (status.checking || status.installing) return;
  publish({ ...status, checking: true, checkError: null });
  let update: Update | null;
  try {
    const { settings, proxyPassword } = await latestSettings();
    const proxy = proxyConfiguration(settings, proxyPassword)?.all;
    let proxyUrl: string | undefined;
    if (proxy) {
      const configuration = typeof proxy === "string" ? { url: proxy } : proxy;
      const url = new URL(configuration.url);
      if (configuration.basicAuth) {
        // URL setters preserve literal %xx; encode first so the SDK decodes the entered bytes once.
        url.username = encodeURIComponent(configuration.basicAuth.username);
        url.password = encodeURIComponent(configuration.basicAuth.password);
      }
      proxyUrl = url.href;
    }
    update = await check({ timeout: CHECK_TIMEOUT_MS, ...(proxyUrl ? { proxy: proxyUrl } : {}) });
  } catch (reason) {
    if (!manual) {
      // A failed automatic check stays silent and keeps what the last check found.
      publish({ ...status, checking: false });
      return;
    }
    // A failed Check now shows only its reason, with no earlier result beside it.
    const previous = availableUpdate;
    availableUpdate = null;
    publish({
      ...status,
      checking: false,
      upToDate: false,
      availableVersion: null,
      checkError: failureReason(reason),
    });
    await previous?.close().catch((reason) => console.error(failureReason(reason)));
    return;
  }
  const previous = availableUpdate;
  availableUpdate = update;
  publish({
    ...status,
    checking: false,
    upToDate: update === null,
    availableVersion: update?.version ?? null,
    checkError: null,
    installError: null,
  });
  await previous?.close().catch((reason) => console.error(failureReason(reason)));
}

async function installUpdate(): Promise<void> {
  if (!availableUpdate || status.checking || status.installing) return;
  const update = availableUpdate;
  publish({ ...status, installing: true, installError: null });
  try {
    // The retained SDK object carries the check's proxy; Windows installation owns exit/relaunch.
    await update.downloadAndInstall(undefined, { timeout: DOWNLOAD_TIMEOUT_MS });
  } catch (reason) {
    publish({ ...status, installing: false, installError: failureReason(reason) });
    return;
  }
  await update.close().catch((reason) => console.error(failureReason(reason)));
}

/** Only Pin calls the SDK; Settings requests checks and receives its state. */
export async function startUpdateChecks(): Promise<void> {
  await listen("update-check-requested", () => void checkForUpdates(true));
  await listen("update-install-requested", () => void installUpdate());
  await listen("update-status-requested", () => void emit("update-status-changed", status));
  const checkAutomatically = async () => {
    if ((await latestSettings()).settings.automaticUpdates) await checkForUpdates(false);
  };
  void checkAutomatically();
  setInterval(() => void checkAutomatically(), 24 * 60 * 60 * 1_000);
}

export async function startUpdateStatus(): Promise<void> {
  await listen<UpdateStatus>("update-status-changed", ({ payload }) => accept(payload));
  await emitTo("pin", "update-status-requested");
}

export function requestUpdateCheck(): Promise<void> {
  return emitTo("pin", "update-check-requested");
}

export function requestUpdateInstall(): Promise<void> {
  return emitTo("pin", "update-install-requested");
}

export function useUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => status,
  );
}
