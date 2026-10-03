import { appExe, relaunch, showAgain } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";
import { inspectWindows } from "../window";

const pinVisible = () => inspectWindows(appExe, "sidelingo")[0]?.visible;

describe("Round controls", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("regenerates a reused successful Round with a distinct result and a second request", async () => {
    const input = `Regenerate Input ${Date.now()}`;
    const original = `Original successful Translation ${Date.now()}`;
    const regenerated = `Regenerated successful Translation ${Date.now()}`;
    provider.reset(() => [{ delta: { content: provider.requests.length === 1 ? original : regenerated } }]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(input);
    await expect($("body")).toHaveText(original, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the completed Pin window did not hide" });

    await showAgain();
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    await expect($("body")).toHaveText(original, { containing: true });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();

    await $("[role=toolbar]").moveTo();
    const regenerate = $("button[aria-label^='Regenerate']");
    await expect(regenerate).toBeDisplayed();
    await expect(regenerate).toBeEnabled();
    await regenerate.click();
    await expect($("body")).toHaveText(regenerated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(input);
    await expect($("body")).not.toHaveText(original, { containing: true });
  });

  for (const [shortcut, keys] of [
    ["Ctrl+R", ["Control", "r"]],
    ["F5", ["F5"]],
  ] as const) {
    it(`cancels streaming Structuring with ${shortcut} and reruns the retained Input through Translation`, async () => {
      const input = `Retained shortcut Input ${Date.now()}\ncontinues`;
      const partial = `Old partial Source ${Date.now()}`;
      const source = `Regenerated whole Source ${Date.now()}`;
      const translation = `Regenerated whole Translation ${Date.now()}`;
      const held = gate();
      provider.reset(({ body }) =>
        Array.isArray(body.messages[1].content)
          ? provider.requests.length === 1
            ? [{ delta: { content: partial } }, held, { delta: { content: " obsolete shortcut suffix" } }]
            : [{ delta: { content: source } }]
          : [{ delta: { content: translation } }],
      );
      clearClipboard();
      await relaunch({ settings: customSettings(provider) });
      try {
        writeClipboardText(input);
        await expect($("body")).toHaveText(partial, { containing: true });
        await expect($("button[aria-label='Copy translation']")).toBeDisabled();
        const obsolete = provider.requests[0];
        // Regenerate uses the Session's Input, even when nothing usable remains in the clipboard.
        clearClipboard();
        await browser.keys([...keys]);
        await browser.waitUntil(() => provider.interruptedRequests.includes(obsolete), {
          timeout: 5_000,
          timeoutMsg: `${shortcut} left the obsolete Structuring HTTP response open at the Provider`,
        });
        await expect($("body")).toHaveText(translation, { containing: true });
        await $("button[aria-label='Copy translation']").waitForEnabled();
        expect(provider.requests).toHaveLength(3);
        expect(provider.requests[1].body.messages[1].content).toEqual([{ type: "text", text: input }]);
        expect(provider.requests[2].body.messages[1].content).toContain(source);
        held.open();
        await browser.pause(350);
        await expect($("body")).toHaveText(translation, { containing: true });
        await expect($("body")).not.toHaveText("obsolete shortcut suffix", { containing: true });
        expect(provider.requests).toHaveLength(3);
      } finally {
        held.open();
      }
    });
  }

  it("ignores copied Inputs while paused and follows new copies after hiding and showing", async () => {
    const originalInput = `Original pause Input ${Date.now()}`;
    const ignoredInput = `Ignored paused Input ${Date.now()}`;
    const followedInput = `Followed after hide Input ${Date.now()}`;
    const original = `Retained pause Translation ${Date.now()}`;
    const followed = `Completed after pause reset ${Date.now()}`;
    provider.reset(() => [{ delta: { content: provider.requests.length === 1 ? original : followed } }]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(originalInput);
    await expect($("body")).toHaveText(original, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);
    await $("[role=toolbar]").moveTo();
    const pause = () => $("button[aria-label^='Pause clipboard monitoring']");
    await expect(pause()).toBeDisplayed();
    await pause().click();
    await expect(pause()).toHaveAttribute("aria-pressed", "true");

    writeClipboardText(ignoredInput);
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    await expect($("body")).toHaveText(original, { containing: true });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the paused Pin window did not hide" });
    writeClipboardText(originalInput);
    await showAgain();
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    await expect($("body")).toHaveText(original, { containing: true });
    await $("[role=toolbar]").moveTo();
    await expect(pause()).toHaveAttribute("aria-pressed", "false");

    writeClipboardText(followedInput);
    await expect($("body")).toHaveText(followed, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(followedInput);
  });

  it("automatically processes 10,000 characters and waits for Process anyway on 10,001 characters", async () => {
    const originalInput = "a".repeat(10_000);
    const overlong = "x".repeat(10_001);
    const nextOverlong = "y".repeat(10_001);
    const followingInput = `After overlong prompt ${Date.now()}`;
    const original = `Original before overlong ${Date.now()}`;
    const processed = `Completed overlong Translation ${Date.now()}`;
    const following = `Completed prompt replacement ${Date.now()}`;
    provider.reset(() => [{ delta: { content: [original, processed, following][provider.requests.length - 1] } }]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(originalInput);
    await expect($("body")).toHaveText(original, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.messages[1].content).toContain(originalInput);
    await expect($("button=Process anyway")).not.toExist();

    writeClipboardText(overlong);
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    const processAnyway = () => $("button=Process anyway");
    await expect(processAnyway()).toBeDisplayed();
    await expect($("body")).toHaveText("10,000", { containing: true });
    await expect($("body")).not.toHaveText(original, { containing: true });
    await expect($("button[aria-label='Copy source']")).toBeDisabled();
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();
    await processAnyway().click();
    await expect($("body")).toHaveText(processed, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(overlong);
    await expect(processAnyway()).not.toExist();

    writeClipboardText(nextOverlong);
    await browser.pause(750);
    expect(provider.requests).toHaveLength(2);
    await expect(processAnyway()).toBeDisplayed();
    await expect($("body")).not.toHaveText(processed, { containing: true });
    writeClipboardText(followingInput);
    await expect($("body")).toHaveText(following, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[2].body.messages[1].content).toContain(followingInput);
    await expect(processAnyway()).not.toExist();
  });

  it("does not reuse an older success after Regenerate fails for the same Input and retries with Regenerate", async () => {
    const input = `Regenerate failure Input ${Date.now()}`;
    const original = `Older successful Translation ${Date.now()}`;
    const detail = `Synthetic failed Regenerate HTTP 503 ${Date.now()}`;
    const retry = `Completed show retry after Regenerate failure ${Date.now()}`;
    const retryDetail = `Synthetic explicit retry HTTP 503 ${Date.now()}`;
    const regenerated = `Completed explicit Regenerate retry ${Date.now()}`;
    provider.reset(() =>
      provider.requests.length === 2
        ? { status: 503, message: detail }
        : provider.requests.length === 4
          ? { status: 503, message: retryDetail }
          : [
              {
                delta: {
                  content:
                    provider.requests.length === 1 ? original : provider.requests.length === 3 ? retry : regenerated,
                },
              },
            ],
    );
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(input);
    await expect($("body")).toHaveText(original, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);
    await $("[role=toolbar]").moveTo();
    await $("button[aria-label^='Regenerate']").click();

    // The terminal failed pane distinguishes failure from a still-streaming Round.
    const translationPane = $("[role=region][aria-label='Translation']");
    await expect(translationPane).toHaveText("Translation failed", { containing: true });
    await expect(translationPane).toHaveText("Provider HTTP error 503", { containing: true });
    await expect(translationPane).toHaveText(detail, { containing: true });
    await expect($("button[aria-label='Copy source']")).toBeEnabled();
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(input);
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the failed Regenerate Pin window did not hide" });
    await showAgain();
    await browser.waitUntil(() => provider.requests.length === 3, {
      timeoutMsg: "show reused the older successful result after Regenerate failed for the same Input",
    });
    await expect($("body")).toHaveText(retry, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[2].body.messages[1].content).toContain(input);
    await expect($("body")).not.toHaveText(original, { containing: true });
    await expect(translationPane).not.toHaveText(detail, { containing: true });

    await $("[role=toolbar]").moveTo();
    await $("button[aria-label^='Regenerate']").click();
    await expect(translationPane).toHaveText("Translation failed", { containing: true });
    await expect(translationPane).toHaveText("Provider HTTP error 503", { containing: true });
    await expect(translationPane).toHaveText(retryDetail, { containing: true });
    await expect($("button[aria-label='Copy source']")).toBeEnabled();
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();
    expect(provider.requests).toHaveLength(4);
    expect(provider.requests[3].body.messages[1].content).toContain(input);
    const regenerate = $("button[aria-label^='Regenerate']");
    await expect(regenerate).toBeEnabled();
    await regenerate.click();
    await expect(translationPane).toHaveText(regenerated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(5);
    expect(provider.requests[4].body.messages[1].content).toContain(input);
    await expect(translationPane).not.toHaveText(retryDetail, { containing: true });
    await expect(translationPane).not.toHaveText(retry, { containing: true });
  });
});
