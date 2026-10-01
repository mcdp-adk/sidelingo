import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { run, type Input, type RoundState } from "./round";

/** The Input event from Rust: `show` carries nothing when the clipboard holds nothing usable. */
type InputEvent = { origin: "copy"; input: Input } | { origin: "show"; input: Input | null };

/** The Round the Pin window shows; `id` changes with each new Round. */
export interface ShownRound {
  id: number;
  state: RoundState;
}

let shown: ShownRound | null = null;
let lastRoundId = 0;
const subscribers = new Set<() => void>();

function publish(next: ShownRound) {
  shown = next;
  for (const notify of subscribers) notify();
}

/** Starts a Round on `input`, replacing the one in flight; the window keeps its content until the first update. */
async function startRound(input: Input) {
  const id = ++lastRoundId;
  for await (const state of run(input)) {
    // A newer Round has replaced this one.
    if (id !== lastRoundId) return;
    publish({ id, state });
  }
}

/**
 * Follows the Inputs Rust sends. The Pin window shows only once this listens, so the
 * first `show` Input isn't lost.
 */
export async function startSession(): Promise<void> {
  await listen<InputEvent>("input", ({ payload }) => {
    // Nothing usable on show keeps the current content.
    if (payload.input) void startRound(payload.input);
  });
  await invoke("pin_window_ready");
}

/** The Round the Pin window shows, or null before the first. */
export function useShownRound(): ShownRound | null {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => shown,
  );
}
