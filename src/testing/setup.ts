import { vi } from "vitest";

// Tauri's IPC mocks keep their internals on `window`; Node has none, so the global object stands in.
vi.stubGlobal("window", globalThis);
// The UI language and the initial Target language follow `navigator.language` when their modules load.
// Core tests never depend on the machine's locale; a test about another locale stubs it itself and
// re-imports the modules (`vi.resetModules()`).
vi.stubGlobal("navigator", { language: "en-US" });
