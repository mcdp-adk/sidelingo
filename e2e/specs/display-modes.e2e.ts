import { execFileSync } from "node:child_process";
import { appExe, capabilities, relaunch } from "../app";
import { writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";
import { inspectWindows, minimumTrackingSizes, setWindowBounds, windowBounds } from "../window";

async function scrollPosition(pane: WebdriverIO.Element) {
  const [top, height, client] = await Promise.all([
    pane.getProperty("scrollTop"),
    pane.getProperty("scrollHeight"),
    pane.getProperty("clientHeight"),
  ]);
  return { top: Number(top), proportion: Number(top) / (Number(height) - Number(client)) };
}

describe("Display modes", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("switches between Source text, Translated text and both with tabs, without a new request", async () => {
    provider.reset(() => [
      { delta: { content: provider.requests.length === 1 ? "Source result" : "Translated result" } },
    ]);
    writeClipboardText("A copied line\nAnother copied line");
    await relaunch({ settings: customSettings(provider) });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    setWindowBounds(appExe, "sidelingo", { x: 120, y: 160, width: 800, height: 500 });
    await $("[role=toolbar]").moveTo();
    await expect($$("[role=tab]")).toBeElementsArrayOfSize(3);
    await $("[role=tab][value=source]").click();
    await expect($$("p")).toBeElementsArrayOfSize(1);
    await expect($("p")).toHaveText("Source result");
    await $("[role=tab][value=translation]").click();
    await expect($$("p")).toBeElementsArrayOfSize(1);
    await expect($("p")).toHaveText("Translated result");
    await $("[role=tab][value=both]").click();
    await expect($$("p")).toBeElementsArrayOfSize(2);
    const panes = await $$("p");
    await expect(panes[0]).toHaveText("Source result");
    await expect(panes[1]).toHaveText("Translated result");
    expect(provider.requests).toHaveLength(2);
  });

  it("switches with Ctrl+1–3 and remembers the mode across a hide and a restart", async () => {
    provider.reset(({ body }) => [
      {
        delta: {
          content: Array.isArray(body.messages.at(-1).content) ? "Remembered Source" : "Remembered Translation",
        },
      },
    ]);
    writeClipboardText("Another copied line\nFor remembering a mode");
    await relaunch({ settings: customSettings(provider) });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    setWindowBounds(appExe, "sidelingo", { x: 120, y: 160, width: 800, height: 500 });
    await $("[role=toolbar]").moveTo();

    await browser.keys(["Control", "1"]);
    await expect($("[role=tab][value=source]")).toHaveAttribute("aria-selected", "true");
    await expect($("p")).toHaveText("Remembered Source");
    await browser.keys(["Control", "2"]);
    await expect($("[role=tab][value=translation]")).toHaveAttribute("aria-selected", "true");
    await expect($("p")).toHaveText("Remembered Translation");
    await browser.keys(["Control", "3"]);
    await expect($("[role=tab][value=both]")).toHaveAttribute("aria-selected", "true");
    await expect($$("p")).toBeElementsArrayOfSize(2);
    expect(provider.requests).toHaveLength(2);

    await browser.keys("Escape");
    await browser.waitUntil(() => inspectWindows(appExe, "sidelingo").every((window) => !window.visible));
    execFileSync(appExe, [], { stdio: "ignore", timeout: 5000 });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    await expect($("[role=tab][value=both]")).toHaveAttribute("aria-selected", "true");
    await expect($$("p")).toBeElementsArrayOfSize(2);

    // Keep only what the app really saved; the harness supplies no chosen mode.
    await browser.reloadSession(capabilities());
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    await expect($("[role=tab][value=both]")).toHaveAttribute("aria-selected", "true");
    await expect($$("p")).toBeElementsArrayOfSize(2);
    const panes = await $$("p");
    await expect(panes[0]).toHaveText("Remembered Source");
    await expect(panes[1]).toHaveText("Remembered Translation");
  });

  it("splits two equally sized panes across the native window's wide or tall orientation", async () => {
    provider.reset(({ body }) => [
      { delta: { content: Array.isArray(body.messages.at(-1).content) ? "Split Source" : "Split Translation" } },
    ]);
    writeClipboardText("Lines to split\nBetween result panes");
    await relaunch({ settings: customSettings(provider) });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    await browser.keys(["Control", "3"]);
    await expect($("[role=tab][value=both]")).toHaveAttribute("aria-selected", "true");

    for (const [width, height] of [
      [800, 500],
      [500, 800],
    ]) {
      const bounds = { x: 120, y: 100, width, height };
      setWindowBounds(appExe, "sidelingo", bounds);
      expect(windowBounds(appExe, "sidelingo")).toEqual([bounds]);
      await expect($$("[role=region]")).toBeElementsArrayOfSize(2);
      const source = $("[role=region][aria-label=Source]");
      const translation = $("[role=region][aria-label=Translation]");
      const divider = $("[role=separator]");
      await expect(source).toHaveText("Split Source");
      await expect(translation).toHaveText("Split Translation");

      const wide = width >= height;
      await browser.waitUntil(async () => {
        const [a, b] = await Promise.all([source.getLocation(), translation.getLocation()]);
        return wide ? b.x > a.x && Math.abs(a.y - b.y) < 1 : b.y > a.y && Math.abs(a.x - b.x) < 1;
      });
      const [a, b, sash] = await Promise.all([source.getSize(), translation.getSize(), divider.getSize()]);
      const viewport = await $("body").getSize();
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      await expect(divider).toHaveAttribute("aria-orientation", wide ? "vertical" : "horizontal");
      if (wide) {
        expect(sash.width).toBe(1);
        expect(Math.abs(a.width + b.width + sash.width - viewport.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.height - viewport.height)).toBeLessThanOrEqual(1);
      } else {
        expect(sash.height).toBe(1);
        expect(Math.abs(a.height + b.height + sash.height - viewport.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.width - viewport.width)).toBeLessThanOrEqual(1);
      }
    }
    expect(provider.requests).toHaveLength(2);
  });

  it("scrolls the panes proportionally from wheel input and keeps their positions when text streams", async () => {
    const stream = gate();
    const sourceText = Array.from({ length: 100 }, (_, index) => `Source paragraph ${index + 1}`).join("\n\n");
    const partialTranslation = Array.from({ length: 40 }, (_, index) => `Translation paragraph ${index + 1}`).join(
      "\n\n",
    );
    const suffix = "\n\n" + Array.from({ length: 60 }, (_, index) => `Later paragraph ${index + 1}`).join("\n\n");
    provider.reset(({ body }) =>
      Array.isArray(body.messages.at(-1).content)
        ? [{ delta: { content: sourceText } }]
        : [
            { delta: { content: partialTranslation } },
            { wait: stream.wait, onReached: stream.signalReached },
            { delta: { content: suffix } },
          ],
    );
    try {
      writeClipboardText("Long text to compare\nAs it streams");
      await relaunch({ settings: customSettings(provider) });
      await stream.reached;
      await browser.keys(["Control", "3"]);
      setWindowBounds(appExe, "sidelingo", { x: 120, y: 100, width: 1000, height: 600 });
      const source = $("[role=region][aria-label=Source]");
      const translation = $("[role=region][aria-label=Translation]");
      await expect(translation.$$("p")).toBeElementsArrayOfSize(40);
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      const at = await source.getLocation();
      const size = await source.getSize();
      await browser
        .action("wheel")
        .scroll({ x: Math.round(at.x + size.width / 2), y: Math.round(at.y + size.height / 2), deltaY: 500 })
        .perform();
      await browser.waitUntil(async () => Number(await source.getProperty("scrollTop")) > 0, {
        timeoutMsg: "the wheel did not scroll the Source pane",
      });
      await browser.waitUntil(
        async () => {
          const [a, b] = await Promise.all([
            scrollPosition(await source.getElement()),
            scrollPosition(await translation.getElement()),
          ]);
          return a.top > 0 && b.top > 0 && Math.abs(a.proportion - b.proportion) < 0.01;
        },
        { timeoutMsg: "wheel input did not scroll the other pane to the same proportion" },
      );
      const before = await Promise.all([source.getProperty("scrollTop"), translation.getProperty("scrollTop")]);
      stream.open();
      await expect(translation.$$("p")).toBeElementsArrayOfSize(100);
      await expect($("button[aria-label='Copy translation']")).toBeEnabled();
      const after = await Promise.all([source.getProperty("scrollTop"), translation.getProperty("scrollTop")]);
      expect(after).toEqual(before);
      expect(provider.requests).toHaveLength(2);
    } finally {
      stream.open();
    }
  });

  it("scrolls from the focused pane's keyboard input in either direction", async () => {
    const sourceText = Array.from({ length: 100 }, (_, index) => `Keyboard Source ${index + 1}`).join("\n\n");
    const translationText = Array.from({ length: 60 }, (_, index) => `Keyboard Translation ${index + 1}`).join("\n\n");
    provider.reset(({ body }) => [
      { delta: { content: Array.isArray(body.messages.at(-1).content) ? sourceText : translationText } },
    ]);
    writeClipboardText("Text to scroll\nFrom the keyboard");
    await relaunch({ settings: customSettings(provider) });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    await browser.keys(["Control", "3"]);
    setWindowBounds(appExe, "sidelingo", { x: 120, y: 100, width: 1000, height: 600 });
    const source = $("[role=region][aria-label=Source]");
    const translation = $("[role=region][aria-label=Translation]");
    await browser.waitUntil(
      async () => {
        await browser.keys("Tab");
        return source.isFocused();
      },
      { timeoutMsg: "Tab did not reach the Source pane" },
    );
    await browser.keys("PageDown");
    await browser.waitUntil(async () => Number(await source.getProperty("scrollTop")) > 0, {
      timeoutMsg: "PageDown did not scroll the focused Source pane",
    });
    await browser.waitUntil(
      async () => {
        const [a, b] = await Promise.all([
          scrollPosition(await source.getElement()),
          scrollPosition(await translation.getElement()),
        ]);
        return b.top > 0 && Math.abs(a.proportion - b.proportion) < 0.01;
      },
      { timeoutMsg: "keyboard input did not scroll the other pane to the same proportion" },
    );
    await browser.keys("Tab");
    await expect(translation).toBeFocused();
    await browser.keys("Home");
    await browser.waitUntil(async () => Number(await translation.getProperty("scrollTop")) === 0);
    await browser.waitUntil(async () => Number(await source.getProperty("scrollTop")) === 0);
    expect(provider.requests).toHaveLength(2);
  });

  it("keeps both panes in step while a held pointer drags either scrollbar", async () => {
    const sourceText = Array.from({ length: 60 }, (_, index) => `Pointer Source ${index + 1}`).join("\n\n");
    const translationText = Array.from({ length: 100 }, (_, index) => `Pointer Translation ${index + 1}`).join("\n\n");
    provider.reset(({ body }) => [
      { delta: { content: Array.isArray(body.messages.at(-1).content) ? sourceText : translationText } },
    ]);
    writeClipboardText("Scroll long text\nWith a held pointer");
    await relaunch({ settings: customSettings(provider) });
    await expect($("button[aria-label='Copy translation']")).toBeEnabled();
    await browser.keys(["Control", "3"]);
    await expect($("[role=tab][value=both]")).toHaveAttribute("aria-selected", "true");
    const bounds = { x: 120, y: 100, width: 1000, height: 600 };
    setWindowBounds(appExe, "sidelingo", bounds);
    const source = $("[role=region][aria-label=Source]");
    const translation = $("[role=region][aria-label=Translation]");
    const dragThumb = async (pane: WebdriverIO.Element, distance: number) => {
      const [at, size, top, height, client] = await Promise.all([
        pane.getLocation(),
        pane.getSize(),
        pane.getProperty("scrollTop"),
        pane.getProperty("scrollHeight"),
        pane.getProperty("clientHeight"),
      ]);
      const thumbHeight = Number(client) ** 2 / Number(height);
      const thumbTop = (Number(top) / (Number(height) - Number(client))) * (Number(client) - thumbHeight);
      // The 6px browser scrollbar sits at the pane's right edge. Its grab point is
      // below the toolbar overlay even when the Source pane starts at the top.
      const x = Math.round(at.x + size.width - 3);
      const y = Math.round(at.y + thumbTop + thumbHeight * 0.65);
      await browser
        .action("pointer")
        .move({ x, y })
        .down()
        .move({ x, y: y + distance, duration: 800 })
        .up()
        .perform();
      expect(windowBounds(appExe, "sidelingo")).toEqual([bounds]);
    };
    await dragThumb(await source.getElement(), 130);
    await browser.waitUntil(async () => Number(await source.getProperty("scrollTop")) > 0, {
      timeoutMsg: "dragging the scrollbar did not scroll Source",
    });
    const inStep = async () => {
      const [a, b] = await Promise.all([
        scrollPosition(await source.getElement()),
        scrollPosition(await translation.getElement()),
      ]);
      return Math.abs(a.proportion - b.proportion) < 0.01;
    };
    await browser.waitUntil(inStep, { timeoutMsg: "the held Source scrollbar did not drive Translation" });
    const previous = Number(await translation.getProperty("scrollTop"));
    await dragThumb(await translation.getElement(), -130);
    await browser.waitUntil(async () => Number(await translation.getProperty("scrollTop")) < previous, {
      timeoutMsg: "dragging the scrollbar back did not scroll Translation",
    });
    await browser.waitUntil(inStep, { timeoutMsg: "the held Translation scrollbar did not drive Source" });
    expect(provider.requests).toHaveLength(2);
  });

  for (const { language, label, actions } of [
    {
      language: "en-US",
      label: "Display mode",
      actions: [
        "Copy source",
        "Copy translation",
        "Pause clipboard monitoring",
        "Regenerate (Ctrl+R / F5)",
        "Settings (Ctrl+,)",
        "Close (Esc)",
      ],
    },
    {
      language: "zh-CN",
      label: "显示模式",
      actions: ["复制原文", "复制译文", "暂停监视剪贴板", "重新生成 (Ctrl+R / F5)", "设置 (Ctrl+,)", "关闭 (Esc)"],
    },
  ]) {
    it(`collapses the tabs into one dropdown at the native minimum width and restores them when widened under ${language}`, async () => {
      provider.reset(({ body }) => [
        {
          delta: {
            content: Array.isArray(body.messages.at(-1).content) ? "Compact Source" : "Compact Translation",
          },
        },
      ]);
      writeClipboardText("Results for a narrow window\nAnd a wide one");
      await relaunch({ language, settings: customSettings(provider) });
      await expect($(`button[aria-label='${actions[1]}']`)).toBeEnabled();
      const [minimum] = minimumTrackingSizes(appExe, "sidelingo");
      const narrow = { x: 120, y: 100, width: minimum.width, height: Math.max(600, minimum.height) };
      setWindowBounds(appExe, "sidelingo", narrow);
      expect(windowBounds(appExe, "sidelingo")).toEqual([narrow]);
      await $("[role=toolbar]").moveTo();
      const dropdown = $(`select[aria-label='${label}']`);
      await expect(dropdown).toBeDisplayed();
      await expect(dropdown).toHaveValue("translation");
      await expect($("[role=tablist]")).not.toBeDisplayed();

      const viewport = await $("body").getSize();
      const occupied: { left: number; right: number }[] = [];
      for (const control of [dropdown, ...actions.map((action) => $(`button[aria-label='${action}']`))]) {
        await expect(control).toBeDisplayed();
        const [at, size] = await Promise.all([control.getLocation(), control.getSize()]);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x + size.width).toBeLessThanOrEqual(viewport.width);
        expect(at.y).toBeGreaterThanOrEqual(0);
        expect(at.y + size.height).toBeLessThanOrEqual(viewport.height);
        for (const previous of occupied) {
          expect(Math.min(at.x + size.width, previous.right) - Math.max(at.x, previous.left)).toBeLessThanOrEqual(0);
        }
        occupied.push({ left: at.x, right: at.x + size.width });
      }
      await dropdown.selectByAttribute("value", "source");
      await expect($$("p")).toBeElementsArrayOfSize(1);
      await expect($("p")).toHaveText("Compact Source");
      await dropdown.selectByAttribute("value", "translation");
      await expect($$("p")).toBeElementsArrayOfSize(1);
      await expect($("p")).toHaveText("Compact Translation");
      await dropdown.selectByAttribute("value", "both");
      await expect($$("p")).toBeElementsArrayOfSize(2);
      const results = await $$("p");
      await expect(results[0]).toHaveText("Compact Source");
      await expect(results[1]).toHaveText("Compact Translation");
      await browser.keys(["Control", "1"]);
      await expect(dropdown).toHaveValue("source");
      await expect($("p")).toHaveText("Compact Source");
      await browser.keys(["Control", "3"]);
      await expect(dropdown).toHaveValue("both");
      await expect($$("p")).toBeElementsArrayOfSize(2);

      const wide = { x: 120, y: 100, width: 800, height: 500 };
      setWindowBounds(appExe, "sidelingo", wide);
      expect(windowBounds(appExe, "sidelingo")).toEqual([wide]);
      await expect(dropdown).not.toExist();
      await expect($("[role=tablist]")).toBeDisplayed();
      await expect($("[role=tab][value=both]")).toHaveAttribute("aria-selected", "true");
      expect(provider.requests).toHaveLength(2);
    });
  }
});
