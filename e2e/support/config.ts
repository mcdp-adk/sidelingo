import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The repository root. */
export const root = resolve(import.meta.dirname, "..", "..");

/** The config the e2e build is made with, merged over `tauri.conf.json`. */
export const e2eConfigPath = join(root, "src-tauri", "tauri.e2e.conf.json");
export const e2eConfig = JSON.parse(readFileSync(e2eConfigPath, "utf8"));
