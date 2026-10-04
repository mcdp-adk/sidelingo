import { readClipboardText, writeClipboardText } from "../support/clipboard";

describe("The clipboard helper", () => {
  it("writes text to the Windows clipboard and reads it back", () => {
    const text = `sidelingo ${Date.now()}\n剪贴板 — “quotes” 'and' $dollars ✓`;
    writeClipboardText(text);
    expect(readClipboardText()).toBe(text);
  });
});
