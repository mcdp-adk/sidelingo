import { appExe, relaunch, type Launch } from "../app";
import { readClipboardText, writeClipboardText } from "../clipboard";
import { inspectWindows, minimumSizes } from "../window";

const pinVisible = () => inspectWindows(appExe, "sidelingo")[0].visible;
const toolbar = () => $("[role=toolbar]");
/** Close sits rightmost on the toolbar. */
async function closeButton() {
  const buttons = await toolbar().$$("button").getElements();
  return buttons.at(-1)!;
}

/** Copied before each launch: one paragraph, a few lines tall, whose middle sits clear of the toolbar overlaying the top. */
const LINE =
  "Drag anywhere in this window to move it. A plain click leaves it where it is, and dragging starts only once the pointer has travelled a few pixels. Hold Ctrl to select a passage or a word.";
const paragraph = () => $("p").getElement();

/** WebDriver's code for the Ctrl key. */
const CTRL = String.fromCharCode(0xe009);

const pointerAction = () => browser.action("pointer");
type PointerAction = ReturnType<typeof pointerAction>;

/** Performs the pointer steps that `steps` adds, with Ctrl held throughout. */
async function holdingCtrl(steps: (action: PointerAction) => PointerAction) {
  // The pointer waits out the tick in which Ctrl goes down.
  const pointer = steps(pointerAction().pause(0));
  // WebDriver runs its input sources in lockstep, one step each per tick, so Ctrl waits out every
  // pointer step before it comes up.
  let key = browser.action("key").down(CTRL);
  for (let i = 1; i < pointer.toJSON().actions.length; i++) key = key.pause(0);
  await browser.actions([key.up(CTRL), pointer]);
}

/** Drags across the middle line of `element`, from near its left edge to near its right. */
async function drag(element: WebdriverIO.Element, { ctrl = false } = {}) {
  const { width } = await element.getSize();
  const steps = (action: PointerAction) =>
    action
      .move({ origin: element, x: -Math.floor(width / 2) + 2, y: 0 })
      .down()
      .move({ origin: element, x: Math.floor(width / 2) - 2, y: 0, duration: 200 })
      .up();
  if (ctrl) await holdingCtrl(steps);
  else await steps(pointerAction()).perform();
}

async function ctrlDoubleClick(element: WebdriverIO.Element) {
  await holdingCtrl((action) => action.move({ origin: element }).down().up().down().up());
}

async function rightClick(element: WebdriverIO.Element) {
  await pointerAction().move({ origin: element }).down({ button: 2 }).up({ button: 2 }).perform();
}

/** Presses Ctrl+C and returns what the clipboard then holds. */
async function copy(): Promise<string> {
  await browser.keys([CTRL, "c"]);
  await browser.pause(300);
  return readClipboardText();
}

async function waitUntilHidden() {
  await browser.waitUntil(() => !pinVisible(), { timeoutMsg: "the Pin window is still visible" });
}

/**
 * Relaunches showing `text`, copied beforehand, and waits for it, so key presses reach the UI's
 * listeners. The clipboard then holds the whole text, which no partial selection's copy matches.
 */
async function launch(options?: Launch, text = LINE) {
  writeClipboardText(text);
  await relaunch(options);
  await expect($("p")).toHaveText(text);
}

