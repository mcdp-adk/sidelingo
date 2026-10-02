import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataFolders, identifier, relaunch } from "../app";
import { clearClipboard } from "../clipboard";
import { openSettings } from "../settings";

describe("settings recovery", () => {
  it("sets aside invalid JSON, loads defaults, and writes a fresh file on the next save", async () => {
    clearClipboard();
    await relaunch({ settingsText: "{bad json" });

    await openSettings();
    const preset = $("select[aria-label='Preset']");
    await expect(preset).toHaveValue("");

    const folder = dataFolders(identifier).roaming;
    const brokenFile = join(folder, "settings.json.broken");
    const settingsFile = join(folder, "settings.json");
    expect(existsSync(brokenFile)).toBe(true);
    expect(readFileSync(brokenFile, "utf8")).toBe("{bad json");

    await preset.selectByAttribute("value", "custom");
    await browser.waitUntil(() => existsSync(settingsFile), { timeout: 5_000 });

    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toMatchObject({
      schemaVersion: 1,
      activePreset: "custom",
    });
  });

  it("sets aside valid JSON rejected by the schema, loads defaults, and saves a fresh file", async () => {
    clearClipboard();
    const rejected = JSON.stringify({
      schemaVersion: 99,
      activePreset: "custom",
      presets: { custom: { baseUrl: "http://127.0.0.1:9/v1", model: "rejected-model" } },
    });
    await relaunch({ settingsText: rejected });

    await openSettings();
    const preset = $("select[aria-label='Preset']");
    await expect(preset).toHaveValue("");

    const folder = dataFolders(identifier).roaming;
    const brokenFile = join(folder, "settings.json.broken");
    const settingsFile = join(folder, "settings.json");
    expect(existsSync(brokenFile)).toBe(true);
    expect(readFileSync(brokenFile, "utf8")).toBe(rejected);

    await preset.selectByAttribute("value", "custom");
    await browser.waitUntil(() => existsSync(settingsFile), { timeout: 5_000 });
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toMatchObject({
      schemaVersion: 1,
      activePreset: "custom",
    });
  });

  it("distinguishes a missing settings file from persisted JSON null", async () => {
    clearClipboard();
    await relaunch();

    await openSettings();
    await expect($("select[aria-label='Preset']")).toHaveValue("");
    const folder = dataFolders(identifier).roaming;
    const brokenFile = join(folder, "settings.json.broken");
    expect(existsSync(brokenFile)).toBe(false);

    await relaunch({ settingsText: "null" });
    await openSettings();
    await expect($("select[aria-label='Preset']")).toHaveValue("");
    expect(existsSync(brokenFile)).toBe(true);
    expect(readFileSync(brokenFile, "utf8")).toBe("null");
  });
});
