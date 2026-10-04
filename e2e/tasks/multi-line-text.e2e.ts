import { appExe, capabilities, relaunch } from "../support/app";
import { clearClipboard, readClipboardText, writeClipboardText } from "../support/clipboard";
import { FakeProvider, gate } from "../support/provider";
import { expectShownOption, setUpCustomProvider } from "../support/settings";
import { inspectWindows, minimumTrackingSizes, setWindowBounds, windowBounds } from "../support/window";

const paragraphs = (count: number, name: string) =>
  Array.from({ length: count }, (_, index) => `${name} paragraph ${index + 1}`).join("\n\n");

/** A Display mode tab, by the name it shows. */
async function tab(name: string) {
  for (const candidate of await $$("[role=tab]").getElements()) {
    if ((await candidate.getText()) === name) return candidate;
  }
  throw new Error(`no "${name}" tab`);
}

/** How far down a pane is scrolled, as a share of how far it can scroll. */
async function scrolled(pane: WebdriverIO.Element) {
  const [top, height, client] = await Promise.all(
    ["scrollTop", "scrollHeight", "clientHeight"].map(async (name) => Number(await pane.getProperty(name))),
  );
  return { top, share: top / (height - client) };
}

const overflowsSideways = async (element: WebdriverIO.Element) =>
  Number(await element.getProperty("scrollWidth")) > Number(await element.getProperty("clientWidth"));

