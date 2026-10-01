import { mkdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { capabilities, dataFolders, identifier, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider } from "../provider";
import { openSettings, replaceTextField } from "../settings";

describe("Provider settings", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });
  it("opens one Settings window from the toolbar and Ctrl+, and leaves it open on Esc", async () => {
    clearClipboard();
    await relaunch();
    const pin = await browser.getWindowHandle();
    await $("[role=toolbar]").moveTo();
    await $("button[aria-label='Settings (Ctrl+,)']").click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
    const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
    await browser.switchToWindow(settings);
    await expect($("h1")).toHaveText("Settings");
    await browser.keys("Escape");
    expect(await browser.getWindowHandles()).toContain(settings);
    await browser.switchToWindow(pin);
    await browser.keys(["Control", ","]);
    expect(await browser.getWindowHandles()).toHaveLength(2);
    await browser.switchToWindow(settings);
    await expect($("h1")).toHaveText("Settings");
  });

  it("commits Custom fields on Enter and blur, applying them only to the next Round", async () => {
    provider.reset();
    const first = `already-shown-${Date.now()}`;
    writeClipboardText(first);
    await relaunch({ settings: customSettings(provider, { model: "previous-model" }) });
    await expect($("p")).toHaveText(first);
    const { pin, settings } = await openSettings();
    await $("select[aria-label='Preset']").selectByAttribute("value", "custom");
    await replaceTextField("Model", "next-model");
    // Moving between WebDriver contexts does not blur the webview's focused field.
    await browser.switchToWindow(pin);
    const draft = `uncommitted-${Date.now()}`;
    writeClipboardText(draft);
    await expect($("p")).toHaveText(draft);
    expect(provider.requests.at(-1)?.body.model).toBe("previous-model");
    await browser.switchToWindow(settings);
    await $("input[aria-label='Model']").click();
    await browser.keys("Enter");
    await $("input[aria-label='Base URL']").setValue(`${provider.baseUrl}/next`);
    await $("h1").click();
    await browser.switchToWindow(pin);
    await expect($("p")).toHaveText(draft);
    expect(provider.requests).toHaveLength(2);
    const next = `next-round-${Date.now()}`;
    writeClipboardText(next);
    await expect($("p")).toHaveText(next);
    expect(provider.requests.at(-1)).toMatchObject({
      path: "/v1/next/chat/completions",
      body: { model: "next-model" },
    });
  });

  it("retains independent Preset models and the Custom Base URL after switching and restarting", async () => {
    clearClipboard();
    await relaunch();
    await openSettings();
    const preset = () => $("select[aria-label='Preset']");
    await expect(preset()).toHaveValue("");
    await expect($("input[aria-label='Model']")).not.toExist();
    await preset().selectByAttribute("value", "custom");
    await $("input[aria-label='Base URL']").setValue(provider.baseUrl);
    await browser.keys("Enter");
    await replaceTextField("Model", "free-form/model@custom");
    await browser.keys("Enter");
    for (const id of ["openai", "openrouter", "deepseek", "ollama-cloud"]) {
      await preset().selectByAttribute("value", id);
      await expect($("input[aria-label='Base URL']")).not.toExist();
      await replaceTextField("Model", `${id}-saved`);
      await browser.keys("Enter");
    }
    await preset().selectByAttribute("value", "custom");
    await expect($("input[aria-label='Base URL']")).toHaveValue(provider.baseUrl);
    await expect($("input[aria-label='Model']")).toHaveValue("free-form/model@custom");
    expect(await $("option[value='']").getAttribute("disabled")).not.toBeNull();

    // Preserve the application's data; relaunch() intentionally resets it for a new test.
    await browser.reloadSession(capabilities());
    await openSettings();
    await expect(preset()).toHaveValue("custom");
    await expect($("input[aria-label='Base URL']")).toHaveValue(provider.baseUrl);
    await expect($("input[aria-label='Model']")).toHaveValue("free-form/model@custom");
    for (const id of ["openai", "openrouter", "deepseek", "ollama-cloud"]) {
      await preset().selectByAttribute("value", id);
      await expect($("input[aria-label='Model']")).toHaveValue(`${id}-saved`);
    }
  });

  it("keeps a failed save above the scrolling page, shows the system reason, and retains the committed Provider", async () => {
    provider.reset();
    clearClipboard();
    await relaunch({ settings: customSettings(provider, { model: "saved-model" }) });
    const { pin, settings } = await openSettings();
    const settingsFile = join(dataFolders(identifier).roaming, "settings.json");
    // A directory at the file's destination makes the real atomic replacement fail.
    unlinkSync(settingsFile);
    mkdirSync(settingsFile);
    try {
      await replaceTextField("Model", "unsaved-model");
      await browser.keys("Enter");
      const message = () => $("[role=group]");
      await expect(message()).toHaveText(/Settings were not saved[\s\S]+0x80070005/i);
      await browser.setWindowSize(420, 400);
      await $("h2=About").scrollIntoView();
      await expect(message()).toBeDisplayed();
      const messageBottom = (await message().getLocation("y")) + (await message().getSize("height"));
      expect(messageBottom).toBeLessThanOrEqual(await $("main").getLocation("y"));
      await browser.switchToWindow(pin);
      const copied = `after-failed-save-${Date.now()}`;
      writeClipboardText(copied);
      await expect($("p")).toHaveText(copied);
      expect(provider.requests.at(-1)?.body.model).toBe("saved-model");
      await browser.switchToWindow(settings);
    } finally {
      rmdirSync(settingsFile);
    }
  });
});