describe("The Pin window", () => {
  it("hides on Esc", async () => {
    await launch();
    await browser.keys("Escape");
    await waitUntilHidden();
  });

  it("hides on the toolbar's rightmost button, Close", async () => {
    await launch();
    await (await closeButton()).click();
    await waitUntilHidden();
  });

  it("hides on a double-click on the content", async () => {
    await launch();
    await (await paragraph()).doubleClick();
    await waitUntilHidden();
  });

  it("stays visible on a double-click on the toolbar", async () => {
    await launch();
    // The toolbar's middle is empty; its buttons sit at the ends.
    await toolbar().doubleClick();
    await browser.pause(500);
    expect(pinVisible()).toBe(true);
  });

  for (const [language, tooltip] of [
    ["en-US", "Close (Esc)"],
    ["zh-CN", "关闭 (Esc)"],
  ]) {
    it(`names Close and its shortcut in a tooltip under ${language}`, async () => {
      await launch({ language });
      const close = await closeButton();
      // A hover sometimes leaves the tooltip closed in a full run, so hover until it shows.
      await browser.waitUntil(async () => {
        await close.moveTo();
        return $("[role=tooltip]").isExisting();
      });
      await expect($("[role=tooltip]")).toHaveText(tooltip);
    });
  }

  it("selects a passage on Ctrl+drag", async () => {
    await launch();
    await drag(await paragraph(), { ctrl: true });
    const copied = (await copy()).trim();
    expect(copied).toContain(" ");
    expect(copied).not.toBe(LINE);
    expect(LINE).toContain(copied);
  });

  it("selects a word on Ctrl+double-click, staying visible", async () => {
    await launch();
    await ctrlDoubleClick(await paragraph());
    const copied = (await copy()).trim();
    expect(copied).toMatch(/^\S+$/);
    expect(LINE).toContain(copied);
    expect(pinVisible()).toBe(true);
  });

  it("selects nothing on a plain drag", async () => {
    await launch();
    await drag(await paragraph());
    expect(await copy()).toBe(LINE);
  });

  it("copies the selection from a right-click menu holding only Copy selection", async () => {
    await launch();
    await ctrlDoubleClick(await paragraph());
    await rightClick(await paragraph());
    await $("[role=menu]").waitForDisplayed();
    expect(await $$("[role=menuitem]").map((item) => item.getText())).toEqual(["Copy selection"]);
    await $("[role=menuitem]").click();
    await browser.waitUntil(() => readClipboardText() !== LINE, { timeoutMsg: "the selection wasn't copied" });
    const copied = readClipboardText().trim();
    expect(copied).toMatch(/^\S+$/);
    expect(LINE).toContain(copied);
  });

  it("offers no right-click menu without a selection", async () => {
    await launch();
    await rightClick(await paragraph());
    await browser.pause(500);
    expect(await $("[role=menu]").isExisting()).toBe(false);
  });

  it("clears the selection on a click on empty space", async () => {
    await launch();
    await ctrlDoubleClick(await paragraph());
    // Halfway across the content's left padding, beside the paragraph's middle, clear of the toolbar.
    const { x, y } = await (await paragraph()).getLocation();
    const { height } = await (await paragraph()).getSize();
    await pointerAction()
      .move({ x: Math.floor(x / 2), y: Math.round(y + height / 2) })
      .down()
      .up()
      .perform();
    expect(await copy()).toBe(LINE);
  });

  it("closes only the right-click menu on Esc", async () => {
    await launch();
    await ctrlDoubleClick(await paragraph());
    await rightClick(await paragraph());
    await $("[role=menu]").waitForDisplayed();
    await browser.keys("Escape");
    await $("[role=menu]").waitForExist({ reverse: true });
    expect(pinVisible()).toBe(true);
  });

  it("scrolls content longer than the window inside it, keeping the window's size", async () => {
    await launch({}, Array(12).fill(LINE).join(" "));
    const size = await browser.getWindowSize();
    // The page fills the window.
    const { height } = await $("body").getSize();
    const content = await paragraph();
    const bottom = async () => (await content.getLocation()).y + (await content.getSize()).height;
    expect(await bottom()).toBeGreaterThan(height);
    // Over the window's middle, since the paragraph's own middle lies below it.
    await browser.action("wheel").scroll({ x: 100, y: 120, deltaY: 10_000 }).perform();
    await browser.waitUntil(async () => (await bottom()) <= height, {
      timeoutMsg: "the content's end didn't scroll into view",
    });
    expect(await browser.getWindowSize()).toEqual(size);
  });

  it("has a minimum content width of at least 230 logical px", async () => {
    await launch();
    const widths = minimumSizes(appExe, "sidelingo").map((size) => size.width);
    expect(widths).toHaveLength(1);
    // Whole physical pixels can round the logical minimum up by less than 1 px.
    expect(widths[0]).toBeGreaterThanOrEqual(230);
    expect(widths[0]).toBeLessThan(231);
  });
});
