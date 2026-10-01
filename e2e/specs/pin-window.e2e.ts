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

/** A paragraph of the content clear of the toolbar, which overlays the top. */
const paragraph = async () => (await $$("p").getElements())[1];

/** WebDriver's code for the Ctrl key. */
const CTRL = String.fromCharCode(0xe009);

/** Puts text no selection in the window holds on the clipboard, to see whether a copy replaces it. */
function sentinel(): string {
  const text = `sentinel ${Date.now()}`;
  writeClipboardText(text);
  return text;
}

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

/** Relaunches and waits for the Pin window's UI, so key presses reach its listeners. */
async function launch(options?: Launch) {
  await relaunch(options);
  await toolbar().waitForExist();
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
    sentinel();
    await drag(await paragraph(), { ctrl: true });
    const copied = (await copy()).trim();
    expect(copied).toContain(" ");
    expect(await (await paragraph()).getText()).toContain(copied);
  });

  it("selects a word on Ctrl+double-click, staying visible", async () => {
    await launch();
    sentinel();
    await ctrlDoubleClick(await paragraph());
    const copied = (await copy()).trim();
    expect(copied).toMatch(/^\S+$/);
    expect(await (await paragraph()).getText()).toContain(copied);
    expect(pinVisible()).toBe(true);
  });

  it("selects nothing on a plain drag", async () => {
    await launch();
    const before = sentinel();
    await drag(await paragraph());
    expect(await copy()).toBe(before);
  });

  it("copies the selection from a right-click menu holding only Copy selection", async () => {
    await launch();
    await ctrlDoubleClick(await paragraph());
    const word = await copy();
    sentinel();
    await rightClick(await paragraph());
    await $("[role=menu]").waitForDisplayed();
    expect(await $$("[role=menuitem]").map((item) => item.getText())).toEqual(["Copy selection"]);
    await $("[role=menuitem]").click();
    await browser.waitUntil(() => readClipboardText() === word, { timeoutMsg: "the selection wasn't copied" });
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
    const before = sentinel();
    // Halfway across the content's left padding, beside the paragraph, where there's no text.
    const { x, y } = await (await paragraph()).getLocation();
    await pointerAction()
      .move({ x: Math.floor(x / 2), y: Math.ceil(y) + 4 })
      .down()
      .up()
      .perform();
    expect(await copy()).toBe(before);
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
    await launch();
    const size = await browser.getWindowSize();
    const last = (await $$("p").getElements()).at(-1)!;
    expect(await last.isDisplayed({ withinViewport: true })).toBe(false);
    await browser
      .action("wheel")
      .scroll({ origin: await paragraph(), deltaY: 2000 })
      .perform();
    await expect(last).toBeDisplayedInViewport();
    expect(await browser.getWindowSize()).toEqual(size);
  });

  it("can't be resized narrower than 230 px", async () => {
    await launch();
    expect(minimumSizes(appExe, "sidelingo").map((size) => size.width)).toEqual([230]);
  });
});
