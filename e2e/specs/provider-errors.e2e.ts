import { relaunch } from "../app";
import { readClipboardText, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";

const CTRL = String.fromCharCode(0xe009);
const pointerAction = () => browser.action("pointer");

async function selectWithCtrlDrag(element: WebdriverIO.Element) {
  const { width } = await element.getSize();
  const pointer = pointerAction()
    .pause(0)
    .move({ origin: element, x: -Math.floor(width / 2) + 2, y: 0 })
    .down()
    .move({ origin: element, x: Math.floor(width / 2) - 2, y: 0, duration: 200 })
    .up();
  let key = browser.action("key").down(CTRL);
  for (let i = 1; i < pointer.toJSON().actions.length; i++) key = key.pause(0);
  await browser.actions([key.up(CTRL), pointer]);
}

describe("Provider errors", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("opens Provider settings from an HTTP 401 error", async () => {
    const copied = `Single-line authentication failure ${Date.now()}`;
    const detail = `Synthetic authentication failure ${Date.now()}`;
    provider.reset({ status: 401, message: detail });
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });

    await browser.waitUntil(() => provider.requests.length > 0, {
      timeoutMsg: "the Input did not reach the fake Provider",
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].method).toBe("POST");

    await expect($("body")).toHaveText(detail, { containing: true });
    const visible = await $("body").getText();
    expect(visible).toMatch(/Translation failed/);
    expect(visible).toMatch(/Provider HTTP error 401/);
    expect(visible).toContain(detail);
    expect(provider.requests).toHaveLength(1);
    const pin = await browser.getWindowHandle();
    const openSettings = $("[role=group]").$(`button=Open settings`);
    await expect(openSettings).toBeDisplayed();
    await openSettings.click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
    const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
    await browser.switchToWindow(settings);
    await expect($("h1")).toHaveText("Settings");
    await expect($("h2=Provider")).toBeDisplayed();
    await expect($("input:focus, select:focus, textarea:focus, [role=combobox]:focus")).not.toExist();
  });

  it("keeps partial Structuring text and shows a network error after the stream drops", async () => {
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    const partial = `## Partial Source ${Date.now()}`;
    const held = gate();
    let responseHeld = false;
    const holdResponse = {
      wait: held.wait,
      onReached: () => {
        responseHeld = true;
        held.signalReached();
      },
    };
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content)
        ? [{ delta: { content: partial } }, holdResponse, { drop: true }]
        : [{ delta: { content: `Unexpected Translation ${Date.now()}` } }],
    );
    writeClipboardText(copied);
    await relaunch({ settings: { ...customSettings(provider), displayMode: "both" } });

    try {
      await browser.waitUntil(() => provider.requests.length > 0, {
        timeoutMsg: "the multiline Input did not reach the fake Provider",
      });
      await browser.waitUntil(() => responseHeld, {
        timeoutMsg: "the fake Provider did not hold the response after its partial content",
      });
      const sourcePane = $("[role=region][aria-label='Source']");
      await expect(sourcePane).toHaveText(partial.slice(3), { containing: true });
      await expect($("button[aria-label='Copy source']")).toBeDisabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      expect(provider.requests).toHaveLength(1);
      const dropped = provider.requests[0];

      held.open();
      await browser.waitUntil(() => provider.interruptedRequests.includes(dropped), {
        timeoutMsg: "the scripted Provider connection did not actually drop",
      });
      await browser.waitUntil(async () => /Network error|网络错误/.test(await sourcePane.getText()), {
        timeoutMsg: "the dropped stream did not show its network error in Source",
      });
      const sourceVisible = await sourcePane.getText();
      expect(sourceVisible).toContain(partial.slice(3));
      expect(sourceVisible).toMatch(/Structuring failed|整理失败/);
      expect(sourceVisible).toMatch(/Network error|网络错误/);
      expect(sourceVisible.indexOf(partial.slice(3))).toBeLessThan(sourceVisible.search(/Network error|网络错误/));
      const translationPane = $("[role=region][aria-label='Translation']");
      await browser.waitUntil(async () => /Network error|网络错误/.test(await translationPane.getText()), {
        timeoutMsg: "the Structuring failure did not appear in Translation",
      });
      await expect($("button[aria-label='Copy source']")).toBeDisabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      expect(provider.requests).toHaveLength(1);
    } finally {
      held.open();
    }
  });

  it("lets the Provider's error detail be selected and copied", async () => {
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    const detail = `Synthetic selectable error detail ${Date.now()}`;
    provider.reset({ status: 429, message: detail });
    writeClipboardText(copied);
    await relaunch({ settings: { ...customSettings(provider), displayMode: "both" } });

    const pane = $("[role=region][aria-label='Translation']");
    await browser.waitUntil(async () => (await pane.getText()).includes(detail), {
      timeoutMsg: "the Provider detail did not appear in the Translation pane",
    });
    const detailText = pane.$(`//*[text()="${detail}"]`);
    await selectWithCtrlDrag(await detailText.getElement());
    await browser.keys([CTRL, "c"]);
    await browser.waitUntil(() => readClipboardText() !== copied, {
      timeoutMsg: "selecting and copying the error detail did not change the clipboard",
    });

    const selected = readClipboardText().trim();
    expect(selected.length).toBeGreaterThan(0);
    expect(detail).toContain(selected);
    expect(provider.requests).toHaveLength(1);
  });
});
