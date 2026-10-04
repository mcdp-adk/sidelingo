import { relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { FakeProvider } from "../support/provider";
import { setUpCustomProvider } from "../support/settings";

describe("Task 6: an overlong Input waits for the user", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("waits for Process anyway before translating a copy of 10,001 characters", async () => {
    const translation = `The long text, translated ${Date.now()}`;
    provider.reset([{ delta: { content: translation } }]);
    clearClipboard();
    await relaunch();
    await setUpCustomProvider(provider.baseUrl);

    // 1,667 words on a single line: 10,001 characters.
    const overlong = "lorem ".repeat(1_667).slice(0, 10_001);
    writeClipboardText(overlong);
    await expect($("[role=group]")).toHaveText("Text exceeds 10,000 characters", { containing: true });
    // The user reads the notice; nothing has been sent meanwhile.
    await browser.pause(500);
    expect(provider.requests).toHaveLength(0);

    await $("button=Process anyway").click();
    await expect($("p")).toHaveText(translation);
    await expect($("[role=group]")).not.toExist();
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.messages.at(-1).content).toContain(overlong);
  });
});
