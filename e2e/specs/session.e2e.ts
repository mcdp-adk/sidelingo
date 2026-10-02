import { spawn } from "node:child_process";
import { once } from "node:events";
import { appExe, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";
import { openSettings } from "../settings";
import { inspectWindows } from "../window";

const pinVisible = () => inspectWindows(appExe, "sidelingo")[0]?.visible;

/** A real second launch shows the existing hidden Pin window. */
async function showAgain(): Promise<void> {
  const secondLaunch = spawn(appExe, { stdio: "ignore", windowsHide: true });
  const [code] = await once(secondLaunch, "exit");
  expect(code).toBe(0);
  await browser.waitUntil(pinVisible, { timeoutMsg: "the existing Pin window did not show" });
}

describe("The Pin window session", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("keeps the completed result without another request when the same Input is copied twice", async () => {
    const input = `Repeated Input ${Date.now()}`;
    const translated = `Completed Translation ${Date.now()}`;
    provider.reset([{ delta: { content: translated } }]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(input);
    await expect($("body")).toHaveText(translated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);

    writeClipboardText(input);
    // Beyond the native listener's 200 ms coalescing window, an accidental copy stays a no-op.
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    await expect($("body")).toHaveText(translated, { containing: true });
  });

  it("aborts a streaming Structuring request at the Provider when a new copy replaces it", async () => {
    const first = `First Input ${Date.now()}\ncontinues`;
    const second = `New Input ${Date.now()}`;
    const partial = `Partial Source ${Date.now()}`;
    const translated = `Newest Translation ${Date.now()}`;
    const held = gate();
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content)
        ? [{ delta: { content: partial } }, held, { delta: { content: " obsolete suffix" } }]
        : [{ delta: { content: translated } }],
    );
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    try {
      writeClipboardText(first);
      await expect($("body")).toHaveText(partial, { containing: true });
      const obsolete = provider.requests[0];
      writeClipboardText(second);
      await expect($("body")).toHaveText(translated, { containing: true });
      await $("button[aria-label='Copy translation']").waitForEnabled();
      await browser.waitUntil(() => provider.interruptedRequests.includes(obsolete), {
        timeout: 5_000,
        timeoutMsg: "the obsolete streaming HTTP response stayed open at the Provider",
      });
      expect(provider.requests).toHaveLength(2);
      expect(provider.requests[1].body.messages[1].content).toContain(second);
      held.open();
      await browser.pause(350);
      await expect($("body")).toHaveText(translated, { containing: true });
      await expect($("body")).not.toHaveText("obsolete suffix", { containing: true });
    } finally {
      held.open();
    }
  });

  it("reuses a fully successful Round when a second launch shows the same clipboard Input", async () => {
    const input = `Reusable Input ${Date.now()}`;
    const translated = `Successful Translation ${Date.now()}`;
    provider.reset(() => [
      { delta: { content: provider.requests.length === 1 ? translated : "Unexpected repeated Translation" } },
    ]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(input);
    await expect($("body")).toHaveText(translated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the Pin window did not hide" });

    await showAgain();
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    await expect($("body")).toHaveText(translated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
  });

  it("keeps the completed result when shown with an empty clipboard", async () => {
    const input = `Retained Input ${Date.now()}`;
    const translated = `Retained completed Translation ${Date.now()}`;
    provider.reset([{ delta: { content: translated } }]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(input);
    await expect($("body")).toHaveText(translated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the completed Pin window did not hide" });

    clearClipboard();
    await showAgain();
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    await expect($("body")).toHaveText(translated, { containing: true });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
  });

  it("finishes a Round while hidden and reuses its whole result when shown again", async () => {
    const input = `Hidden Input ${Date.now()}`;
    const partial = `Streaming hidden result ${Date.now()}`;
    const whole = `${partial} finished while hidden`;
    const held = gate();
    provider.reset(() =>
      provider.requests.length === 1
        ? [{ delta: { content: partial } }, held, { delta: { content: " finished while hidden" } }]
        : [{ delta: { content: "Unexpected hidden rerun" } }],
    );
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    try {
      writeClipboardText(input);
      await expect($("body")).toHaveText(partial, { containing: true });
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      await browser.keys("Escape");
      await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the streaming Pin window did not hide" });

      held.open();
      // The existing completion control becomes enabled only once the hidden Round has finished.
      await $("button[aria-label='Copy translation']").waitForEnabled({ timeout: 10_000 });
      expect(provider.interruptedRequests).toHaveLength(0);
      await showAgain();
      await browser.pause(750);
      expect(provider.requests).toHaveLength(1);
      await expect($("body")).toHaveText(whole, { containing: true });
      await $("button[aria-label='Copy translation']").waitForEnabled();
    } finally {
      held.open();
    }
  });

  it("requests the same Input again after a Provider HTTP failure instead of reusing it", async () => {
    const input = `Rejected Input ${Date.now()}`;
    const translated = `Successful retry ${Date.now()}`;
    provider.reset(() =>
      provider.requests.length === 1
        ? { status: 503, message: "Synthetic unavailable Provider" }
        : [{ delta: { content: translated } }],
    );
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardText(input);
    await browser.waitUntil(() => provider.requests.length === 1);
    await expect($("body")).toHaveText(input, { containing: true });
    await browser.pause(750);
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the failed Pin window did not hide" });

    await showAgain();
    await browser.waitUntil(() => provider.requests.length === 2, {
      timeoutMsg: "showing the failed Input did not send another HTTP request",
    });
    await expect($("body")).toHaveText(translated, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(input);
  });

  for (const [completedBeforeChange, title] of [
    [false, "invalidates reuse when settings change during a Round without rerunning it"],
    [true, "invalidates completed reuse when settings change without rerunning it"],
  ] as const) {
    it(title, async () => {
      const input = `Configured Input ${Date.now()}`;
      const partial = `English result ${Date.now()}`;
      const whole = `${partial} completed with its original configuration`;
      const translated = `Japanese result ${Date.now()}`;
      const held = gate();
      provider.reset(() =>
        provider.requests.length === 1
          ? [
              { delta: { content: partial } },
              held,
              { delta: { content: " completed with its original configuration" } },
            ]
          : [{ delta: { content: translated } }],
      );
      clearClipboard();
      await relaunch({ settings: customSettings(provider, { targetLanguage: "en" }) });
      try {
        writeClipboardText(input);
        await expect($("body")).toHaveText(partial, { containing: true });
        await expect($("button[aria-label='Copy translation']")).toBeDisabled();
        expect(provider.requests[0].body.messages[1].content).toMatch(/^Translate to English:\n/);
        if (completedBeforeChange) {
          held.open();
          await $("button[aria-label='Copy translation']").waitForEnabled();
          await expect($("body")).toHaveText(whole, { containing: true });
        }
        const { pin } = await openSettings();
        const picker = $("[role=combobox][aria-label='Target language']");
        await picker.click();
        await browser.keys(["Control", "a"]);
        await browser.keys("Japanese");
        await $("[role=listbox] [role=option]").click();
        await expect(picker).toHaveValue("Japanese");
        await browser.switchToWindow(pin);
        await browser.pause(500);
        expect(provider.requests).toHaveLength(1);
        await expect($("body")).toHaveText(completedBeforeChange ? whole : partial, { containing: true });
        if (completedBeforeChange) await expect($("button[aria-label='Copy translation']")).toBeEnabled();
        else await expect($("button[aria-label='Copy translation']")).toBeDisabled();

        held.open();
        await $("button[aria-label='Copy translation']").waitForEnabled();
        await expect($("body")).toHaveText(whole, { containing: true });
        await browser.keys("Escape");
        await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the configured Pin window did not hide" });
        await showAgain();
        await browser.waitUntil(() => provider.requests.length === 2, {
          timeoutMsg: "the old-configuration Round was reused after settings changed",
        });
        await expect($("body")).toHaveText(translated, { containing: true });
        await $("button[aria-label='Copy translation']").waitForEnabled();
        expect(provider.requests[1].body.messages[1].content).toMatch(/^Translate to Japanese:\n/);
      } finally {
        held.open();
      }
    });
  }

  it("requests a partial Round again after its streaming connection drops", async () => {
    const input = `Dropped Input ${Date.now()}`;
    const partial = `Incomplete Translation ${Date.now()}`;
    const translated = `Completed retry after drop ${Date.now()}`;
    const held = gate();
    provider.reset(() =>
      provider.requests.length === 1
        ? [{ delta: { content: partial } }, held, { drop: true }]
        : [{ delta: { content: translated } }],
    );
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    try {
      writeClipboardText(input);
      await expect($("body")).toHaveText(partial, { containing: true });
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      const dropped = provider.requests[0];
      held.open();
      await browser.waitUntil(() => provider.interruptedRequests.includes(dropped), {
        timeoutMsg: "the scripted Provider connection did not actually drop",
      });
      await browser.pause(350);
      await expect($("body")).toHaveText(partial, { containing: true });
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      await browser.keys("Escape");
      await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the partial Pin window did not hide" });

      await showAgain();
      await browser.waitUntil(() => provider.requests.length === 2, {
        timeoutMsg: "showing the dropped Input reused its partial result instead of requesting again",
      });
      await expect($("body")).toHaveText(translated, { containing: true });
      await $("button[aria-label='Copy translation']").waitForEnabled();
      expect(provider.requests[1].body.messages[1].content).toContain(input);
    } finally {
      held.open();
    }
  });
});
