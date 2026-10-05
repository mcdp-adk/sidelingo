import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { e2eConfig, e2eConfigPath, root } from "./config";
import { useLaunchEnvironment, type LaunchEnvironment } from "./driver";
import { psString, runPowerShell } from "./powershell";
import { inspectWindows } from "./window";

/** The e2e build's own identifier, which names its AppData folders and single-instance lock. */
export const identifier: string = e2eConfig.identifier;

/** Built apart from `tauri dev` and release builds, so neither overwrites the other. */
const targetDir = join(root, "src-tauri", "target", "e2e");
export const appExe = join(targetDir, "debug", "sidelingo.exe");

/** Folders named by an identifier, per ADR 0004: settings in Roaming, WebView2 data in Local. */
export function dataFolders(id: string) {
  return { roaming: join(process.env.APPDATA!, id), local: join(process.env.LOCALAPPDATA!, id) };
}

function filesBelow(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      return entry.isDirectory() ? filesBelow(path) : entry.isFile() ? [path] : [];
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Each private value found in a file under either of the e2e build's data folders, as "<name> in <path>". */
export function dataFolderLeaks(values: Record<string, string | Buffer>): string[] {
  const { roaming, local } = dataFolders(identifier);
  return [roaming, local].flatMap((folder) =>
    filesBelow(folder).flatMap((path) => {
      const contents = readFileSync(path);
      return Object.entries(values)
        .filter(([, value]) => contents.includes(value))
        .map(([name]) => `${name} in ${path}`);
    }),
  );
}

export function buildApp(): void {
  execFileSync("pnpm", ["tauri", "build", "--debug", "--no-bundle", "--config", e2eConfigPath], {
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
  /** Raw settings file contents to seed before launch, for a broken document; without them the data folders start empty. */
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
export function resetDataFolders({ settingsText }: Launch = {}): void {
  const { roaming, local } = dataFolders(identifier);
  // The WebView2 browser process can hold its folder for a moment after the app quits.
  for (const folder of [roaming, local]) rmSync(folder, { recursive: true, force: true, maxRetries: 20 });
  if (settingsText !== undefined) {
    mkdirSync(roaming, { recursive: true });
    writeFileSync(join(roaming, "settings.json"), settingsText);
  }
}

/** Quits the app and launches it again from fresh data folders, returning once the Pin window shows. */
export async function relaunch(launch: Launch = {}): Promise<void> {
  await browser.deleteSession();
  await useLaunchEnvironment(launch.environment);
  resetDataFolders(launch);
  // reloadSession's own attempt to end the already ended session is logged and ignored.
  await browser.reloadSession(capabilities(launch));
  usesItsOwnDataFolders();
  // An Autostart launch stays in the tray, so there is no window to wait for.
  if (!launch.args?.includes("--autostart")) await pinWindowShows();
}

/**
 * Fails every launch whose app doesn't create the e2e identifier's WebView2 folder, emptied just before, so a build
 * made without `tauri.e2e.conf.json` can't go on using and changing the owner's own sidelingo data.
 */
function usesItsOwnDataFolders(): void {
  if (!existsSync(dataFolders(identifier).local)) {
    throw new Error(
      `The app started without creating ${dataFolders(identifier).local}, so it isn't the e2e build (${identifier}). Rebuild it with pnpm test:e2e before it touches your own sidelingo's data.`,
    );
  }
}

/** Quits the app keeping its data, returning once its process has exited and its files are free. */
export async function quit(): Promise<void> {
  await browser.deleteSession();
  const running = () =>
    runPowerShell(
      `(Get-Process sidelingo -ErrorAction SilentlyContinue | Where-Object Path -eq ${psString(appExe)}).Id`,
    ).trim() !== "";
  await browser.waitUntil(() => !running(), { timeoutMsg: "the app did not quit" });
}

/** A real second launch shows the existing hidden Pin window. */
export async function showAgain(): Promise<void> {
  const secondLaunch = spawn(appExe, { stdio: "ignore", windowsHide: true });
  const [code] = await once(secondLaunch, "exit");
  expect(code).toBe(0);
  await pinWindowShows();
}

/** Waits until the Pin window is hidden, as after Esc or Close. */
export async function pinWindowHides(): Promise<void> {
  await browser.waitUntil(() => !inspectWindows(appExe, "sidelingo")[0]?.visible, {
    timeoutMsg: "the Pin window is still visible",
  });
}

/** How many Pin windows the app has, shown or hidden. */
export const pinWindowCount = (): number => inspectWindows(appExe, "sidelingo").length;

async function pinWindowShows(): Promise<void> {
  await browser.waitUntil(() => inspectWindows(appExe, "sidelingo")[0]?.visible, {
    timeoutMsg: "the Pin window did not show",
  });
}
