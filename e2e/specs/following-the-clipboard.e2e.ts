import { spawn } from "node:child_process";
import { once } from "node:events";
import { appExe, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider } from "../provider";
import { inspectWindows } from "../window";

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
    writeClipboardText(line());
    await launch();
    await paragraph().waitForExist();
    await browser.keys("Escape");
    await browser.waitUntil(() => !pinWindows()[0].visible, { timeoutMsg: "the Pin window is still visible" });

    const current = line();
    writeClipboardText(current);
    const second = spawn(appExe, { stdio: "ignore" });
    // The second launch hands over to the running one and quits.
    const [code] = await once(second, "exit");
    expect(code).toBe(0);

    await browser.waitUntil(() => pinWindows()[0].visible, { timeoutMsg: "the Pin window didn't show" });
    expect(pinWindows()).toHaveLength(1);
    await expectShown(current);
  });
});
