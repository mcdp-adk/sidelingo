import { capabilities, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider } from "../provider";

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
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });
  it("lists 20 languages, separating Chinese scripts and showing capitalised autonyms", async () => {
    clearClipboard();
    await relaunch();
    await openSettings();
    const picker = () => $("[role=combobox][aria-label='Target language']");
    await picker().click();
    await expect($$("[role=listbox] [role=option]")).toBeElementsArrayOfSize(20);
    await expect($("//*[@role='listbox']//*[@role='option' and contains(., 'Simplified')]")).toHaveText(
      /(?:Simplified Chinese|Chinese \(Simplified\))[\s\S]*(?:简体中文|中文（简体）)/,
    );
    await expect($("//*[@role='listbox']//*[@role='option' and contains(., 'Traditional')]")).toHaveText(
      /(?:Traditional Chinese|Chinese \(Traditional\))[\s\S]*(?:繁體中文|中文（繁體）)/,
    );
    await expect($("//*[@role='listbox']//*[@role='option' and contains(., 'French')]")).toHaveText(
      /French[\s\S]*Français/,
    );
    // Equal names appear once, rather than showing a duplicate autonym.
    await expect($("//*[@role='listbox']//*[@role='option' and contains(., 'English')]")).toHaveText("English");
    const options = await $$("[role=listbox] [role=option]");
    await expect(options[0]).toHaveText(/^Arabic/);
    await expect(options[19]).toHaveText(/^Vietnamese/);
  });

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

  it("uses a selected language in the next Translation without rerunning the shown Round, and keeps it after restart", async () => {
    provider.reset(({ body }) => [
      { delta: { content: `${body.messages.at(-1).content.split("\n").at(-1)}-translated` } },
    ]);
    const first = `language-first-${Date.now()}`;
    writeClipboardText(first);
    await relaunch({ settings: customSettings(provider, { targetLanguage: "en" }) });
    await expect($("p")).toHaveText(`${first}-translated`);
    const pin = await openSettings();
    const picker = () => $("[role=combobox][aria-label='Target language']");
    await picker().click();
    await browser.keys(["Control", "a"]);
    await browser.keys("Japanese");
    await expect($("[role=listbox] [role=option]")).toHaveText(/Japanese[\s\S]*日本語/);
    await $("[role=listbox] [role=option]").click();
    await expect(picker()).toHaveValue("Japanese");
    await browser.switchToWindow(pin);
    await expect($("p")).toHaveText(`${first}-translated`);
    await browser.pause(500);
    expect(provider.requests).toHaveLength(1);
    const next = `language-next-${Date.now()}`;
    writeClipboardText(next);
    await expect($("p")).toHaveText(`${next}-translated`);
    expect(provider.requests.at(-1)?.body.messages.at(-1).content).toMatch(/^Translate to Japanese:\n/);
    clearClipboard();
    // Retain the real saved settings, changing only the simulated display language.
    await browser.reloadSession(capabilities({ language: "fr-FR" }));
    await openSettings();
    await expect(picker()).toHaveValue("Japanese");
  });
});
