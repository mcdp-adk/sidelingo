import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataFolders, identifier, relaunch } from "../support/app";
import { clearClipboard, writeClipboardBitmap, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider } from "../support/provider";

function filesBelow(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      return entry.isDirectory() ? filesBelow(path) : entry.isFile() ? [path] : [];
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("Session data privacy", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    clearClipboard();
    await provider.close();
  });

  it("keeps copied text, image input, and round results out of both AppData folders", async () => {
    const unique = Date.now();
    const textInput = `sidelingo-private-text-input-${unique}`;
    const textTranslation = `sidelingo-private-text-result-${unique}`;
    const imageSource = `sidelingo-private-image-source-${unique}`;
    const imageTranslation = `sidelingo-private-image-result-${unique}`;
    provider.reset(({ body }) => {
      const content = body.messages[1].content;
      if (Array.isArray(content)) return [{ delta: { content: imageSource } }];
      return [
        {
          delta: {
            content: content.includes(textInput) ? textTranslation : imageTranslation,
          },
        },
      ];
    });
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });

    writeClipboardText(textInput);
    await expect($("body")).toHaveText(textTranslation, { containing: true, wait: 15_000 });

    writeClipboardBitmap(80, 40);
    await expect($("body")).toHaveText(imageTranslation, { containing: true, wait: 15_000 });
    expect(provider.requests).toHaveLength(3);

    const textRequest = provider.requests.find(
      ({ body }) => typeof body.messages[1].content === "string" && body.messages[1].content.includes(textInput),
    );
    expect(textRequest).toBeDefined();
    const imageTranslationRequest = provider.requests.find(
      ({ body }) => typeof body.messages[1].content === "string" && body.messages[1].content.includes(imageSource),
    );
    expect(imageTranslationRequest).toBeDefined();
    const imageRequest = provider.requests.find(({ body }) => Array.isArray(body.messages[1].content));
    expect(imageRequest).toBeDefined();
    const imagePart = imageRequest!.body.messages[1].content.find(
      (part: { type: string }) => part.type === "image_url",
    );
    const imageDataUrl: string = imagePart.image_url.url;
    expect(imageDataUrl).toMatch(/^data:image\/png;base64,/);
    const imageBytes = Buffer.from(imageDataUrl.slice("data:image/png;base64,".length), "base64");
    const markers = [
      { name: "copied text", bytes: Buffer.from(textInput, "utf8") },
      { name: "text result", bytes: Buffer.from(textTranslation, "utf8") },
      { name: "image source", bytes: Buffer.from(imageSource, "utf8") },
      { name: "image result", bytes: Buffer.from(imageTranslation, "utf8") },
      { name: "received image data URL", bytes: Buffer.from(imageDataUrl, "utf8") },
      { name: "received image PNG bytes", bytes: imageBytes },
    ];
    const { roaming, local } = dataFolders(identifier);
    const leaks = [roaming, local].flatMap((folder) =>
      filesBelow(folder).flatMap((path) => {
        const contents = readFileSync(path);
        return markers.filter(({ bytes }) => contents.includes(bytes)).map(({ name }) => `${name} in ${path}`);
      }),
    );

    expect(leaks).toEqual([]);
  });
});
