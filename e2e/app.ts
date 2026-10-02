import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { useLaunchEnvironment, type LaunchEnvironment } from "./driver";

const root = resolve(import.meta.dirname, "..");
const e2eConfig = join(root, "src-tauri", "tauri.e2e.conf.json");
const identifierIn = (config: string): string => JSON.parse(readFileSync(config, "utf8")).identifier;

/** The e2e build's own identifier, which names its AppData folders and single-instance lock. */
export const identifier = identifierIn(e2eConfig);
/** The identifier of the owner's own sidelingo. */
export const ownerIdentifier = identifierIn(join(root, "src-tauri", "tauri.conf.json"));

/** Built apart from `tauri dev` and release builds, so neither overwrites the other. */
const targetDir = join(root, "src-tauri", "target", "e2e");
export const appExe = join(targetDir, "debug", "sidelingo.exe");

/** Folders named by an identifier, per ADR 0004: settings in Roaming, WebView2 data in Local. */
export function dataFolders(id: string) {
  return { roaming: join(process.env.APPDATA!, id), local: join(process.env.LOCALAPPDATA!, id) };
}

export function buildApp(): void {
  execFileSync("pnpm", ["tauri", "build", "--debug", "--no-bundle", "--config", e2eConfig], {
    cwd: root,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    stdio: "inherit",
    shell: true,
  });
}

export interface Launch {
  /** Synthetic values inherited by this app only; null removes a variable for this launch. */
  environment?: LaunchEnvironment;
  /** Ordinary arguments delivered to the application executable. */
  args?: string[];
  /** The WebView's language, standing in for the Windows display language. */
  language?: string;
  /** A settings document to seed before launch; without one the data folders start empty. */
  settings?: unknown;
  /** Raw settings file contents for startup recovery scenarios. */
  settingsText?: string;
}

export function capabilities({ language = "en-US", args = [] }: Launch = {}): WebdriverIO.Capabilities {
  return {
    "tauri:options": {
      application: appExe,
      args,
      // msedgedriver passes these to the WebView2 browser process; `args` would go to the app itself.
      webviewOptions: { additionalBrowserArguments: [`--lang=${language}`] },
    },
  } as WebdriverIO.Capabilities;
}

/** Empties the e2e build's data folders, then seeds them. */
export function resetDataFolders({ settings, settingsText }: Launch = {}): void {
  const { roaming, local } = dataFolders(identifier);
  // The WebView2 browser process can hold its folder for a moment after the app quits.
  for (const folder of [roaming, local]) rmSync(folder, { recursive: true, force: true, maxRetries: 20 });
  if (settingsText !== undefined) {
    mkdirSync(roaming, { recursive: true });
    writeFileSync(join(roaming, "settings.json"), settingsText);
  } else if (settings !== undefined) {
    mkdirSync(roaming, { recursive: true });
    writeFileSync(join(roaming, "settings.json"), JSON.stringify(settings));
  }
}

/** Quits the app and launches it again from fresh data folders. */
export async function relaunch(launch: Launch = {}): Promise<void> {
  await browser.deleteSession();
  await useLaunchEnvironment(launch.environment);
  resetDataFolders(launch);
  // reloadSession's own attempt to end the already ended session is logged and ignored.
  await browser.reloadSession(capabilities(launch));
}
