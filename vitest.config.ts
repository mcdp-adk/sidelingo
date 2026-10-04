import { defineConfig } from "vitest/config";

// The webview core layer: plain Node, with the Rust side played by Tauri's IPC mocks (ADR 0006).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testing/setup.ts"],
  },
});
