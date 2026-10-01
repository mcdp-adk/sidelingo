import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { appExe, dataFolders, identifier, ownerIdentifier, relaunch } from "../app";
import { psString, runPowerShell } from "../powershell";
import { inspectWindows } from "../window";

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

/** Process ids of every running sidelingo other than the e2e build. */
function otherSidelingos(): string {
  return runPowerShell(
    `Get-Process sidelingo -ErrorAction SilentlyContinue | Where-Object { $_.Path -ne ${psString(appExe)} } | ForEach-Object Id`,
  );
}

describe("Launching sidelingo", () => {
  it("shows the Pin window from empty data folders, leaving the owner's own untouched", async () => {
    const ownerSettings = snapshot(owner.roaming);
    const ownerWebViewExists = existsSync(owner.local);
    const others = otherSidelingos();

    await relaunch();

    await expect($("body")).toHaveText("Copy text or an image to see it here.");
    expect(inspectWindows(appExe, "sidelingo").map((w) => w.visible)).toEqual([true]);
    expect(existsSync(dataFolders(identifier).local)).toBe(true);
    expect(snapshot(owner.roaming)).toEqual(ownerSettings);
    expect(existsSync(owner.local)).toBe(ownerWebViewExists);
    expect(otherSidelingos()).toBe(others);
  });

  it("keeps the Pin window on top, out of the taskbar and Alt+Tab, with no minimize or maximize", () => {
    const [pin] = inspectWindows(appExe, "sidelingo");
    expect(pin).toMatchObject({ topmost: true, appWindow: false, minimizeBox: false, maximizeBox: false });
    expect(pin.owned || pin.toolWindow).toBe(true);
  });
});
