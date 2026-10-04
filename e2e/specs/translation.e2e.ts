import type { ChainablePromiseElement } from "webdriverio";
import { appExe, relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider, gate } from "../support/provider";
import { inspectWindows } from "../support/window";

/** The Translated text's first paragraph. */
const paragraph = () => $("p");

/** Words unique to this call, `count` of them on one line. */
function words(count = 8, prefix = "word"): string {
  const stamp = Date.now();
  return Array.from({ length: count }, (_, i) => `${prefix}${i}-${stamp}`).join(" ");
}

describe("Translating a copied line", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("sends one request and streams the Translated text into the window as chunks arrive", async () => {
    const first = words(4, "first");
    const second = words(4, "second");
    const held = gate();
    provider.reset([{ delta: { content: first } }, held, { delta: { content: ` ${second}` } }]);
    writeClipboardText(words());
    await relaunch({ settings: customSettings(provider) });

    await expect(paragraph()).toHaveText(first);
    held.open();
    await expect(paragraph()).toHaveText(`${first} ${second}`);
    expect(provider.requests).toHaveLength(1);
  });

  it("sends no request for a copy made while the window is hidden", async () => {
    provider.reset();
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
    // The empty state renders before the window shows, and Esc hides nothing until it has.
    await browser.waitUntil(() => inspectWindows(appExe, "sidelingo")[0]?.visible, {
      timeoutMsg: "the Pin window never showed",
    });
    await browser.keys("Escape");
    await browser.waitUntil(() => !inspectWindows(appExe, "sidelingo")[0].visible, {
      timeoutMsg: "the Pin window is still visible",
    });

    writeClipboardText(words());
    // Well past the listener's 200 ms coalescing.
    await browser.pause(1000);
    expect(provider.requests).toHaveLength(0);
  });

  it("wraps a long unbroken line instead of scrolling sideways, leaving sideways scrolling to code", async () => {
    // No space or hyphen offers a line break inside the folder name.
    const path = `C:\\Users\\${"a".repeat(120)}${Date.now()}\\file.txt`;
    const code = `run --flag ${"x".repeat(300)}`;
    provider.reset([{ delta: { content: `${path}\n\n\`\`\`\n${code}\n\`\`\`` } }]);
    writeClipboardText(path);
    await relaunch({ settings: customSettings(provider) });
    await expect(paragraph()).toHaveText(path);

    const viewport = (await $("body").getSize()).width;
    const overflows = async (element: ChainablePromiseElement) =>
      Number(await element.getProperty("scrollWidth")) > Number(await element.getProperty("clientWidth"));
    expect(await overflows(paragraph())).toBe(false);
    const block = $("pre");
    await expect(block).toHaveText(code, { containing: true });
    expect(await overflows(block)).toBe(true);
    const [at, size] = await Promise.all([block.getLocation(), block.getSize()]);
    expect(at.x + size.width).toBeLessThanOrEqual(viewport);
  });

  it("keeps the scroll position while text streams in", async () => {
    const first = words(300, "first");
    const second = words(300, "second");
    const held = gate();
    provider.reset([{ delta: { content: first } }, held, { delta: { content: ` ${second}` } }]);
    writeClipboardText(words());
    await relaunch({ settings: customSettings(provider) });
    await expect(paragraph()).toHaveText(first);

    // Over the window's middle, since the paragraph's own middle lies below it.
    await browser.action("wheel").scroll({ x: 100, y: 120, deltaY: 2000 }).perform();
    const top = async () => (await paragraph().getLocation()).y;
    await browser.waitUntil(async () => (await top()) < 0, { timeoutMsg: "the content didn't scroll" });
    const scrolled = await top();

    held.open();
    await expect(paragraph()).toHaveText(`${first} ${second}`);
    expect(await top()).toBe(scrolled);
  });
});
