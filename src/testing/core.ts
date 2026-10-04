import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { Input, RoundState } from "../round/round";
import { createSession, type Session, type SessionState } from "../session/session";
import { startSettingsStore } from "../settings/settings-store";
import { FakeTransport } from "./fake-transport";

export { FakeTransport, type Reply, type SentRequest, type Step } from "./fake-transport";

/** A Custom Preset document pointing at the fake Provider, with `custom` fields merged over it. */
export function customSettings(custom: Record<string, unknown> = {}, document: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    activePreset: "custom",
    presets: { custom: { baseUrl: "https://provider.test/v1", model: "test-model", ...custom } },
    ...document,
  };
}

type Command = (args: any) => unknown;

export interface CoreOptions {
  /** The stored settings document `read_settings` returns, `null` included; a Custom Preset when left out. */
  settings?: unknown;
  /** The launch environment's Provider keys; every variable is unset by default. */
  keyEnvironment?: Record<string, string | null>;
  /** Ciphertexts `unprotect_secret` can decrypt for this Windows user; any other decrypts to null. */
  secrets?: Record<string, string>;
  /** Replaces or adds Rust commands. A command nobody played fails the call. */
  commands?: Record<string, Command>;
}

/** The started webview core: one Session, the fake Provider it reaches, and the Rust side it hears from. */
export interface Core {
  session: Session;
  provider: FakeTransport;
  /** Every Rust command the core invoked, in order. */
  invoked: { command: string; args: unknown }[];
  /** Rust's Input event for a copy; a string is a text Input. */
  copy(input: Input | string): Promise<void>;
  /** Rust's Input event when the Pin window shows, with the clipboard's Input or nothing usable. */
  show(input: Input | string | null): Promise<void>;
  /** Rust's event when the Pin window hides. */
  hide(): Promise<void>;
  /** Rust's event after it writes a new settings document. */
  changeSettings(document: unknown): Promise<void>;
  /** Resolves with the first published Session state that satisfies `predicate`, the current one included. */
  until(predicate: (state: SessionState) => boolean): Promise<SessionState>;
  /** The shown Round's state once it stops running (after one Input), and the core has settled. */
  roundEnds(): Promise<RoundState>;
}

const toInput = (input: Input | string): Input => (typeof input === "string" ? { kind: "text", text: input } : input);

/**
 * Starts the Pin webview's core as `main.tsx` does: the settings store, then one Session on a
 * fake transport. The Rust side is played through Tauri's IPC mocks, with event mocking.
 */
export async function startCore(options: CoreOptions = {}): Promise<Core> {
  const provider = new FakeTransport();
  const invoked: Core["invoked"] = [];
  const commands: Record<string, Command> = {
    read_key_environment: () => ({
      OPENAI_API_KEY: null,
      OPENROUTER_API_KEY: null,
      DEEPSEEK_API_KEY: null,
      OLLAMA_API_KEY: null,
      ...options.keyEnvironment,
    }),
    // A stored JSON `null` is a document too.
    read_settings: () => ({
      status: "document",
      document: "settings" in options ? options.settings : customSettings(),
    }),
    unprotect_secret: ({ ciphertext }) => options.secrets?.[ciphertext] ?? null,
    pin_window_ready: () => null,
    ...options.commands,
  };
  clearMocks();
  mockIPC(
    (command, args) => {
      invoked.push({ command, args });
      const played = commands[command];
      if (!played) throw new Error(`The core invoked \`${command}\`, which this test does not play.`);
      return played(args);
    },
    { shouldMockEvents: true },
  );

  await startSettingsStore();
  const session = createSession(provider.fetch);
  await session.start();

  const until: Core["until"] = (predicate) =>
    new Promise((resolve) => {
      const check = () => {
        const state = session.state();
        if (!predicate(state)) return false;
        unsubscribe();
        resolve(state);
        return true;
      };
      const unsubscribe = session.subscribe(check);
      check();
    });

  return {
    session,
    provider,
    invoked,
    copy: (input) => emit("input", { origin: "copy", input: toInput(input) }),
    show: (input) => emit("input", { origin: "show", input: input === null ? null : toInput(input) }),
    hide: () => emit("pin-window-hidden"),
    changeSettings: (document) => emit("settings-document-changed", document),
    until,
    roundEnds: async () => {
      await until((state) => state.round !== null && state.round.state.outcome !== "running");
      // Let anything the core does next happen before the test looks, such as a request it shouldn't send.
      await new Promise((resolve) => setTimeout(resolve));
      return session.state().round!.state;
    },
  };
}