describe("Task 2: multi-line text", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("reads, switches and copies a multi-line result, and finds its Display mode kept after a restart", async () => {
    const stamp = Date.now();
    // No space or hyphen offers a line break inside the folder name.
    const path = `C:\\Users\\${"a".repeat(120)}${stamp}\\file.txt`;
    const code = `run --flag ${"x".repeat(300)}`;
    const markdown = `# 标题\n\n- 第一项\n- 第二项\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n**强调**，以及[链接](https://example.com)。\n\n$E = mc^2$`;
    const source = `${markdown}\n\n${path}\n\n\`\`\`\n${code}\n\`\`\`\n\n${paragraphs(100, "Source")}`;
    const translated = paragraphs(40, "Translation");
    const later = "\n\n" + paragraphs(60, "Later");
    const structuring = gate();
    const translating = gate();
    provider.reset(({ body }) => {
      const structures = Array.isArray(body.messages[1].content);
      if (provider.requests.length > 2) return [{ delta: { content: structures ? "Restarted Source" : "Restarted" } }];
      return structures
        ? [{ delta: { content: markdown } }, structuring, { delta: { content: source.slice(markdown.length) } }]
        : [{ delta: { content: translated } }, translating, { delta: { content: later } }];
    });

    clearClipboard();
    await relaunch();
    const wide = { x: 120, y: 100, width: 1000, height: 600 };
    setWindowBounds(appExe, "sidelingo", wide);
    await setUpCustomProvider(provider.baseUrl);

    // 1. The Source text streams under a status, then the Translated text streams.
    writeClipboardText(`A copied line ${stamp}\nAnother copied line`);
    await expect($("p=Structuring…")).toBeDisplayed();
    await expect($("h1")).toHaveText("标题");
    await $("[role=toolbar]").moveTo();
    const copySource = $("aria/Copy source");
    const copyTranslation = $("aria/Copy translation");
    await expect(copySource).toBeDisabled();
    structuring.open();
    await expect($("p=Translation paragraph 40")).toBeDisplayed();
    await expect(copySource).toBeEnabled();
    await expect(copyTranslation).toBeDisabled();

    // 6, first half. Copy source copies the Markdown as written while the Translation still streams.
    await copySource.click();
    await browser.waitUntil(() => readClipboardText() === source, { timeoutMsg: "Copy source didn't copy the Source" });

    // 2. The tabs and Ctrl+1–3 switch Display modes.
    const regions = () => $$("[role=region]");
    const showsSource = async () => {
      await expect(regions()).toBeElementsArrayOfSize(1);
      await expect(regions()[0].$("h1")).toHaveText("标题");
    };
    const showsTranslation = async () => {
      await expect(regions()).toBeElementsArrayOfSize(1);
      await expect(regions()[0]).toHaveText("Translation paragraph 40", { containing: true });
      await expect(regions()[0].$("h1")).not.toExist();
    };
    const showsBoth = async () => {
      await expect(regions()).toBeElementsArrayOfSize(2);
      await expect(regions()[0].$("h1")).toHaveText("标题");
      await expect(regions()[1]).toHaveText("Translation paragraph 40", { containing: true });
    };
    await (await tab("Source")).click();
    await showsSource();
    // Markdown renders, CJK punctuation included, and a formula stays plain text.
    const sourcePane = regions()[0];
    await expect(sourcePane.$$("li")).toBeElementsArrayOfSize(2);
    await expect(sourcePane.$$("td")).toBeElementsArrayOfSize(2);
    await expect(sourcePane.$("button=链接")).toBeDisplayed();
    // The bold before CJK punctuation renders, so no asterisk is left.
    await expect(sourcePane).toHaveText("强调，以及链接。", { containing: true });
    await expect(sourcePane).not.toHaveText("*", { containing: true });
    await expect(sourcePane).toHaveText("$E = mc^2$", { containing: true });
    // 5. A long line wraps; only the code block scrolls sideways.
    await expect(sourcePane).toHaveText(path, { containing: true });
    const line = await sourcePane.$("p*=file.txt").getElement();
    expect(await overflowsSideways(line)).toBe(false);
    const [pane, lineAt] = await Promise.all([sourcePane.getElement(), line.getLocation()]);
    expect(lineAt.x + (await line.getSize()).width).toBeLessThanOrEqual(
      (await pane.getLocation()).x + (await pane.getSize()).width,
    );
    expect(await overflowsSideways(await sourcePane.$("pre").getElement())).toBe(true);

    await (await tab("Translation")).click();
    await showsTranslation();
    await (await tab("Side-by-side")).click();
    await showsBoth();
    await browser.keys(["Control", "1"]);
    await showsSource();
    await browser.keys(["Control", "2"]);
    await showsTranslation();
    await browser.keys(["Control", "3"]);
    await showsBoth();

    // 3. Side by side, the split follows the window's orientation.
    const sideBySide = async (across: boolean) =>
      browser.waitUntil(
        async () => {
          const [a, b] = await Promise.all([regions()[0].getLocation(), regions()[1].getLocation()]);
          return across ? b.x > a.x && Math.abs(a.y - b.y) < 1 : b.y > a.y && Math.abs(a.x - b.x) < 1;
        },
        { timeoutMsg: `the panes didn't split ${across ? "side by side" : "one above the other"}` },
      );
    await sideBySide(true);
    setWindowBounds(appExe, "sidelingo", { ...wide, width: 500, height: 800 });
    await sideBySide(false);
    setWindowBounds(appExe, "sidelingo", wide);
    await sideBySide(true);

    // The panes scroll in step and stay put while the Translation streams on.
    const [left, right] = await Promise.all([regions()[0].getElement(), regions()[1].getElement()]);
    const [at, size] = await Promise.all([left.getLocation(), left.getSize()]);
    await browser
      .action("wheel")
      .scroll({ x: Math.round(at.x + size.width / 2), y: Math.round(at.y + size.height / 2), deltaY: 500 })
      .perform();
    await browser.waitUntil(
      async () => {
        const [a, b] = await Promise.all([scrolled(left), scrolled(right)]);
        return a.top > 0 && b.top > 0 && Math.abs(a.share - b.share) < 0.01;
      },
      { timeoutMsg: "the panes didn't scroll in step" },
    );
    const before = await Promise.all([scrolled(left), scrolled(right)]);
    translating.open();
    await expect(right).toHaveText("Later paragraph 60", { containing: true });
    await expect(copyTranslation).toBeEnabled();
    expect((await Promise.all([scrolled(left), scrolled(right)])).map(({ top }) => top)).toEqual(
      before.map(({ top }) => top),
    );
    // Long content scrolls inside the window, which keeps its size.
    expect(windowBounds(appExe, "sidelingo")).toEqual([wide]);
    expect(provider.requests).toHaveLength(2);

    // 4. At its narrowest the window shows the Display modes in a dropdown.
    const [minimum] = minimumTrackingSizes(appExe, "sidelingo");
    setWindowBounds(appExe, "sidelingo", { ...wide, width: minimum.width });
    await $("[role=toolbar]").moveTo();
    const dropdown = $("aria/Display mode");
    await expect(dropdown).toBeDisplayed();
    await expect($("[role=tablist]")).not.toBeDisplayed();
    await expectShownOption(dropdown, "Side-by-side");
    await dropdown.selectByVisibleText("Source");
    await showsSource();
    await dropdown.selectByVisibleText("Side-by-side");
    await showsBoth();
    setWindowBounds(appExe, "sidelingo", wide);
    await expect(dropdown).not.toExist();
    await expect($("[role=tablist]")).toBeDisplayed();
    expect(provider.requests).toHaveLength(2);

    // 6, second half. After a restart the window opens side by side again.
    await browser.reloadSession(capabilities());
    await browser.waitUntil(() => inspectWindows(appExe, "sidelingo")[0]?.visible, {
      timeoutMsg: "the Pin window did not show after the restart",
    });
    await expect(regions()).toBeElementsArrayOfSize(2);
    await expect(regions()[1]).toHaveText("Restarted");
  });
});
