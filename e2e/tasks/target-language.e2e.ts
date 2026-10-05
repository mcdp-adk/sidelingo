import { capabilities, relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { FakeProvider } from "../support/provider";
import { openSettings, setUpCustomProvider } from "../support/settings";

describe("Task 7: the Target language", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("finds Japanese by its own name, regenerates into it with F5 and keeps it after a restart", async () => {
    // The fake Provider names the language it was asked for, as the start of its Translation.
    provider.reset(({ body }) => {
      const content: string = body.messages.at(-1).content;
      const language = /^Translate to (.+):/.exec(content)?.[1];
      return [{ delta: { content: `${language}: ${content.split("\n").at(-1)}` } }];
    });
    clearClipboard();
    await relaunch();
    const { pin, settings } = await setUpCustomProvider(provider.baseUrl);
    const copied = `A line to translate ${Date.now()}`;
    writeClipboardText(copied);
    await expect($("p")).toHaveText(`English: ${copied}`);

    await browser.switchToWindow(settings);
    const picker = $("aria/Target language");
    await picker.click();
    await browser.keys(["Control", "a"]);
    await browser.keys("日本語");
    // A bare [role=option] also finds a native select's options, such as "Choose a Provider".
    const option = $("[role=listbox] [role=option]");
    await expect(option).toHaveText(/Japanese[\s\S]*日本語/);
    await option.click();
    await expect(picker).toHaveValue("Japanese");

    await browser.switchToWindow(pin);
    await browser.keys("F5");
    await expect($("p")).toHaveText(`Japanese: ${copied}`);
    expect(provider.requests).toHaveLength(2);

    // After a restart, the line still in the clipboard is translated into Japanese, and Settings shows it.
    await browser.reloadSession(capabilities());
    await expect($("p")).toHaveText(`Japanese: ${copied}`);
    await openSettings();
    await expect($("aria/Target language")).toHaveValue("Japanese");
  });
});
