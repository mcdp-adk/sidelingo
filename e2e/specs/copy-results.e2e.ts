import { expectTooltip } from "../support/tooltip";
import { relaunch } from "../support/app";
import { writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider } from "../support/provider";

const source = "**A readable source line.**";
const translation = "**A translated line.**";
let provider: FakeProvider;

describe("Copying results", () => {
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
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
