import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appExe, buildApp, capabilities, resetDataFolders } from "./support/app";
import { SevereServiceError } from "webdriverio";
import { driverDir, startDriver, stopDriver } from "./support/driver";
import { reserveHotkey } from "./support/hotkey";
import { psString, runPowerShell } from "./support/powershell";

/** A failing test leaves its screenshot and page source here. */
const failuresDir = resolve(import.meta.dirname, "failures");

/**
 * One run per machine, across every checkout: each run drives the real clipboard, the default hotkey and the e2e
 * build's data folders. The file holds the owning run's process id.
 */
const runLock = join(tmpdir(), "sidelingo-e2e.lock");

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function takeRunLock(): void {
  try {
    writeFileSync(runLock, String(process.pid), { flag: "wx" });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const owner = Number(readFileSync(runLock, "utf8"));
  // An empty file is a run that has just taken the lock.
  if (!owner || isRunning(owner)) {
    throw new Error(`another e2e run (process ${owner || "starting"}) is using this machine; wait for it to finish`);
  }
  // The owner exited without releasing it.
  writeFileSync(runLock, String(process.pid));
}

function releaseRunLock(): void {
  try {
    if (Number(readFileSync(runLock, "utf8")) === process.pid) rmSync(runLock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** A leftover e2e app, or another owner of the default hotkey, would taint every launch. */
async function expectNothingHeldOver(): Promise<void> {
  const running = runPowerShell(
    `(Get-Process sidelingo -ErrorAction SilentlyContinue | Where-Object Path -eq ${psString(appExe)}).Id`,
  ).trim();
  if (running) throw new Error(`the e2e app is still running as process ${running.split(/\s+/).join(", ")}`);
  // Windows MOD_WIN | MOD_ALT, VK_Q: the default hotkey every launch registers.
  const hotkey = await reserveHotkey(0x8 | 0x1, 0x51);
  await hotkey.close();
  if (!hotkey.registered) {
    throw new Error(
      `another process holds Win+Alt+Q (error ${hotkey.error}); quit sidelingo or the probe that reserved it`,
    );
  }
}

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./tasks/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [capabilities()],
  logLevel: "warn",
  // A session that can't start won't start on a retry either.
  connectionRetryCount: 0,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },

  async onPrepare() {
    try {
      takeRunLock();
      await expectNothingHeldOver();
      rmSync(failuresDir, { recursive: true, force: true });
      buildApp();
      mkdirSync(driverDir, { recursive: true });
      execFileSync("msedgedriver-tool", { cwd: driverDir, stdio: "inherit" });
    } catch (error) {
      releaseRunLock();
      const message = error instanceof Error ? error.message : String(error);
      throw new SevereServiceError(`E2E preparation failed: ${message}`);
    }
  },

  onComplete() {
    releaseRunLock();
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
