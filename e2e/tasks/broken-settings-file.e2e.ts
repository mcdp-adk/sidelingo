import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataFolders, identifier, relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { expectShownOption } from "../support/settings";

describe("Task 11: sidelingo starts from a broken settings file", () => {
  it("starts with defaults, sets the broken file aside, and writes a fresh file on the next change", async () => {
    const folder = dataFolders(identifier).roaming;
    const settingsFile = join(folder, "settings.json");
    const brokenFile = join(folder, "settings.json.broken");
    // A file cut short mid-write: it meant the Custom Preset, but it isn't JSON.
    const brokenText = '{"schemaVersion":1,"activePreset":"custom","presets":{"custom":{"model":"cut-sho';
    clearClipboard();
    await relaunch({ settingsText: brokenText });

    const pin = await browser.getWindowHandle();
    await expect($("p")).toHaveText("Copy text or an image to see it here.");
    writeClipboardText(`A line copied after a broken settings file ${Date.now()}`);
    const notice = $("[role=group]");
    await expect(notice).toHaveText("Choose a Provider", { containing: true });
    expect(readFileSync(brokenFile, "utf8")).toBe(brokenText);
    expect(existsSync(settingsFile)).toBe(false);

    await notice.$("button=Open settings").click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
    await browser.switchToWindow((await browser.getWindowHandles()).find((handle) => handle !== pin)!);
    const preset = $("aria/Preset");
    await expectShownOption(preset, "Choose a Provider");
    await expect($("aria/Hotkey")).toHaveText("Win+Alt+Q");

    await preset.selectByVisibleText("Custom");
    await browser.waitUntil(() => existsSync(settingsFile), { timeoutMsg: "no fresh settings file was written" });
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toMatchObject({ schemaVersion: 1, activePreset: "custom" });
    expect(readFileSync(brokenFile, "utf8")).toBe(brokenText);
  });
});
