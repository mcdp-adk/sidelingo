import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataFolders, identifier, relaunch } from "../app";
import { clearClipboard } from "../clipboard";
import { openSettings, expectShownOption } from "../settings";

describe("settings recovery", () => {
  it("sets aside invalid JSON, loads defaults, and writes a fresh file on the next save", async () => {
    clearClipboard();
    await relaunch({ settingsText: "{bad json" });

    await openSettings();
    const preset = $("select[aria-label='Preset']");
    await expectShownOption(preset, "Choose a Provider");

    const folder = dataFolders(identifier).roaming;
    const brokenFile = join(folder, "settings.json.broken");
    const settingsFile = join(folder, "settings.json");
    expect(existsSync(brokenFile)).toBe(true);
    expect(readFileSync(brokenFile, "utf8")).toBe("{bad json");

    await preset.selectByVisibleText("Custom");
    await browser.waitUntil(() => existsSync(settingsFile), { timeout: 5_000 });

    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toMatchObject({
      schemaVersion: 1,
      activePreset: "custom",
    });
  });
});
