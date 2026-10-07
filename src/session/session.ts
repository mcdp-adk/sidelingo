import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { providerClient, type Transport } from "../provider/provider";
import { run, type Input, type RoundError, type RoundPane, type RoundStage, type RoundState } from "../round/round";
import { strings } from "../i18n";
import { providerConfiguration, type ConfigurationFailure, type DisplayMode } from "../settings/settings";
import {
  latestSettings,
  onRoundConfigurationChange,
  saveSettings,
  settingsSnapshot,
  subscribeSettings,
} from "../settings/settings-store";

/** The Input event from Rust: `show` carries nothing when the clipboard holds nothing usable. */
type InputEvent = { origin: "copy"; input: Input } | { origin: "show"; input: Input | null };

/** The Round the Pin window shows; `id` changes with each new Round. */
interface ShownRound {
  id: number;
  state: RoundState;
}

/** The Session's own state, from which it derives the Pin view. */
interface Snapshot {
  round: ShownRound | null;
  hasInput: boolean;
  paused: boolean;
  overlong: boolean;
  configurationFailure: ConfigurationFailure | null;
  displayMode: DisplayMode;
}

/** A pane of the Pin window. */
export type PaneKind = "source" | "translation";

/** One pane of a shown Round. */
export interface PinPane {
  text: string;
  /** The status line, while the Round runs and the pane has no text yet. */
  progress: RoundStage | null;
  error: RoundError | null;
}

/** What the panes show, below any configuration notice. */
export type PinContent =
  | { kind: "hint" }
  | { kind: "overlong" }
  | { kind: "no-text" }
  | {
      kind: "round";
      source: PinPane;
      /** The Source text the Translation pane, shown alone, shows muted until Translated text arrives. */
      translation: PinPane & { mutedSource: string | null };
    };

/** What the Pin window shows: results and user controls, from one coherent snapshot. */
export interface PinView {
  /** Changes with each new Round, so the panes scroll back to the top. */
  roundId: number | null;
  /** Shown above the content until the next Input, Regenerate or Round configuration change. */
  configurationFailure: ConfigurationFailure | null;
  /** `null` under a configuration notice with no Round to show. */
  content: PinContent | null;
  displayMode: DisplayMode;
  /** The panes shown, in order: one alone, or Source then Translation side by side. */
  panes: PaneKind[];
  paused: boolean;
  canRegenerate: boolean;
  canCopySource: boolean;
  canCopyTranslation: boolean;
}

function pinView({ round, hasInput, paused, overlong, configurationFailure, displayMode }: Snapshot): PinView {
  const state = round?.state;
  const paneOf = (shown: RoundState, roundPane: RoundPane): PinPane => ({
    text: roundPane.text,
    progress: !roundPane.text && shown.outcome === "running" ? shown.stage : null,
    error: roundPane.error ?? null,
  });
  const copyable = (pane: RoundPane | undefined) => !!pane?.text && pane.status === "done";
  let content: PinContent | null;
  if (overlong) content = { kind: "overlong" };
  else if (state?.outcome === "no-text") content = { kind: "no-text" };
  else if (state) {
    content = {
      kind: "round",
      source: paneOf(state, state.source),
      translation: {
        ...paneOf(state, state.translation),
        mutedSource:
          displayMode === "translation" && !state.translation.text && state.source.text ? state.source.text : null,
      },
    };
  } else content = configurationFailure ? null : { kind: "hint" };
  return {
    roundId: round?.id ?? null,
    configurationFailure,
    content,
    displayMode,
    panes: displayMode === "both" ? ["source", "translation"] : [displayMode],
    paused,
    canRegenerate: hasInput,
    canCopySource: copyable(state?.source),
    canCopyTranslation: copyable(state?.translation),
  };
}

/**
 * Follows the Inputs Rust sends and runs their Rounds, and performs what the Pin window's controls do; the Pin webview
 * creates one at startup.
 */
export interface Session {
  /**
   * Starts following the Inputs Rust sends. The Pin window shows only once this listens, so the
   * first `show` Input isn't lost.
   */
  start(): Promise<void>;
  /** What the Pin window shows now; a new object whenever it changes. */
  view(): PinView;
  /** Calls `notify` after each change, until the returned function unsubscribes. */
  subscribe(notify: () => void): () => void;
  /** Pause ignores only copies; hiding resets it without stopping the Round. */
  toggleClipboardPause(): void;
  /** Reruns the current Input with current settings, bypassing successful reuse. */
  regenerate(): void;
  /** Saves `mode`, which shows once Rust broadcasts the document; a native notification says when it isn't saved. */
  chooseDisplayMode(mode: DisplayMode): void;
  /** Copies the pane's text as written, only while the Pin view offers its copy; the copy starts no Round. */
  copyPane(pane: PaneKind): void;
  openSettings(): void;
  hide(): void;
  /** Calls `notify` each time the Pin window has hidden, however it was hidden, until the returned function unsubscribes. */
  onHidden(notify: () => void): () => void;
}

