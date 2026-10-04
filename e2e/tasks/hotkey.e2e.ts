import { capabilities, relaunch } from "../support/app";
import { clearClipboard } from "../support/clipboard";
import { reserveHotkey } from "../support/hotkey";
import { openSettings } from "../support/settings";

// Windows RegisterHotKey modifiers and virtual keys for the combinations the user records.
const MOD_ALT = 0x1;
const MOD_CONTROL = 0x2;
const MOD_SHIFT = 0x4;
const MOD_WIN = 0x8;
const VK_Q = 0x51;
const VK_F9 = 0x78;
const VK_F10 = 0x79;

/** Whether another process can take the combination now, so sidelingo no longer holds it. */
async function isFree(modifiers: number, virtualKey: number): Promise<boolean> {
  const probe = await reserveHotkey(modifiers, virtualKey);
  await probe.close();
  return probe.registered;
}

describe("Task 8: the user changes the hotkey", () => {
  it("records a combination, keeps it over a taken one and a restart, and clears it", async () => {
    clearClipboard();
    await relaunch();
    await openSettings();
    const recorder = () => $("aria/Hotkey");
    await expect(recorder()).toHaveText("Win+Alt+Q");

    // A key without a modifier is refused while recording continues; Esc gives up the recording.
    await recorder().click();
    await browser.keys("x");
    await expect($("body")).toHaveText(/Use Ctrl, Alt, Shift, or Win in the combination\./);
    await expect(recorder()).toHaveText("Press a combination…");
    await browser.keys("Escape");
    await expect(recorder()).toHaveText("Win+Alt+Q");
    await expect($("body")).not.toHaveText(/Use Ctrl, Alt, Shift, or Win/);

    await recorder().click();
    await browser.keys(["Control", "Shift", "F9"]);
    await expect(recorder()).toHaveText("Ctrl+Shift+F9");
    expect(await isFree(MOD_CONTROL | MOD_SHIFT, VK_F9)).toBe(false);
    expect(await isFree(MOD_WIN | MOD_ALT, VK_Q)).toBe(true);

    // Another process holds Ctrl+Shift+F10, so recording it is refused and Ctrl+Shift+F9 stays.
    const taken = await reserveHotkey(MOD_CONTROL | MOD_SHIFT, VK_F10);
    try {
      expect(taken.registered).toBe(true);
      await recorder().click();
      await browser.keys(["Control", "Shift", "F10"]);
      await expect($("body")).toHaveText(/os error 1409/);
      await expect(recorder()).toHaveText("Ctrl+Shift+F9");
      expect(await isFree(MOD_CONTROL | MOD_SHIFT, VK_F9)).toBe(false);
    } finally {
      await taken.close();
    }

    await browser.reloadSession(capabilities());
    await openSettings();
    await expect(recorder()).toHaveText("Ctrl+Shift+F9");
    expect(await isFree(MOD_CONTROL | MOD_SHIFT, VK_F9)).toBe(false);

    await $("button=Clear").click();
    await expect(recorder()).toHaveText("None");
    expect(await isFree(MOD_CONTROL | MOD_SHIFT, VK_F9)).toBe(true);
    await browser.reloadSession(capabilities());
    await openSettings();
    await expect(recorder()).toHaveText("None");
  });
});
