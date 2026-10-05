import { defineConfig } from "vitest/config";

// The real-Provider layer (ADR 0006): spends tokens, so only `pnpm test:real` runs it, never `pnpm test` or CI.
// Node's fetch follows HTTPS_PROXY and NO_PROXY as the app follows the System proxy; workers inherit this.
process.env.NODE_USE_ENV_PROXY = "1";

export default defineConfig({
  test: {
    include: ["src/**/*.real.ts"],
    testTimeout: 120_000,
  },
});
