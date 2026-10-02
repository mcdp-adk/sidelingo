import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { run, type Input, type RoundState } from "./round";
import { providerConfiguration } from "./settings";
import { currentKeySources, currentSettings, waitForSettings } from "./settings-store";

/** The Input event from Rust: `show` carries nothing when the clipboard holds nothing usable. */
type InputEvent = { origin: "copy"; input: Input } | { origin: "show"; input: Input | null };

/** The Round the Pin window shows; `id` changes with each new Round. */
export interface ShownRound {
  id: number;
  state: RoundState;
}

let shown: ShownRound | null = null;
let currentInput: Input | null = null;
/** Only the last fully successful Round is reusable; nothing is written to disk. */
let lastSuccessful: { input: Input; round: ShownRound } | null = null;
/** A settings change also invalidates a result still being produced with older settings. */
let configurationGeneration = 0;
let lastRoundId = 0;
/** Cancels the Round in flight. */
let inFlight: AbortController | null = null;
const subscribers = new Set<() => void>();

function publish(next: ShownRound) {
  shown = next;
  for (const notify of subscribers) notify();
}

/** Identity belongs to the session; text and image payloads compare as delivered. */
function sameInput(left: Input | undefined | null, right: Input): boolean {
  if (left?.kind === "text" && right.kind === "text") return left.text === right.text;
  return left?.kind === "image" && right.kind === "image" && left.dataUrl === right.dataUrl;
}

/** Starts a Round on `input`; the window keeps its content until the first update. */
async function startRound(input: Input) {
  const controller = (inFlight = new AbortController());
  try {
    let generation = configurationGeneration;
    while (true) {
      await waitForSettings();
      if (controller.signal.aborted) return;
      // Another raw settings event may arrive while the store publishes its snapshot.
      if (generation === configurationGeneration) break;
      generation = configurationGeneration;
    }
    const settings = currentSettings();
    const provider = providerConfiguration(settings, currentKeySources(settings.activePreset));
    if (!provider) return;
    const id = ++lastRoundId;
    let completed: ShownRound | null = null;
    for await (const state of run(input, { provider, targetLanguage: settings.targetLanguage }, controller.signal)) {
      // A newer Round has replaced this one.
      if (controller.signal.aborted) return;
      completed = { id, state };
      publish(completed);
    }
    if (
      !controller.signal.aborted &&
      generation === configurationGeneration &&
      completed &&
      ["done", "no-text"].includes(completed.state.stage)
    ) {
      lastSuccessful = { input, round: completed };
    }
  } catch (error) {
    // A cancelled Round leaves no error; #51 shows the others in the window.
    if (!controller.signal.aborted) console.error("The Round failed:", error);
  }
}

/**
 * Follows the Inputs Rust sends. The Pin window shows only once this listens, so the
 * first `show` Input isn't lost.
 */
export async function startSession(): Promise<void> {
  await listen("settings-document-changed", () => {
    ++configurationGeneration;
    lastSuccessful = null;
  });
  await listen<InputEvent>("input", ({ payload }) => {
    // Nothing usable on show keeps the current content.
    if (!payload.input || (payload.origin === "copy" && sameInput(currentInput, payload.input))) return;
    inFlight?.abort();
    inFlight = null;
    currentInput = payload.input;
    if (payload.origin === "show" && lastSuccessful && sameInput(lastSuccessful.input, payload.input)) {
      publish(lastSuccessful.round);
    } else {
      void startRound(payload.input);
    }
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
