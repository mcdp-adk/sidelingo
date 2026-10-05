import { pinWindowCount, pinWindowHides, relaunch, showAgain } from "../support/app";
import {
  clearClipboard,
  readClipboardText,
  writeClipboardFiles,
  writeClipboardHtml,
  writeClipboardRtf,
  writeClipboardText,
  writeClipboardTextAndHold,
  writeClipboardTextWithMarker,
} from "../support/clipboard";
import { FakeProvider, keepingText } from "../support/provider";
import { setUpCustomProvider } from "../support/settings";

/** A single line, unique to this call, of `words` words: 300 run well past the window's height. */
function line(words = 8): string {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  return Array.from({ length: words }, (_, i) => `word${i}-${stamp}`).join(" ");
}

/** What the fake Provider sends back for a copied line, so its own copy differs from the line. */
const translated = (copied: string) => `${copied} (translated)`;

describe("Task 5: the window follows the clipboard", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("follows each copy worth translating, and only those", async () => {
    provider.reset(
      keepingText(({ body }) => [{ delta: { content: translated(body.messages.at(-1).content.split("\n").at(-1)) } }]),
    );
    /** The Translated text, as the window shows it. */
    const shownText = () => $("p");
    /** The Rounds sent so far: each sends Structuring, then Translation. */
    const expectRounds = (rounds: number) => expect(provider.requests).toHaveLength(2 * rounds);
    /** The user looks back at the window: nothing has changed and nothing more was sent. */
    async function expectUnchanged(shown: string, rounds: number) {
      await browser.pause(500);
      await expect(shownText()).toHaveText(translated(shown));
      expectRounds(rounds);
    }

    clearClipboard();
    await relaunch();
    await setUpCustomProvider(provider.baseUrl);

    // A copy made while the window is visible starts a Round; copying it again sends nothing.
    const first = line(300);
    writeClipboardText(first);
    await expect(shownText()).toHaveText(translated(first));
    expectRounds(1);
    writeClipboardText(first);
    await expectUnchanged(first, 1);

    // A newer copy replaces it, scrolled back to the top.
    await browser.action("wheel").scroll({ x: 100, y: 120, deltaY: 2000 }).perform();
    await browser.waitUntil(async () => (await shownText().getLocation()).y < 0, {
      timeoutMsg: "the text didn't scroll",
    });
    const newer = line(300);
    writeClipboardText(newer);
    await expect(shownText()).toHaveText(translated(newer));
    expect((await shownText().getLocation()).y).toBeGreaterThanOrEqual(0);
    expectRounds(2);

    // sidelingo's own Copy translation starts no Round.
    await $("[role=toolbar]").moveTo();
    const copyTranslation = $("aria/Copy translation");
    await expect(copyTranslation).toBeEnabled();
    await copyTranslation.click();
    await browser.waitUntil(() => readClipboardText() === translated(newer), {
      timeoutMsg: "the clipboard never held the Translated text",
    });
    await expectUnchanged(newer, 2);

    // Text its owner marks private starts no Round; text marked fit for clipboard history does.
    for (const marker of [
      "ExcludeClipboardContentFromMonitorProcessing",
      "CanIncludeInClipboardHistory",
      "Clipboard Viewer Ignore",
    ]) {
      writeClipboardTextWithMarker(marker);
      await expectUnchanged(newer, 2);
    }
    writeClipboardTextWithMarker("CanIncludeInClipboardHistory", 1);
    const allowed = "private copy CanIncludeInClipboardHistory";
    await expect(shownText()).toHaveText(translated(allowed));
    expectRounds(3);

    // Data with no usable text starts no Round.
    for (const write of [
      writeClipboardHtml,
      writeClipboardRtf,
      writeClipboardFiles,
      () => writeClipboardText(" \t\r\n "),
    ]) {
      write();
      await expectUnchanged(allowed, 3);
    }

    // A clipboard another program holds too long is dropped; one it releases soon is read.
    const heldTooLong = writeClipboardTextAndHold(line(), 900);
    await heldTooLong.finished;
    await expectUnchanged(allowed, 3);
    const released = line();
    await writeClipboardTextAndHold(released, 350).finished;
    await expect(shownText()).toHaveText(translated(released));
    expectRounds(4);

    // A pause ignores copies.
    await $("[role=toolbar]").moveTo();
    await $("aria/Pause clipboard monitoring").click();
    writeClipboardText(line());
    await expectUnchanged(released, 4);

    // A copy made while the window is hidden goes nowhere; showing the window reads the current clipboard.
    await browser.keys("Escape");
    await pinWindowHides();
    const whileHidden = line();
    writeClipboardText(whileHidden);
    await browser.pause(1000);
    expectRounds(4);
    await showAgain();
    expect(pinWindowCount()).toBe(1);
    await expect(shownText()).toHaveText(translated(whileHidden));
    expectRounds(5);

    // Hiding the window reset the pause.
    const afterShowing = line();
    writeClipboardText(afterShowing);
    await expect(shownText()).toHaveText(translated(afterShowing));
    expectRounds(6);

    await $("[role=toolbar]").moveTo();
    await $("aria/Close (Esc)").click();
    await pinWindowHides();
  });
});
