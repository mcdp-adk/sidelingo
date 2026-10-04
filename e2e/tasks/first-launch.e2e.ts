import { relaunch } from "../support/app";
import { clearClipboard, readClipboardText, writeClipboardText } from "../support/clipboard";
import { FakeProvider, gate } from "../support/provider";
import { expectShownOption, replaceTextField } from "../support/settings";

// The WebView's language stands in for Windows' display language, which picks the UI language.
const locales = [
  {
    language: "en-US",
    emptyHint: "Copy text or an image to see it here.",
    chooseProvider: "Choose a Provider",
    openSettings: "Open settings",
    settings: "Settings",
    provider: "Provider",
    preset: "Preset",
    custom: "Custom",
    model: "Model",
    reasoningEffort: "Reasoning effort",
    copyTranslation: "Copy translation",
  },
  {
    language: "zh-CN",
    emptyHint: "复制文本或图片，结果会显示在这里。",
    chooseProvider: "选择服务商",
    openSettings: "打开设置",
    settings: "设置",
    provider: "服务商",
    preset: "预设",
    custom: "自定义",
    model: "模型",
    reasoningEffort: "推理强度",
    copyTranslation: "复制译文",
  },
];

describe("Task 1: a fresh install reaches a copied Translation", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  for (const ui of locales) {
    it(`walks from the choose-a-Provider notice to a copied Translation under ${ui.language}`, async () => {
      const stamp = Date.now();
      const first = `Bonjour ${stamp}`;
      const rest = ` and welcome ${stamp}`;
      const held = gate();
      provider.reset([{ delta: { content: first } }, held, { delta: { content: rest } }]);
      provider.models({ ids: ["catalog-alpha", "catalog-beta"] });

      clearClipboard();
      await relaunch({ language: ui.language });
      const pin = await browser.getWindowHandle();
      await expect($("p")).toHaveText(ui.emptyHint);
      writeClipboardText(`A line copied before setup ${stamp}`);
      const notice = $("[role=group]");
      await expect(notice).toHaveText(ui.chooseProvider, { containing: true });

      await notice.$(`button=${ui.openSettings}`).click();
      await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
      const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
      await browser.switchToWindow(settings);
      await expect($("h1")).toHaveText(ui.settings);
      await expect($(`h2=${ui.provider}`)).toBeDisplayed();
      const preset = $(`aria/${ui.preset}`);
      await expectShownOption(preset, ui.chooseProvider);

      await preset.selectByVisibleText(ui.custom);
      await replaceTextField("Base URL", provider.baseUrl);
      await browser.keys("Enter");
      await $(`aria/${ui.reasoningEffort}`).selectByVisibleText("low");
      // The Provider's models are offered once the Base URL is in; the user types a Model of their own,
      // commits it with Enter and copies straight away.
      await $(`aria/${ui.model}`).click();
      await expect($("aria/catalog-alpha")).toBeDisplayed();
      await replaceTextField(ui.model, "my-own-model");
      await browser.keys("Enter");

      await browser.switchToWindow(pin);
      const line = `A line copied after setup ${stamp}`;
      writeClipboardText(line);
      await expect($("p")).toHaveText(first);
      await $("[role=toolbar]").moveTo();
      const copyTranslation = $(`aria/${ui.copyTranslation}`);
      await expect(copyTranslation).toBeDisabled();
      held.open();
      await expect($("p")).toHaveText(first + rest);
      await expect(notice).not.toExist();

      await copyTranslation.click();
      await browser.waitUntil(() => readClipboardText() === first + rest, {
        timeoutMsg: "the clipboard never held the Translated text",
      });
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0].body).toMatchObject({ model: "my-own-model", reasoning_effort: "low" });
      expect(provider.requests[0].body.messages.at(-1).content).toContain(line);
    });
  }
});
