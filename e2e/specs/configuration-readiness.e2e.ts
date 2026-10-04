import { relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider } from "../support/provider";
import { expectShownOption } from "../support/settings";

const noNamedKeys = {
  OPENAI_API_KEY: null,
  OPENROUTER_API_KEY: null,
  DEEPSEEK_API_KEY: null,
  OLLAMA_API_KEY: null,
};

const locales = [
  {
    language: "en-US",
    empty: "Copy text or an image to see it here.",
    missingModel: "Enter a model",
    regenerate: "Regenerate (Ctrl+R / F5)",
    openSettings: "Open settings",
    settings: "Settings",
    provider: "Provider",
    preset: "Preset",
    custom: "Custom",
    model: "Model",
  },
  {
    language: "zh-CN",
    empty: "复制文本或图片，结果会显示在这里。",
    missingModel: "请输入模型",
    regenerate: "重新生成 (Ctrl+R / F5)",
    openSettings: "打开设置",
    settings: "设置",
    provider: "服务商",
    preset: "预设",
    custom: "自定义",
    model: "模型",
  },
];

/** Follows the notice's real button, then checks the public Provider arrival contract. */
async function openProviderSettings(ui = locales[0]): Promise<{ pin: string; settings: string }> {
  const pin = await browser.getWindowHandle();
  await $("[role=group]").$(`button=${ui.openSettings}`).click();
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
  const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
  await browser.switchToWindow(settings);
  await expect($("h1")).toHaveText(ui.settings);
  await expect($(`h2=${ui.provider}`)).toBeDisplayed();
  await expect($("input:focus, select:focus, textarea:focus, [role=combobox]:focus")).not.toExist();
  return { pin, settings };
}

describe("Round configuration readiness", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("names the missing Custom model without sending a Round and opens its Provider settings under en-US", async () => {
    const ui = locales[0];
    provider.reset();
    clearClipboard();
    await relaunch({
      settings: customSettings(provider, { model: "" }),
      language: ui.language,
      environment: noNamedKeys,
    });
    await expect($("body")).toHaveText(ui.empty, { containing: true });
    writeClipboardText(`Input without Custom model ${Date.now()}`);
    await $("[role=toolbar]").moveTo();
    await $(`button[aria-label='${ui.regenerate}']`).waitForEnabled();
    const notice = $("[role=group]");
    await expect(notice).toHaveText(ui.missingModel, { containing: true });
    await expect(notice).toBeDisplayed();
    expect(provider.requests).toHaveLength(0);

    const { pin, settings } = await openProviderSettings(ui);
    await expectShownOption($(`select[aria-label='${ui.preset}']`), ui.custom);
    await expect($("input[aria-label='Base URL']")).toHaveValue(provider.baseUrl);
    await expect($(`input[aria-label='${ui.model}']`)).toHaveValue("");
    const generalField = $("input[aria-label='Target language']");
    await generalField.scrollIntoView();
    await generalField.click();
    await expect(generalField).toBeFocused();
    expect(await $("h2=Provider").getLocation("y")).toBeLessThan(await $("main").getLocation("y"));
    await browser.switchToWindow(pin);
    const reopened = await openProviderSettings(ui);
    expect(reopened.settings).toBe(settings);
    expect(await $("h2=Provider").getLocation("y")).toBeGreaterThanOrEqual(await $("main").getLocation("y"));
    expect(provider.requests).toHaveLength(0);
  });
});
