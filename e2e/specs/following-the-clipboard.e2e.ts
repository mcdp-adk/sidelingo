import { spawn } from "node:child_process";
import { once } from "node:events";
import { appExe, relaunch } from "../support/app";
import {
  clearClipboard,
  writeClipboardFiles,
  writeClipboardHtml,
  writeClipboardRtf,
  writeClipboardText,
  writeClipboardTextAndHold,
  writeClipboardTextWithMarker,
} from "../support/clipboard";
import { customSettings, FakeProvider } from "../support/provider";
import { inspectWindows } from "../support/window";

const pinWindows = () => inspectWindows(appExe, "sidelingo");
/** The Translated text's first paragraph, which the fake Provider makes the copied line itself. */
const paragraph = () => $("p");
let provider: FakeProvider;
/** Launches with the fake Provider set up. */
const launch = () => relaunch({ settings: customSettings(provider) });

/** A single line, unique to this call, of about `words` words. */
function line(words = 8): string {
  const stamp = Date.now();
  return Array.from({ length: words }, (_, i) => `word${i}-${stamp}`).join(" ");
}

async function expectShown(text: string) {
  await expect(paragraph()).toHaveText(text);
}

/** Scrolls the content down with the wheel over the window's middle. */
async function scrollDown() {
  await browser.action("wheel").scroll({ x: 100, y: 120, deltaY: 2000 }).perform();
}

/** Where the text's top sits in the window: negative once scrolled past. */
const paragraphTop = async () => (await paragraph().getLocation()).y;

describe("Following the clipboard", () => {
  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("shows a line copied while the window is visible", async () => {
    clearClipboard();
    await launch();
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });

    const copied = line();
    writeClipboardText(copied);
    await expectShown(copied);
  });

  it("ignores text marked private by the clipboard owner", async () => {
    provider.reset();
    const copied = line();
    writeClipboardText(copied);
    await launch();
    await expectShown(copied);
    await browser.waitUntil(() => provider.requests.length === 1);

    for (const marker of [
      "ExcludeClipboardContentFromMonitorProcessing",
      "CanIncludeInClipboardHistory",
      "Clipboard Viewer Ignore",
    ]) {
      writeClipboardTextWithMarker(marker);
      await browser.pause(350);
      await expectShown(copied);
      expect(provider.requests).toHaveLength(1);
    }

    writeClipboardTextWithMarker("CanIncludeInClipboardHistory", 1);
    await browser.pause(350);
    await expectShown("private copy CanIncludeInClipboardHistory");
    expect(provider.requests).toHaveLength(2);
  });

  it("keeps the current result for clipboard data with no usable text", async () => {
    provider.reset();
    const copied = line();
    writeClipboardText(copied);
    await launch();
    await expectShown(copied);
    await browser.waitUntil(() => provider.requests.length === 1);

    for (const write of [
      writeClipboardHtml,
      writeClipboardRtf,
      writeClipboardFiles,
      () => writeClipboardText(" \t\r\n "),
    ]) {
      write();
      await browser.pause(350);
      await expectShown(copied);
      expect(provider.requests).toHaveLength(1);
    }
  });

  it("silently drops a clipboard held past the retry window and reads one released in time", async () => {
    provider.reset();
    const copied = line();
    writeClipboardText(copied);
    await launch();
    await expectShown(copied);
    await browser.waitUntil(() => provider.requests.length === 1);

    const heldTooLong = writeClipboardTextAndHold(line(), 900);
    await heldTooLong.ready;
    await heldTooLong.finished;
    await browser.pause(150);
    await expectShown(copied);
    expect(provider.requests).toHaveLength(1);

    const released = line();
    const releasedInTime = writeClipboardTextAndHold(released, 350);
    await releasedInTime.ready;
    await releasedInTime.finished;
    await expectShown(released);
    await browser.waitUntil(() => provider.requests.length === 2);
  });

  it("replaces the line with a different copied one, scrolled back to the top", async () => {
    const first = line(300);
    writeClipboardText(first);
    await launch();
    await expectShown(first);
    await scrollDown();
    await browser.waitUntil(async () => (await paragraphTop()) < 0, { timeoutMsg: "the content didn't scroll" });

    const second = line(300);
    writeClipboardText(second);
    await expectShown(second);
    expect(await paragraphTop()).toBeGreaterThanOrEqual(0);
  });

  it("shows the line copied before a manual launch", async () => {
    const copied = line();
    writeClipboardText(copied);
    await launch();
    await expectShown(copied);
  });

  it("shows the existing, hidden window with the clipboard's current line when launched again", async () => {
    const firstTranslation = `Completed original Translation ${Date.now()}`;
    const currentTranslation = `Completed current Translation ${Date.now()}`;
    provider.reset(() => [
      { delta: { content: provider.requests.length === 1 ? firstTranslation : currentTranslation } },
    ]);
    writeClipboardText(line());
    await launch();
    await expect($("body")).toHaveText(firstTranslation, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(1);
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinWindows()[0].visible, { timeoutMsg: "the Pin window is still visible" });

    const current = line();
    writeClipboardText(current);
    await browser.pause(750);
    expect(provider.requests).toHaveLength(1);
    const second = spawn(appExe, { stdio: "ignore" });
    // The second launch hands over to the running one and quits.
    const [code] = await once(second, "exit");
    expect(code).toBe(0);

    await browser.waitUntil(() => pinWindows()[0].visible, { timeoutMsg: "the Pin window didn't show" });
    expect(pinWindows()).toHaveLength(1);
    await expect($("body")).toHaveText(currentTranslation, { containing: true });
    await $("button[aria-label='Copy translation']").waitForEnabled();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(current);
  });
});
