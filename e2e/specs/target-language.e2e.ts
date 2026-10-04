import { relaunch } from "../support/app";
import { clearClipboard } from "../support/clipboard";

async function openSettings({ shortcut = "Settings (Ctrl+,)", title = "Settings" } = {}) {
  const pin = await browser.getWindowHandle();
  await $("[role=toolbar]").moveTo();
  await expect($(`button[aria-label='${shortcut}']`)).toBeDisplayed();
  await browser.keys(["Control", ","]);
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
  await browser.switchToWindow((await browser.getWindowHandles()).find((handle) => handle !== pin)!);
  await expect($("h1")).toHaveText(title);
  return pin;
}

describe("Target language", () => {
  it("finds a language by its UI name, autonym, English name or tag, ignoring case", async () => {
    clearClipboard();
    await relaunch({ language: "zh-HK" });
    await openSettings({ shortcut: "设置 (Ctrl+,)", title: "设置" });
    const picker = () => $("[role=combobox][aria-label='目标语言']");
    for (const query of ["日语", "日本語", "JAPANESE", "JA"]) {
      await picker().click();
      await browser.keys(["Control", "a"]);
      await browser.keys(query);
      await expect($$("[role=listbox] [role=option]")).toBeElementsArrayOfSize(1);
      await expect($("[role=listbox] [role=option]")).toHaveText(/日语[\s\S]*日本語/);
    }
  });
});
