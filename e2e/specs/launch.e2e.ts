import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appExe, dataFolders, identifier, ownerIdentifier, relaunch } from "../support/app";
import { clearClipboard } from "../support/clipboard";
import { inspectWindows } from "../support/window";

const owner = dataFolders(ownerIdentifier);

/** Every file under a folder with its size and modification time, or null when it doesn't exist. */
function snapshot(folder: string): Record<string, string> | null {
  if (!existsSync(folder)) return null;
  const entries: Record<string, string> = {};
  for (const name of readdirSync(folder, { recursive: true, encoding: "utf8" })) {
    const stat = statSync(join(folder, name));
    entries[name] = `${stat.size} ${stat.mtimeMs}`;
  }
  return entries;
}

describe("Launching sidelingo", () => {
  it("starts from an empty data folder and shows the Pin window", async () => {
    const { roaming } = dataFolders(identifier);
    mkdirSync(roaming, { recursive: true });
    writeFileSync(join(roaming, "left-over.json"), "{}");
    clearClipboard();

    await relaunch();

    expect(existsSync(join(roaming, "left-over.json"))).toBe(false);
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
    expect(inspectWindows(appExe, "sidelingo").map((w) => w.visible)).toEqual([true]);
  });

  it("keeps to its own data folders, leaving the owner's untouched", async () => {
    const ownerSettings = snapshot(owner.roaming);
    const ownerWebViewExists = existsSync(owner.local);

    await relaunch();

    expect(existsSync(dataFolders(identifier).local)).toBe(true);
    expect(snapshot(owner.roaming)).toEqual(ownerSettings);
    expect(existsSync(owner.local)).toBe(ownerWebViewExists);
  });

  it("keeps the Pin window on top, out of the taskbar and Alt+Tab, with no minimize or maximize", async () => {
    await relaunch();
    const [pin] = inspectWindows(appExe, "sidelingo");
    expect(pin).toMatchObject({ topmost: true, appWindow: false, minimizeBox: false, maximizeBox: false });
    expect(pin.owned || pin.toolWindow).toBe(true);
  });
});