/** A Session whose Rounds reach the Provider through `transport`: `tauri-plugin-http`'s `fetch` in the app. */
export function createSession(transport: Transport): Session {
  const client = providerClient(transport);
  let snapshot: Snapshot = {
    round: null,
    hasInput: false,
    paused: false,
    overlong: false,
    configurationFailure: null,
    displayMode: settingsSnapshot().settings.displayMode,
  };
  let view = pinView(snapshot);
  let currentInput: Input | null = null;
  /** Until a Round sends for the current Input, copying it again tries again (#112). */
  let currentInputSent = false;
  /** Only the last fully successful Round is reusable; nothing is written to disk. */
  let lastSuccessful: { input: Input; round: ShownRound } | null = null;
  let lastRoundId = 0;
  /** Cancels the Round in flight. */
  let inFlight: AbortController | null = null;
  const subscribers = new Set<() => void>();
  const hiddenSubscribers = new Set<() => void>();

  function publish(
    round: ShownRound | null,
    controls: Partial<Pick<Snapshot, "paused" | "overlong" | "configurationFailure" | "displayMode">> = {},
  ) {
    snapshot = { ...snapshot, ...controls, round, hasInput: currentInput !== null };
    view = pinView(snapshot);
    for (const notify of subscribers) notify();
  }

  /** Starts a Round on `input`; the window keeps its content until the first update. */
  async function startRound(input: Input) {
    const controller = (inFlight = new AbortController());
    try {
      const { settings, keySources, proxyPassword, roundConfigurationRevision } = await latestSettings();
      if (controller.signal.aborted) return;
      const resolved = providerConfiguration(settings, keySources(settings.activePreset), proxyPassword);
      if ("error" in resolved) {
        publish(snapshot.round, { configurationFailure: resolved.error });
        return;
      }
      const provider = resolved.configuration;
      currentInputSent = true;
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
        // A Round configuration change also invalidates a result still being produced with older settings.
        roundConfigurationRevision === settingsSnapshot().roundConfigurationRevision &&
        completed &&
        (completed.state.outcome === "done" || completed.state.outcome === "no-text")
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
      onRoundConfigurationChange(() => {
        lastSuccessful = null;
        // A notice's advice is stale once its configuration changes; the user's next copy or show runs a Round (#112).
        if (snapshot.configurationFailure) publish(snapshot.round, { configurationFailure: null });
      });
      const followDisplayMode = () => {
        const { displayMode } = settingsSnapshot().settings;
        if (displayMode !== snapshot.displayMode) publish(snapshot.round, { displayMode });
      };
      subscribeSettings(followDisplayMode);
      followDisplayMode();
      await listen("pin-window-hidden", () => {
        if (snapshot.paused) publish(snapshot.round, { paused: false });
        for (const notify of hiddenSubscribers) notify();
      });
      await listen<InputEvent>("input", ({ payload }) => {
        if (payload.origin === "copy" && snapshot.paused) return;
        // Nothing usable on show keeps the current content.
        if (
          !payload.input ||
          (payload.origin === "copy" && currentInputSent && sameInput(currentInput, payload.input))
        ) {
          return;
        }
        // A Round still running on the shown Input keeps running and shows its whole result.
        if (payload.origin === "show" && inFlight && sameInput(currentInput, payload.input)) return;
        inFlight?.abort();
        inFlight = null;
        currentInput = payload.input;
        currentInputSent = false;
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
    view: () => view,
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
    chooseDisplayMode(displayMode) {
      // The Pin window has no room for a notice, and a tab that doesn't change says nothing of why.
      saveSettings({ displayMode }).catch((reason) => {
        console.error("Display mode was not saved:", reason);
        command("show_native_notification", { title: strings.settingsNotSaved, body: String(reason), target: null });
      });
    },
    copyPane(pane) {
      const state = snapshot.round?.state;
      const copyable = pane === "source" ? view.canCopySource : view.canCopyTranslation;
      // The app's own copy, which the clipboard follower knows as sidelingo's and so starts no Round.
      if (state && copyable) command("copy_text", { text: state[pane].text });
    },
    openSettings: () => command("open_settings"),
    hide: () => command("hide_pin_window"),
    onHidden(notify) {
      hiddenSubscribers.add(notify);
      return () => hiddenSubscribers.delete(notify);
    },
  };
}

/** Invokes a Rust command whose failure the user can do nothing more about, so it is only logged. */
function command(name: string, args?: Record<string, unknown>) {
  invoke(name, args).catch((reason) => console.error(`\`${name}\` failed:`, reason));
}

/** Identity belongs to the session; text and image payloads compare as delivered. */
function sameInput(left: Input | undefined | null, right: Input): boolean {
  if (left?.kind === "text" && right.kind === "text") return left.text === right.text;
  return left?.kind === "image" && right.kind === "image" && left.dataUrl === right.dataUrl;
}

/** Results and action availability come from the same Pin view. */
export function usePinView(session: Session): PinView {
  return useSyncExternalStore(session.subscribe, session.view);
}
