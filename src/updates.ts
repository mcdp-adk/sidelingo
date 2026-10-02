import { useSyncExternalStore } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { proxyConfiguration } from "./settings";
import { currentProxyPassword, currentSettings, waitForSettings } from "./settings-store";

interface UpdateStatus {
  checking: boolean;
  error: string | null;
}

let status: UpdateStatus = { checking: false, error: null };
const subscribers = new Set<() => void>();

function accept(next: UpdateStatus): void {
  status = next;
  for (const notify of subscribers) notify();
}

async function publish(next: UpdateStatus): Promise<void> {
  accept(next);
  await emit("update-status-changed", next);
}

/** SDK failures are shown without credential-bearing URL userinfo. */
function failureReason(reason: unknown): string {
  return String(reason).replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@");
}

async function checkForUpdates(manual: boolean): Promise<void> {
  if (status.checking) return;
  await publish({ checking: true, error: null });
  try {
    await waitForSettings();
    const proxy = proxyConfiguration(currentSettings(), currentProxyPassword())?.all;
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
    const update = await check({ timeout: 10_000, ...(proxyUrl ? { proxy: proxyUrl } : {}) });
    await update?.close();
    await publish({ checking: false, error: null });
  } catch (reason) {
    await publish({ checking: false, error: manual ? failureReason(reason) : null });
  }
}

/** Only Pin calls the SDK; Settings requests checks and receives its state. */
export async function startUpdateChecks(): Promise<void> {
  await listen("update-check-requested", () => void checkForUpdates(true));
  await listen("update-status-requested", () => void emit("update-status-changed", status));
  if (currentSettings().automaticUpdates) void checkForUpdates(false);
}

export async function startUpdateStatus(): Promise<void> {
  await listen<UpdateStatus>("update-status-changed", ({ payload }) => accept(payload));
  await emitTo("pin", "update-status-requested");
}

export function requestUpdateCheck(): Promise<void> {
  return emitTo("pin", "update-check-requested");
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
