import { capabilities, relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider } from "../support/provider";
import { openSettings, PRESET_NAMES, expectShownOption } from "../support/settings";

describe("Reasoning effort", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
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
