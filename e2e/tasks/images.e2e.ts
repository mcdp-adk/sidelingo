import { relaunch } from "../support/app";
import { clearClipboard, inspectPng, writeClipboardBitmap } from "../support/clipboard";
import { FakeProvider, gate, type RecordedRequest } from "../support/provider";
import { setUpCustom } from "../support/settings";

const structuring = (request: RecordedRequest) => Array.isArray(request.body.messages[1].content);

/** The image a Structuring request carries, decoded independently of the app. */
function sentImage(request: RecordedRequest) {
  const part = request.body.messages[1].content.find((item: { type: string }) => item.type === "image_url");
  expect(part.image_url.url).toMatch(/^data:image\/png;base64,/);
  return inspectPng(part.image_url.url.split(",")[1]);
}

/** Watches the window for a while, failing if `text` ever shows. */
async function neverShows(text: string, ms = 1000) {
  const until = Date.now() + ms;
  while (Date.now() < until) expect(await $("body").getText()).not.toContain(text);
}

describe("Task 3: images", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("structures and translates a copied screenshot, reads a copy with text as text, and answers a picture without text", async () => {
    const stamp = Date.now();
    clearClipboard();
    await relaunch();
    await setUpCustom({ baseUrl: provider.baseUrl, model: "vision-model" });

    // A screenshot: Structuring reads its text, then the Source text is translated.
    const source = `Text read from the screenshot ${stamp}`;
    const translated = `The screenshot translated ${stamp}`;
    const reading = gate();
    provider.reset((request) =>
      structuring(request) ? [reading, { delta: { content: source } }] : [{ delta: { content: translated } }],
    );
    writeClipboardBitmap(3000, 1500);
    await expect($("p=Structuring…")).toBeDisplayed();
    reading.open();
    await expect($("[role=region]")).toHaveText(translated);
    await browser.keys(["Control", "1"]);
    await expect($("[role=region]")).toHaveText(source);
    await browser.keys(["Control", "2"]);
    expect(provider.requests).toHaveLength(2);
    expect(sentImage(provider.requests[0])).toEqual({
      width: 2048,
      height: 1024,
      topLeft: "ffff0000",
      bottomRight: "ff0000ff",
    });
    expect(provider.requests[1].body.messages[1].content).toContain(source);

    // A copy holding both text and a bitmap is the text.
    const copied = `A line copied with a picture ${stamp}`;
    const lineTranslated = `The line translated ${stamp}`;
    provider.reset([{ delta: { content: lineTranslated } }]);
    writeClipboardBitmap(80, 40, { text: copied });
    await expect($("[role=region]")).toHaveText(lineTranslated);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.messages[1].content).toContain(copied);

    // A picture without text: the model answers NO_TEXT, which the user never reads as text.
    const finishing = gate();
    provider.reset([
      { delta: { content: " \nNO" } },
      { delta: { content: "_TEXT\n " } },
      { wait: finishing.wait, onReached: finishing.signalReached },
    ]);
    writeClipboardBitmap(1500, 3000, { format: "dibv5" });
    await expect($("p=Structuring…")).toBeDisplayed();
    // Whatever streamed before the Provider pauses is on screen by now.
    await finishing.reached;
    await neverShows("NO_TEXT");
    finishing.open();
    await expect($("[role=group]")).toHaveText("No text found in the image");
    expect(await $("body").getText()).not.toContain("NO_TEXT");
    expect(provider.requests).toHaveLength(1);
    expect(sentImage(provider.requests[0])).toEqual({
      width: 1024,
      height: 2048,
      topLeft: "ffff0000",
      bottomRight: "ff0000ff",
    });
  });
});
