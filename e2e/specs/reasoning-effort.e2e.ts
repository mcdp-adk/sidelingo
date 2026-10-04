import { capabilities, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";
import { openSettings, PRESET_NAMES, expectShownOption } from "../settings";

describe("Reasoning effort", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("omits Default effort and fixes the chosen effort for both calls of each Round", async () => {
    const held = gate();
    provider.reset(({ body }) => [
      { delta: { content: Array.isArray(body.messages[1].content) ? "structured-default" : "translated-default" } },
    ]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    const { pin, settings } = await openSettings();
    const effort = () => $("select[aria-label='Reasoning effort']");
    try {
      await expectShownOption(effort(), "Default");
      await browser.switchToWindow(pin);
      writeClipboardText(`Default input ${Date.now()}\nsecond line`);
      await expect($("p")).toHaveText("translated-default");
      expect(provider.requests).toHaveLength(2);
      for (const { body } of provider.requests) {
        expect(body).not.toHaveProperty("reasoning_effort");
        expect(body).not.toHaveProperty("reasoning");
      }

      await browser.switchToWindow(settings);
      await effort().selectByVisibleText("low");
      await expectShownOption(effort(), "low");
      provider.reset(({ body }) =>
        Array.isArray(body.messages[1].content)
          ? [{ wait: held.wait }, { delta: { content: "structured-low" } }]
          : [{ delta: { content: "translated-low" } }],
      );
      await browser.switchToWindow(pin);
      writeClipboardText(`Low input ${Date.now()}\nsecond line`);
      await browser.waitUntil(() => provider.requests.length === 1);
      await browser.switchToWindow(settings);
      await effort().selectByVisibleText("high");
      await expectShownOption(effort(), "high");
      held.open();
      await browser.switchToWindow(pin);
      await expect($("p")).toHaveText("translated-low");
      expect(provider.requests).toHaveLength(2);
      for (const { body } of provider.requests) expect(body.reasoning_effort).toBe("low");

      provider.reset(({ body }) => [
        { delta: { content: Array.isArray(body.messages[1].content) ? "structured-high" : "translated-high" } },
      ]);
      writeClipboardText(`High input ${Date.now()}\nsecond line`);
      await expect($("p")).toHaveText("translated-high");
      expect(provider.requests).toHaveLength(2);
      for (const { body } of provider.requests) expect(body.reasoning_effort).toBe("high");
    } finally {
      held.open();
    }
  });

  it("trims all trailing Base URL slashes before sending actual requests", async () => {
    provider.reset();
    clearClipboard();
    await relaunch({ settings: customSettings(provider, { baseUrl: `${provider.baseUrl}///` }) });
    const input = `Trailing slashes ${Date.now()}`;
    writeClipboardText(input);
    await expect($("p")).toHaveText(input);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].path).toBe("/v1/chat/completions");
  });

  it("lists each Preset's allowed levels and preserves independent choices after reopening", async () => {
    provider.reset();
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    let { pin } = await openSettings();
    const preset = () => $("select[aria-label='Preset']");
    const effort = () => $("select[aria-label='Reasoning effort']");
    const choices = [
      ["custom", "none"],
      ["openai", "low"],
      ["openrouter", "medium"],
      ["deepseek", "high"],
      ["ollama-cloud", "max"],
    ] as const;
    for (const [name, level] of choices) {
      await preset().selectByVisibleText(PRESET_NAMES[name]);
      await expectShownOption(preset(), PRESET_NAMES[name]);
      await expectShownOption(effort(), "Default");
      const levels = await effort()
        .$$("option")
        .map((option) => option.getText());
      expect(levels).toEqual(
        name === "deepseek"
          ? ["Default", "none", "low", "high", "max"]
          : ["Default", "none", "low", "medium", "high", "xhigh", "max"],
      );
      await effort().selectByVisibleText(level);
      await expectShownOption(effort(), level);
    }
    await preset().selectByVisibleText("Custom");
    await expectShownOption(effort(), "none");
    await browser.switchToWindow(pin);
    writeClipboardText(`Explicit none ${Date.now()}`);
    await expect($("p")).toHaveText(expect.stringContaining("Explicit none"));
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.reasoning_effort).toBe("none");
    expect(provider.requests[0].body).not.toHaveProperty("reasoning");

    // Restart without seeding: the application's own save must preserve every choice.
    await browser.reloadSession(capabilities());
    ({ pin } = await openSettings());
    for (const [name, level] of choices) {
      await preset().selectByVisibleText(PRESET_NAMES[name]);
      await expectShownOption(effort(), level);
    }
    await preset().selectByVisibleText("Custom");
    await effort().selectByVisibleText("Default");
    await expectShownOption(effort(), "Default");
    provider.reset();
    await browser.switchToWindow(pin);
    writeClipboardText(`Back to Default ${Date.now()}`);
    await expect($("p")).toHaveText(expect.stringContaining("Back to Default"));
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body).not.toHaveProperty("reasoning_effort");
    expect(provider.requests[0].body).not.toHaveProperty("reasoning");
  });
});
