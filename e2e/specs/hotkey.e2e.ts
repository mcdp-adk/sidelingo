import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capabilities, dataFolders, identifier, relaunch } from "../support/app";
import { clearClipboard } from "../support/clipboard";
import { openSettings } from "../support/settings";
import { reserveHotkey } from "../support/hotkey";

describe("Hotkey settings", () => {
  it("flags a stored hotkey that another process owns before startup without changing the stored combination", async () => {
    clearClipboard();
    await relaunch();
    await openSettings();
    const recorder = () => $("button[aria-label='Hotkey']");
    await recorder().click();
    await browser.keys(["Control", "Shift", "F9"]);
    await expect(recorder()).toHaveText("Ctrl+Shift+F9");
    await browser.deleteSession();

    // The app has exited, so another process takes the genuinely persisted chord.
    const occupied = await reserveHotkey(0x2 | 0x4, 0x78);
    try {
      expect(occupied.registered).toBe(true);
      await browser.reloadSession(capabilities());
      await openSettings();
      await expect(recorder()).toHaveText("Ctrl+Shift+F9");
      await expect($("body")).toHaveText(/os error 1409/, { containing: true });
      await expect(recorder()).toHaveAttribute("aria-invalid", "true");
    } finally {
      await occupied.close();
    }
  });

  it("keeps the saved hotkey registered and releases the candidate when saving fails", async () => {
    clearClipboard();
    await relaunch();
    await openSettings();
    const recorder = () => $("button[aria-label='Hotkey']");
    await recorder().click();
    await browser.keys(["Control", "Shift", "F9"]);
    await expect(recorder()).toHaveText("Ctrl+Shift+F9");
    const settingsFile = join(dataFolders(identifier).roaming, "settings.json");
    const stored = readFileSync(settingsFile);
    unlinkSync(settingsFile);
    // The existing isolated-file fixture makes the real atomic replacement fail.
    mkdirSync(settingsFile);
    try {
      await recorder().click();
      await browser.keys(["Control", "Shift", "F10"]);
      await expect($("body")).toHaveText(/0x80070005/i, { containing: true });
      await expect(recorder()).toHaveText("Ctrl+Shift+F9");
      await expect(recorder()).toBeEnabled();
      const retained = await reserveHotkey(0x2 | 0x4, 0x78);
      try {
        expect(retained).toMatchObject({ registered: false, error: 1409 });
      } finally {
        await retained.close();
      }
      const released = await reserveHotkey(0x2 | 0x4, 0x79);
      try {
        expect(released.registered).toBe(true);
      } finally {
        await released.close();
      }
      await expect($("body")).toHaveText(/Settings were not saved[\s\S]+0x80070005/i, { containing: true });
    } finally {
      rmdirSync(settingsFile);
      writeFileSync(settingsFile, stored);
    }
  });
});
