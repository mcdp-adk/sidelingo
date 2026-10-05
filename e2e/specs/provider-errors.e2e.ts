import { relaunch } from "../support/app";
import { readClipboardText, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider } from "../support/provider";

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
