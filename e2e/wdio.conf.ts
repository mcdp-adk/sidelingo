import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildApp, capabilities, resetDataFolders } from "./app";
import { SevereServiceError } from "webdriverio";
import { driverDir, startDriver, stopDriver } from "./driver";

/** A failing test leaves its screenshot and page source here. */
const failuresDir = resolve(import.meta.dirname, "failures");

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [capabilities()],
  logLevel: "warn",
  // A session that can't start won't start on a retry either.
  connectionRetryCount: 0,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },

  onPrepare() {
    try {
      rmSync(failuresDir, { recursive: true, force: true });
      buildApp();
      mkdirSync(driverDir, { recursive: true });
      execFileSync("msedgedriver-tool", { cwd: driverDir, stdio: "inherit" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SevereServiceError(`E2E preparation failed: ${message}`);
    }
  },

  // Every spec file starts the app from empty data folders.
  async beforeSession() {
    resetDataFolders();
    await startDriver();
  },

  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const name = `${test.parent} ${test.title}`.replace(/[^\w.-]+/g, "_");
    mkdirSync(failuresDir, { recursive: true });
    try {
      await browser.saveScreenshot(join(failuresDir, `${name}.png`));
      writeFileSync(join(failuresDir, `${name}.html`), await browser.getPageSource());
    } catch (error) {
      // A test that hid the window or lost its session can leave nothing to capture.
      console.warn(`Couldn't capture "${name}": ${error}`);
    }
  },

  async afterSession() {
    await stopDriver();
  },
};
