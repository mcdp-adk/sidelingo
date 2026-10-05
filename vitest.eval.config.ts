import { defineConfig } from "vitest/config";

// The Structuring eval (ADR 0006): no pass or fail, spends tokens, so only `pnpm eval:structuring` runs it.
// Node's fetch follows HTTPS_PROXY and NO_PROXY as the app follows the System proxy; workers inherit this.
process.env.NODE_USE_ENV_PROXY = "1";

export default defineConfig({
  test: {
    include: ["eval/**/*.eval.ts"],
    testTimeout: 30 * 60_000,
  },
});
