import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildApp, capabilities, resetDataFolders } from "./app";

// msedgedriver must match the installed WebView2 runtime; msedgedriver-tool fetches the matching one.
const driverDir = resolve(import.meta.dirname, "..", "node_modules", ".cache", "msedgedriver");
let tauriDriver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [capabilities()],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },

  onPrepare() {
    buildApp();
    mkdirSync(driverDir, { recursive: true });
    execFileSync("msedgedriver-tool", { cwd: driverDir, stdio: "inherit" });
  },

  // Every spec file starts the app from empty data folders.
  beforeSession() {
    resetDataFolders();
    tauriDriver = spawn("tauri-driver", ["--native-driver", join(driverDir, "msedgedriver.exe")], {
      stdio: [null, process.stdout, process.stderr],
    });
  },

  afterSession() {
    tauriDriver?.kill();
  },
};
