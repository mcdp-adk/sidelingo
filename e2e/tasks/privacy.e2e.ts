import { dataFolderLeaks, relaunch } from "../support/app";
import { clearClipboard, writeClipboardBitmap, writeClipboardText } from "../support/clipboard";
import { FakeProvider, keepingText } from "../support/provider";
import { setUpCustomProvider } from "../support/settings";

describe("Task 13: Rounds leave nothing private behind", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    clearClipboard();
    await provider.close();
  });

  it("keeps the copied text, the image and every result out of both data folders", async () => {
    const stamp = Date.now();
    const copiedText = `private copied text ${stamp}`;
    const textResult = `private text result ${stamp}`;
    const imageSource = `private image source ${stamp}`;
    const imageResult = `private image result ${stamp}`;
    // The text's Structuring keeps it and the image's returns its Source; each Translation returns its own result.
    provider.reset(
      keepingText(({ body }) => {
        const content = body.messages.at(-1).content;
        if (Array.isArray(content)) return [{ delta: { content: imageSource } }];
        return [{ delta: { content: content.includes(copiedText) ? textResult : imageResult } }];
      }),
    );
    clearClipboard();
    await relaunch();
    await setUpCustomProvider(provider.baseUrl);

    writeClipboardText(copiedText);
    await expect($("p")).toHaveText(textResult);
    writeClipboardBitmap(80, 40);
    await expect($("p")).toHaveText(imageResult);

    // The image as the Provider received it, in both the forms it could be kept.
    const image = provider.requests
      .flatMap(({ body }) => body.messages.at(-1).content)
      .find((part: { type?: string }) => part.type === "image_url");
    const dataUrl: string = image.image_url.url;
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(
      dataFolderLeaks({
        "the copied text": copiedText,
        "the text's result": textResult,
        "the image's Source": imageSource,
        "the image's result": imageResult,
        "the image as a data URL": dataUrl,
        "the image's PNG bytes": Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"),
      }),
    ).toEqual([]);
  });
});
