import { expectTooltip } from "../tooltip";
import { relaunch } from "../app";
import { readClipboardText, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";

const source = "**A readable source line.**";
const translation = "**A translated line.**";
const sourceButton = () => $("button[aria-label='Copy source']");
const translationButton = () => $("button[aria-label='Copy translation']");
let provider: FakeProvider;

describe("Copying results", () => {
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("copies complete Markdown text without starting another Round", async () => {
    provider.reset([{ delta: { content: translation } }]);
    writeClipboardText(source);
    await relaunch({ settings: customSettings(provider) });
    await translationButton().waitForEnabled();
    await $("[role=toolbar]").moveTo();
    await sourceButton().click();
    await browser.waitUntil(() => readClipboardText() === source);
    await translationButton().click();
    await browser.waitUntil(() => readClipboardText() === translation);
    await browser.pause(500);
    expect(provider.requests).toHaveLength(1);
    await expect($("p")).toHaveText("A translated line.");
  });

  it("enables Source and Regenerate for the fast path but waits until Translation is complete", async () => {
    const hold = gate();
    provider.reset([{ delta: { content: "Partial translation" } }, hold]);
    writeClipboardText(" ");
    await relaunch({ settings: customSettings(provider) });
    try {
      await expect(sourceButton()).toBeDisabled();
      await expect(translationButton()).toBeDisabled();
      await expect($("button[aria-label^='Regenerate']")).toBeDisabled();
      writeClipboardText(source);
      await expect($("p")).toHaveText("Partial translation");
      await expect(sourceButton()).toBeEnabled();
      await expect(translationButton()).toBeDisabled();
      await expect($("button[aria-label^='Regenerate']")).toBeEnabled();
      hold.open();
      await translationButton().waitForEnabled();
    } finally {
      hold.open();
    }
  });

  it("waits until Structuring has completed before enabling Copy source", async () => {
    const structure = gate();
    const translate = gate();
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content)
        ? [{ delta: { content: "## Partial source" } }, structure]
        : [translate, { delta: { content: "Complete translation" } }],
    );
    writeClipboardText("First line\nsecond line");
    await relaunch({ settings: customSettings(provider) });
    try {
      await expect($("h2")).toHaveText("Partial source");
      await expect(sourceButton()).toBeDisabled();
      await expect(translationButton()).toBeDisabled();
      structure.open();
      await sourceButton().waitForEnabled();
      await expect(translationButton()).toBeDisabled();
      await $("[role=toolbar]").moveTo();
      await sourceButton().click();
      await browser.waitUntil(() => readClipboardText() === "## Partial source");
      expect(provider.requests).toHaveLength(2);
      translate.open();
      await translationButton().waitForEnabled();
    } finally {
      structure.open();
      translate.open();
    }
  });

  for (const [language, sourceName, translationName, regenerateName, pauseName] of [
    ["en-US", "Copy source", "Copy translation", "Regenerate (Ctrl+R / F5)", "Pause clipboard monitoring"],
    ["zh-TW", "复制原文", "复制译文", "重新生成 (Ctrl+R / F5)", "暂停监视剪贴板"],
  ]) {
    it(`names copy and Round controls in localized tooltips under ${language}`, async () => {
      provider.reset([{ delta: { content: translation } }]);
      writeClipboardText(source);
      await relaunch({ language, settings: customSettings(provider) });
      await $(`button[aria-label='${translationName}']`).waitForEnabled();
      for (const name of [sourceName, translationName, regenerateName, pauseName]) {
        await expectTooltip(await $(`button[aria-label='${name}']`).getElement(), name);
      }
    });
  }
});
