import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The repository root. */
export const root = resolve(import.meta.dirname, "..", "..");

const readConfig = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** The config the e2e build is made with, merged over `tauri.conf.json`. */
export const e2eConfigPath = join(root, "src-tauri", "tauri.e2e.conf.json");
export const e2eConfig = readConfig(e2eConfigPath);

/** The e2e build's own identifier, which names its AppData folders and single-instance lock. */
export const identifier: string = e2eConfig.identifier;

// The harness empties and seeds the folders this identifier names. Stop before any launch, or any folder is
// touched, unless the e2e build has an identifier of its own, apart from the owner's sidelingo.
const appIdentifier: string = readConfig(join(root, "src-tauri", "tauri.conf.json")).identifier;
if (typeof identifier !== "string" || identifier === "" || identifier === appIdentifier) {
  throw new Error(
    `${e2eConfigPath} must give the e2e build an identifier other than sidelingo's own (${appIdentifier}), so its runs never touch your own sidelingo's data.`,
  );
}

/** Built apart from `tauri dev` and release builds, so neither overwrites the other. */
const targetDir = join(root, "src-tauri", "target", "e2e");
export const appExe = join(targetDir, "debug", "sidelingo.exe");

/** Builds the e2e app; `pnpm test:e2e` runs this first, and `pnpm build:e2e` runs it alone. */
export function buildApp(): void {
  execFileSync("pnpm", ["tauri", "build", "--debug", "--no-bundle", "--config", e2eConfigPath], {
    cwd: root,
    // Absolute: Cargo resolves a relative target dir from src-tauri.
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    stdio: "inherit",
    shell: true,
  });
}
