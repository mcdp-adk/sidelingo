import { relaunch } from "../app";
import { clearClipboard, inspectPng, writeClipboardBitmap } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";

describe("Copied images", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  for (const format of ["dib", "dibv5"] as const) {
    it(`structures a copied ${format} as a PNG image, then translates its Source text`, async () => {
      const source = "Text read from the synthetic image";
      const translated = `Image translation ${Date.now()}`;
      const held = gate();
      let receivedAt = 0;
      provider.reset(({ body }) => {
        const structuring = Array.isArray(body.messages[1].content);
        if (structuring) receivedAt = performance.now();
        return [
          ...(structuring && format === "dib" ? [{ wait: held.wait }] : []),
          { delta: { content: structuring ? source : translated } },
        ];
      });
      clearClipboard();
      await relaunch({ settings: customSettings(provider) });
      const [width, height] = format === "dib" ? [1536, 1024] : [80, 40];
      const copiedAt = performance.now();
      writeClipboardBitmap(width, height, { format, noise: format === "dib" });
      const writtenAt = performance.now();
      let structuringShownAt = 0;
      if (format === "dib") {
        try {
          await expect($('//*[normalize-space(text())="Structuring…"]')).toBeDisplayed({ wait: 15_000 });
          structuringShownAt = performance.now();
          await browser.waitUntil(() => provider.requests.length === 1, { timeout: 15_000 });
        } finally {
          held.open();
        }
      }

      await expect($("body")).toHaveText(translated, { containing: true, wait: 15_000 });
      expect(provider.requests).toHaveLength(2);
      const parts = provider.requests[0].body.messages[1].content;
      const image = parts.find((part: { type: string }) => part.type === "image_url");
      expect(image.image_url.url).toMatch(/^data:image\/png;base64,/);
      expect(inspectPng(image.image_url.url.split(",")[1])).toEqual({
        width,
        height,
        topLeft: "ffff0000",
        bottomRight: "ff0000ff",
      });
      if (format === "dib") {
        const pngBytes = Buffer.from(image.image_url.url.split(",")[1], "base64").length;
        expect(pngBytes).toBeGreaterThan(3 * 1024 * 1024);
        console.info(
          "Image payload measurement",
          JSON.stringify({
            pngBytes,
            dataUrlBytes: image.image_url.url.length,
            copyStartToProviderMs: Math.round(receivedAt - copiedAt),
            clipboardWrittenToProviderMs: Math.round(receivedAt - writtenAt),
            clipboardWrittenToStructuringShownMs: Math.round(structuringShownAt - writtenAt),
          }),
        );
      }
      expect(provider.requests[0].body.messages[0].content).toContain("transcribe the visible text");
      expect(provider.requests[1].body.messages[1].content).toContain(source);
    });
  }

  it("scales landscape and portrait images proportionally to a 2048 px longest edge", async () => {
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    for (const [width, height, expectedWidth, expectedHeight] of [
      [3000, 1500, 2048, 1024],
      [1500, 3000, 1024, 2048],
    ]) {
      const translated = `Scaled ${width} x ${height}`;
      provider.reset(({ body }) => [
        { delta: { content: Array.isArray(body.messages[1].content) ? "Image Source" : translated } },
      ]);
      writeClipboardBitmap(width, height);
      await expect($("body")).toHaveText(translated, { containing: true, wait: 15_000 });
      const image = provider.requests[0].body.messages[1].content.find(
        (part: { type: string }) => part.type === "image_url",
      );
      const png = inspectPng(image.image_url.url.split(",")[1]);
      expect([png.width, png.height]).toEqual([expectedWidth, expectedHeight]);
    }
  });

  it("prefers usable text when the clipboard also contains a bitmap", async () => {
    const copied = `Mixed clipboard text ${Date.now()}`;
    const translated = `Text wins Translation ${Date.now()}`;
    provider.reset(({ body }) => [
      {
        delta: {
          content: Array.isArray(body.messages[1].content)
            ? "Bitmap Source"
            : body.messages[1].content.endsWith(copied)
              ? translated
              : "Bitmap Translation",
        },
      },
    ]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    writeClipboardBitmap(80, 40, { text: copied });

    await expect($("body")).toHaveText(translated, { containing: true });
    expect(provider.requests).toHaveLength(1);
    expect(typeof provider.requests[0].body.messages[1].content).toBe("string");
    expect(provider.requests[0].body.messages[1].content).toContain(copied);
  });

  for (const [language, message] of [
    ["en-US", "No text found in the image"],
    ["zh-CN", "图像中没有找到文字"],
  ]) {
    it(`handles only an exact NO_TEXT result as an info outcome in ${language}`, async () => {
      provider.reset(({ body }) => [
        { delta: { content: Array.isArray(body.messages[1].content) ? " \nNO_TEXT\n " : "Unexpected Translation" } },
      ]);
      clearClipboard();
      await relaunch({ language, settings: customSettings(provider) });
      writeClipboardBitmap(80, 40);

      await expect($("body")).toHaveText(message, { containing: true });
      await expect($('[role="group"]')).toHaveText(message);
      await expect($("body")).not.toHaveText("NO_TEXT", { containing: true });
      expect(provider.requests).toHaveLength(1);

      const source = "The label reads NO_TEXT";
      const translated = `Literal label translation ${Date.now()}`;
      provider.reset(({ body }) => [
        { delta: { content: Array.isArray(body.messages[1].content) ? source : translated } },
      ]);
      // A different image is a new Input even when identical Inputs are reused later.
      writeClipboardBitmap(81, 40);
      await expect($("body")).toHaveText(translated, { containing: true });
      expect(provider.requests).toHaveLength(2);
      expect(provider.requests[1].body.messages[1].content).toContain(source);
    });
  }
});
