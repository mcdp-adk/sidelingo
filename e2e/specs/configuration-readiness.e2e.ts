import { relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider } from "../provider";
import { StalledProxy } from "../proxy";
import { replaceTextField } from "../settings";

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
    missingUrl: "Enter a Base URL",
    regenerate: "Regenerate (Ctrl+R / F5)",
    openSettings: "Open settings",
    missingKey: "No key is entered and OPENAI_API_KEY is not set.",
    undecryptableKey: "The saved key could not be decrypted. Enter it again.",
    noKeyPlaceholder: "No key; environment variable changes take effect after restart.",
    settings: "Settings",
    provider: "Provider",
    preset: "Preset",
    model: "Model",
  },
  {
    language: "zh-CN",
    empty: "复制文本或图片，结果会显示在这里。",
    chooseProvider: "选择服务商",
    missingModel: "请输入模型",
    missingUrl: "请输入 Base URL",
    regenerate: "重新生成 (Ctrl+R / F5)",
    openSettings: "打开设置",
    missingKey: "未输入 Key，且 OPENAI_API_KEY 未设置。",
    undecryptableKey: "保存的 Key 无法解密，请重新输入。",
    noKeyPlaceholder: "没有可用的 Key；环境变量更改后需重启。",
    settings: "设置",
    provider: "服务商",
    preset: "预设",
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
    await expect(preset).toHaveValue("");
    expect(provider.requests).toHaveLength(0);

    await preset.selectByAttribute("value", "custom");
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

  for (const ui of locales) {
    for (const [field, missing, message] of [
      ["model", { model: "" }, ui.missingModel],
      ["Base URL", { baseUrl: "" }, ui.missingUrl],
    ] as const) {
      it(`names the missing Custom ${field} without sending a Round and opens its Provider settings under ${ui.language}`, async () => {
        provider.reset();
        clearClipboard();
        await relaunch({
          settings: customSettings(provider, missing),
          language: ui.language,
          environment: noNamedKeys,
        });
        await expect($("body")).toHaveText(ui.empty, { containing: true });
        writeClipboardText(`Input without Custom ${field} ${Date.now()}`);
        await $("[role=toolbar]").moveTo();
        await $(`button[aria-label='${ui.regenerate}']`).waitForEnabled();
        const notice = $("[role=group]");
        await expect(notice).toHaveText(message, { containing: true });
        await expect(notice).toBeDisplayed();
        expect(provider.requests).toHaveLength(0);

        const { pin, settings } = await openProviderSettings(ui);
        await expect($(`select[aria-label='${ui.preset}']`)).toHaveValue("custom");
        await expect($("input[aria-label='Base URL']")).toHaveValue("baseUrl" in missing ? "" : provider.baseUrl);
        await expect($(`input[aria-label='${ui.model}']`)).toHaveValue("model" in missing ? "" : "fake-model");
        if (ui.language === "en-US" && field === "model") {
          const generalField = $("input[aria-label='Target language']");
          await generalField.scrollIntoView();
          await generalField.click();
          await expect(generalField).toBeFocused();
          expect(await $("h2=Provider").getLocation("y")).toBeLessThan(await $("main").getLocation("y"));
          await browser.switchToWindow(pin);
          const reopened = await openProviderSettings(ui);
          expect(reopened.settings).toBe(settings);
          expect(await $("h2=Provider").getLocation("y")).toBeGreaterThanOrEqual(await $("main").getLocation("y"));
        }
        expect(provider.requests).toHaveLength(0);
      });
    }
  }
  it("names the missing OpenAI model before its missing key", async () => {
    provider.reset();
    clearClipboard();
    await relaunch({
      settings: {
        schemaVersion: 1,
        automaticUpdates: false,
        activePreset: "openai",
        presets: { openai: { model: "" } },
      },
      environment: noNamedKeys,
    });
    writeClipboardText(`OpenAI Input with no model or key ${Date.now()}`);
    await $("[role=toolbar]").moveTo();
    await $("button[aria-label='Regenerate (Ctrl+R / F5)']").waitForEnabled();
    const notice = $("[role=group]");
    await expect(notice).toHaveText("Enter a model", { containing: true });
    expect(provider.requests).toHaveLength(0);
    await openProviderSettings();
    await expect($("select[aria-label='Preset']")).toHaveValue("openai");
    await expect($("input[aria-label='Model']")).toHaveValue("");
    expect(provider.requests).toHaveLength(0);
  });

  for (const ui of locales) {
    it(`names the unset OpenAI key and opens Provider settings without focus under ${ui.language}`, async () => {
      const proxy = await StalledProxy.start();
      try {
        clearClipboard();
        await relaunch({
          settings: {
            schemaVersion: 1,
            automaticUpdates: false,
            activePreset: "openai",
            presets: { openai: { model: "readiness-model" } },
            proxy: { mode: "manual", url: proxy.url },
          },
          language: ui.language,
          environment: noNamedKeys,
        });
        await expect($("body")).toHaveText(ui.empty, { containing: true });

        writeClipboardText(`OpenAI key readiness ${ui.language} ${Date.now()}`);
        await $("[role=toolbar]").moveTo();
        await $(`button[aria-label='${ui.regenerate}']`).waitForEnabled();
        const notice = $("[role=group]");
        await expect(notice).toHaveText(ui.missingKey, { containing: true });
        await expect(notice).toBeDisplayed();
        expect(proxy.connectedAt).toBeNull();

        await openProviderSettings(ui);
        await expect($(`select[aria-label='${ui.preset}']`)).toHaveValue("openai");
        await expect($(`input[aria-label='${ui.model}']`)).toHaveValue("readiness-model");
        await expect($("input[aria-label='Key']")).toHaveValue("");
        expect(proxy.connectedAt).toBeNull();
      } finally {
        await proxy.close();
      }
    });
  }

  for (const ui of locales) {
    it(`refuses an undecryptable saved OpenAI key despite a launch environment key under ${ui.language}`, async () => {
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
  }

  it("does not silently run Custom keyless when its saved key cannot be decrypted", async () => {
    provider.reset();
    clearClipboard();
    const settings = customSettings(provider);
    await relaunch({
      settings: {
        ...settings,
        presets: {
          custom: {
            ...settings.presets.custom,
            keyCiphertext: "bm90LWEtRFBBUEktY2lwaGVydGV4dA==",
          },
        },
      },
      environment: noNamedKeys,
    });
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });

    writeClipboardText(`Custom invalid key readiness ${Date.now()}`);
    await $(`[role=toolbar]`).moveTo();
    await $("button[aria-label='Regenerate (Ctrl+R / F5)']").waitForEnabled();
    await expect($(`[role=group]`)).toHaveText("The saved key could not be decrypted. Enter it again.", {
      containing: true,
    });
    expect(provider.requests).toHaveLength(0);

    await openProviderSettings();
    await expect($("select[aria-label='Preset']")).toHaveValue("custom");
    const key = $("input[aria-label='Key']");
    await expect(key).toHaveValue("");
    await expect(key).toHaveAttribute("aria-invalid", "true");
    await expect($(`//*[text()='The saved key could not be decrypted. Enter it again.']`)).toBeDisplayed();
    expect(provider.requests).toHaveLength(0);
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
    await expect($(`select[aria-label='${ui.preset}']`)).toHaveValue("");
    expect(provider.requests).toHaveLength(0);
  });
});
