import { relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider } from "../support/provider";
import { StalledProxy } from "../support/proxy";
import { replaceTextField, expectShownOption } from "../support/settings";

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
    chooseProvider: "Choose a Provider",
    missingModel: "Enter a model",
    regenerate: "Regenerate (Ctrl+R / F5)",
    openSettings: "Open settings",
    undecryptableKey: "The saved key could not be decrypted. Enter it again.",
    noKeyPlaceholder: "No key; environment variable changes take effect after restart.",
    settings: "Settings",
    provider: "Provider",
    preset: "Preset",
    custom: "Custom",
    model: "Model",
  },
  {
    language: "zh-CN",
    empty: "复制文本或图片，结果会显示在这里。",
    chooseProvider: "选择服务商",
    missingModel: "请输入模型",
    regenerate: "重新生成 (Ctrl+R / F5)",
    openSettings: "打开设置",
    undecryptableKey: "保存的 Key 无法解密，请重新输入。",
    noKeyPlaceholder: "没有可用的 Key；环境变量更改后需重启。",
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

  it("asks the user to choose a Provider despite a named launch key and processes a later Input after setup", async () => {
    const input = `First unconfigured Input ${Date.now()}`;
    const configuredInput = `Configured Input ${Date.now()}`;
    const translated = `Translation after Provider setup ${Date.now()}`;
    provider.reset([{ delta: { content: translated } }]);
    clearClipboard();
    await relaunch({
      language: "en-US",
      environment: { ...noNamedKeys, OPENAI_API_KEY: "synthetic-openai-launch-key" },
    });
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });

    writeClipboardText(input);
    await $("[role=toolbar]").moveTo();
    // Public availability proves the real copy reached the session before the notice assertion.
    await $("button[aria-label='Regenerate (Ctrl+R / F5)']").waitForEnabled();
    const notice = $("[role=group]");
    await expect(notice).toHaveText("Choose a Provider", { containing: true });
    await expect(notice).toBeDisplayed();
    expect(provider.requests).toHaveLength(0);

    const { pin } = await openProviderSettings();
    const preset = $("select[aria-label='Preset']");
    await expectShownOption(preset, "Choose a Provider");
    expect(provider.requests).toHaveLength(0);

    await preset.selectByVisibleText("Custom");
    await $("input[aria-label='Base URL']").waitForExist();
    await replaceTextField("Base URL", provider.baseUrl);
    await browser.keys("Enter");
    await browser.waitUntil(() => provider.modelRequests.length > 0, {
      timeoutMsg: "the committed Custom Base URL did not reach the local Provider",
    });
    await replaceTextField("Model", "configured-readiness-model");
    await browser.keys("Enter");
    await $("h1").click();
    await browser.switchToWindow(pin);
    writeClipboardText(configuredInput);
    await expect($("body")).toHaveText(translated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.model).toBe("configured-readiness-model");
    expect(provider.requests[0].body.messages[1].content).toContain(configuredInput);
    await expect($("[role=group]")).not.toExist();
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

  it("refuses an undecryptable saved OpenAI key despite a launch environment key under en-US", async () => {
    const ui = locales[0];
    const proxy = await StalledProxy.start();
    try {
      clearClipboard();
      const settings = {
        schemaVersion: 1,
        automaticUpdates: false,
        activePreset: "openai",
        presets: {
          openai: { model: "saved-key-fallback-model", keyCiphertext: "bm90LWEtRFBBUEktY2lwaGVydGV4dA==" },
        },
        proxy: { mode: "manual", url: proxy.url },
      };
      await relaunch({
        settings,
        language: ui.language,
        environment: { ...noNamedKeys, OPENAI_API_KEY: "synthetic-openai-launch-key" },
      });
      await expect($("body")).toHaveText(ui.empty, { containing: true });

      const pin = await browser.getWindowHandle();
      await $(`[role=toolbar]`).moveTo();
      await browser.keys(["Control", ","]);
      await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
      const settingsWindow = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
      await browser.switchToWindow(settingsWindow);
      await expect($("h1")).toHaveText(ui.settings);
      await expect($(`h2=${ui.provider}`)).toBeDisplayed();
      const key = $("input[aria-label='Key']");
      await expect(key).toHaveValue("");
      await expect(key).toHaveAttribute("placeholder", ui.noKeyPlaceholder);
      await expect(key).toHaveAttribute("aria-invalid", "true");
      await expect($(`//*[text()='${ui.undecryptableKey}']`)).toBeDisplayed();
      expect(proxy.connectedAt).toBeNull();

      await browser.switchToWindow(pin);
      writeClipboardText(`Undecryptable OpenAI key ${ui.language} ${Date.now()}`);
      await $(`button[aria-label='${ui.regenerate}']`).waitForEnabled();
      await expect($("[role=group]")).toHaveText(ui.undecryptableKey, { containing: true });
      expect(proxy.connectedAt).toBeNull();

      await openProviderSettings(ui);
      expect(proxy.connectedAt).toBeNull();
    } finally {
      await proxy.close();
    }
  });

  it("shows the choose-Provider notice in Simplified Chinese", async () => {
    const ui = locales[1];
    provider.reset();
    clearClipboard();
    await relaunch({ language: ui.language, environment: noNamedKeys });
    writeClipboardText(`Chinese unconfigured Input ${Date.now()}`);
    await $("[role=toolbar]").moveTo();
    await $(`button[aria-label='${ui.regenerate}']`).waitForEnabled();
    await expect($("[role=group]")).toHaveText(ui.chooseProvider, { containing: true });
    expect(provider.requests).toHaveLength(0);
    await openProviderSettings(ui);
    await expectShownOption($(`select[aria-label='${ui.preset}']`), ui.chooseProvider);
    expect(provider.requests).toHaveLength(0);
  });
});
