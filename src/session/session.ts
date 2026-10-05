import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { providerClient, type Transport } from "../provider/provider";
import { run, type Input, type RoundState } from "../round/round";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  providerConfiguration,
  roundSettings,
  type ConfigurationFailure,
} from "../settings/settings";
import { currentKeySources, currentProxyPassword, currentSettings, waitForSettings } from "../settings/settings-store";

/** The Input event from Rust: `show` carries nothing when the clipboard holds nothing usable. */
type InputEvent = { origin: "copy"; input: Input } | { origin: "show"; input: Input | null };

/** The Round the Pin window shows; `id` changes with each new Round. */
export interface ShownRound {
  id: number;
  state: RoundState;
}

/** One coherent view of the session for results and user controls. */
export interface SessionState {
  round: ShownRound | null;
  hasInput: boolean;
  paused: boolean;
  overlong: boolean;
  configurationFailure: ConfigurationFailure | null;
}

/** Follows the Inputs Rust sends and runs their Rounds; the Pin webview creates one at startup. */
export interface Session {
  /**
   * Starts following the Inputs Rust sends. The Pin window shows only once this listens, so the
   * first `show` Input isn't lost.
   */
  start(): Promise<void>;
  /** The current state; a new object whenever it changes. */
  state(): SessionState;
  /** Calls `notify` after each change, until the returned function unsubscribes. */
  subscribe(notify: () => void): () => void;
  /** Pause ignores only copies; hiding resets it without stopping the Round. */
  toggleClipboardPause(): void;
  /** Reruns the current Input with current settings, bypassing successful reuse. */
  regenerate(): void;
}

/** A Session whose Rounds reach the Provider through `transport`: `tauri-plugin-http`'s `fetch` in the app. */
export function createSession(transport: Transport): Session {
  const client = providerClient(transport);
  let snapshot: SessionState = {
    round: null,
    hasInput: false,
    paused: false,
    overlong: false,
    configurationFailure: null,
  };
  let currentInput: Input | null = null;
  /** Only the last fully successful Round is reusable; nothing is written to disk. */
  let lastSuccessful: { input: Input; round: ShownRound } | null = null;
  /** A configuration change also invalidates a result still being produced with older settings. */
  let configurationGeneration = 0;
  let lastRoundId = 0;
  /** Cancels the Round in flight. */
  let inFlight: AbortController | null = null;
  const subscribers = new Set<() => void>();

  function publish(
    round: ShownRound | null,
    controls: Partial<Pick<SessionState, "paused" | "overlong" | "configurationFailure">> = {},
  ) {
    snapshot = { ...snapshot, ...controls, round, hasInput: currentInput !== null };
    for (const notify of subscribers) notify();
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
      const resolved = providerConfiguration(
        settings,
        currentKeySources(settings.activePreset),
        currentProxyPassword(),
      );
      if ("error" in resolved) {
        publish(snapshot.round, { configurationFailure: resolved.error });
        return;
      }
      const provider = resolved.configuration;
      const id = ++lastRoundId;
      let completed: ShownRound | null = null;
      for await (const state of run(
        client,
        input,
        { provider, targetLanguage: settings.targetLanguage },
        controller.signal,
      )) {
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
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  return {
    async start() {
      let configuration = JSON.stringify(roundSettings(currentSettings()));
      await listen("settings-document-changed", ({ payload }) => {
        const changed = JSON.stringify(roundSettings(parseSettings(payload) ?? DEFAULT_SETTINGS));
        if (changed === configuration) return;
        configuration = changed;
        ++configurationGeneration;
        lastSuccessful = null;
      });
      await listen("pin-window-hidden", () => {
        if (snapshot.paused) publish(snapshot.round, { paused: false });
      });
      await listen<InputEvent>("input", ({ payload }) => {
        if (payload.origin === "copy" && snapshot.paused) return;
        // Nothing usable on show keeps the current content.
        if (!payload.input || (payload.origin === "copy" && sameInput(currentInput, payload.input))) return;
        // A Round still running on the shown Input keeps running and shows its whole result.
        if (payload.origin === "show" && inFlight && sameInput(currentInput, payload.input)) return;
        inFlight?.abort();
        inFlight = null;
        currentInput = payload.input;
        if (payload.origin === "show" && lastSuccessful && sameInput(lastSuccessful.input, payload.input)) {
          publish(lastSuccessful.round, { overlong: false, configurationFailure: null });
        } else if (payload.input.kind === "text" && payload.input.text.length > 10_000) {
          publish(null, { overlong: true, configurationFailure: null });
        } else {
          publish(snapshot.round, { overlong: false, configurationFailure: null });
          void startRound(payload.input);
        }
      });
      await invoke("pin_window_ready");
    },
    state: () => snapshot,
    subscribe(notify) {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    toggleClipboardPause() {
      publish(snapshot.round, { paused: !snapshot.paused });
    },
    regenerate() {
      if (!currentInput) return;
      lastSuccessful = null;
      inFlight?.abort();
      inFlight = null;
      publish(snapshot.round, { overlong: false, configurationFailure: null });
      void startRound(currentInput);
    },
  };
}

/** Identity belongs to the session; text and image payloads compare as delivered. */
function sameInput(left: Input | undefined | null, right: Input): boolean {
  if (left?.kind === "text" && right.kind === "text") return left.text === right.text;
  return left?.kind === "image" && right.kind === "image" && left.dataUrl === right.dataUrl;
}

/** Results and action availability come from the same session snapshot. */
export function useSession(session: Session): SessionState {
  return useSyncExternalStore(session.subscribe, session.state);
}
