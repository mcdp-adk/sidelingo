import { relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { FakeProvider, gate } from "../support/provider";
import { expectNothingFocused, followOpenSettings, replaceTextField, setUpCustom } from "../support/settings";

describe("Task 4: recovering from a Provider error", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("follows a rejected key's Open settings, enters the key, regenerates, and keeps text streamed before a dropped connection", async () => {
    const stamp = Date.now();
    const rejection = `Incorrect API key provided ${stamp}`;
    const first = `Translated once the key works ${stamp}`;
    const rest = ` and the rest ${stamp}`;
    const held = gate();
    // The Provider takes only the right key.
    provider.reset(({ headers }) =>
      headers.authorization === "Bearer right-key"
        ? [{ delta: { content: first } }, held, { delta: { content: rest } }]
        : { status: 401, message: rejection },
    );

    clearClipboard();
    await relaunch();
    await $("[role=toolbar]").moveTo();
    for (const name of ["Regenerate (Ctrl+R / F5)", "Copy source", "Copy translation"]) {
      await expect($(`aria/${name}`)).toBeDisabled();
    }
    const { pin, settings } = await setUpCustom({ baseUrl: provider.baseUrl, model: "chat-model", key: "wrong-key" });

    const line = `A line for a Provider that rejects the key ${stamp}`;
    writeClipboardText(line);
    const error = $("[role=group]");
    await expect(error).toHaveText(rejection, { containing: true });
    await expect(error).toHaveText("Translation failed: Provider HTTP error 401", { containing: true });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].headers.authorization).toBe("Bearer wrong-key");

    // Settings, still open from the setup, comes back on Provider with nothing focused.
    expect((await followOpenSettings()).settings).toBe(settings);
    await expect($("h2=Provider")).toBeDisplayed();
    await expectNothingFocused();
    await replaceTextField("Key", "right-key");
    await browser.keys("Enter");

    await browser.switchToWindow(pin);
    await browser.keys(["Control", "r"]);
    await expect($("p")).toHaveText(first);
    await expect(error).not.toExist();
    await $("[role=toolbar]").moveTo();
    await expect($("aria/Copy source")).toBeEnabled();
    await expect($("aria/Regenerate (Ctrl+R / F5)")).toBeEnabled();
    const copyTranslation = $("aria/Copy translation");
    await expect(copyTranslation).toBeDisabled();
    held.open();
    await expect($("p")).toHaveText(first + rest);
    await expect(copyTranslation).toBeEnabled();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].headers.authorization).toBe("Bearer right-key");
    expect(provider.requests[1].body.messages.at(-1).content).toContain(line);

    // The connection drops after some Source text has streamed.
    const partial = `Source text that streamed ${stamp}`;
    const dropping = gate();
    provider.reset([{ delta: { content: partial } }, dropping, { drop: true }]);
    writeClipboardText(`A wrapped line ${stamp}\ncontinues here`);
    const pane = $("[role=region]");
    await expect(pane).toHaveText(partial, { containing: true });
    dropping.open();
    await expect(pane).toHaveText("Structuring failed: Network error", { containing: true });
    const shown = await pane.getText();
    expect(shown.indexOf(partial)).toBeGreaterThanOrEqual(0);
    expect(shown.indexOf(partial)).toBeLessThan(shown.indexOf("Structuring failed: Network error"));
    expect(provider.interruptedRequests).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
  });
});
