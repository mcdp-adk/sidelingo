import type { ChainablePromiseElement } from "webdriverio";
import { appExe, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";
import { inspectWindows } from "../window";

/** The Translated text's first paragraph. */
const paragraph = () => $("p");

/** Words unique to this call, `count` of them on one line. */
function words(count = 8, prefix = "word"): string {
  const stamp = Date.now();
  return Array.from({ length: count }, (_, i) => `${prefix}${i}-${stamp}`).join(" ");
}

describe("Translating a copied line", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("sends one request and streams the Translated text into the window as chunks arrive", async () => {
    const first = words(4, "first");
    const second = words(4, "second");
    const held = gate();
    provider.reset([{ delta: { content: first } }, held, { delta: { content: ` ${second}` } }]);
    writeClipboardText(words());
    await relaunch({ settings: customSettings(provider) });

    await expect(paragraph()).toHaveText(first);
    held.open();
    await expect(paragraph()).toHaveText(`${first} ${second}`);
    expect(provider.requests).toHaveLength(1);
  });

  it("sends the seeded model and the default prompt in the Target language, streamed, with no temperature or key", async () => {
    provider.reset();
    const copied = words();
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider, { model: "seeded-model", targetLanguage: "ja" }) });
    await expect(paragraph()).toHaveText(copied);

    expect(provider.requests).toHaveLength(1);
    const [{ method, path, headers, body }] = provider.requests;
    expect(method).toBe("POST");
    expect(path).toBe("/v1/chat/completions");
    expect(headers.authorization).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream"]);
    expect(body).toMatchObject({ model: "seeded-model", stream: true });

    const [system, user] = body.messages;
    expect(body.messages).toHaveLength(2);
    expect(system.role).toBe("system");
    expect(system.content).toMatch(
      /^You are a professional Japanese native translator who needs to fluently translate text into Japanese\.\n/,
    );
    expect(system.content).toContain(
      "\n## Translation Rules\n1. Output only the translated content, without explanations or additional content",
    );
    expect(system.content).toContain(
      "\n4. For content that should not be translated (such as proper nouns, code, etc.), keep the original text.\n",
    );
    expect(system.content).toMatch(/\nWebpage title: No title available\nWebpage summary: No summary available$/);
    expect(system.content).not.toContain("{{");
    expect(user).toEqual({ role: "user", content: `Translate to Japanese:\n\n\n${copied}` });
  });

  it("reaches the same endpoint from a Base URL with a trailing slash", async () => {
    provider.reset();
    const copied = words();
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider, { baseUrl: `${provider.baseUrl}/` }) });
    await expect(paragraph()).toHaveText(copied);

    expect(provider.requests.map(({ path }) => path)).toEqual(["/v1/chat/completions"]);
  });

  it("shows neither keep-alive comments nor reasoning", async () => {
    const answer = words();
    provider.reset([
      { comment: "keep-alive" },
      { delta: { reasoning_content: "reasoning-content-leaked" } },
      { comment: "OPENROUTER PROCESSING" },
      { delta: { reasoning: "reasoning-leaked" } },
      { delta: { content: answer } },
    ]);
    writeClipboardText(words());
    await relaunch({ settings: customSettings(provider) });

    await expect(paragraph()).toHaveText(answer);
    await expect($("body")).not.toHaveText(/leaked|keep-alive|PROCESSING/);
  });

  it("still sends text already in the Target language, English while none is stored", async () => {
    provider.reset();
    const copied = `The quick brown fox jumps over the lazy dog ${Date.now()}`;
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });
    await expect(paragraph()).toHaveText(copied);

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.messages[1].content).toBe(`Translate to English:\n\n\n${copied}`);
  });

  it("sends no request for a copy made while the window is hidden", async () => {
    provider.reset();
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
    await browser.keys("Escape");
    await browser.waitUntil(() => !inspectWindows(appExe, "sidelingo")[0].visible, {
      timeoutMsg: "the Pin window is still visible",
    });

    writeClipboardText(words());
    // Well past the listener's 200 ms coalescing.
    await browser.pause(1000);
    expect(provider.requests).toHaveLength(0);
  });

  it("wraps a long unbroken line instead of scrolling sideways, leaving sideways scrolling to code", async () => {
    // No space or hyphen offers a line break inside the folder name.
    const path = `C:\\Users\\${"a".repeat(120)}${Date.now()}\\file.txt`;
    const code = `run --flag ${"x".repeat(300)}`;
    provider.reset([{ delta: { content: `${path}\n\n\`\`\`\n${code}\n\`\`\`` } }]);
    writeClipboardText(path);
    await relaunch({ settings: customSettings(provider) });
    await expect(paragraph()).toHaveText(path);

    const viewport = (await $("body").getSize()).width;
    const overflows = async (element: ChainablePromiseElement) =>
      Number(await element.getProperty("scrollWidth")) > Number(await element.getProperty("clientWidth"));
    expect(await overflows(paragraph())).toBe(false);
    const block = $("pre");
    await expect(block).toHaveText(code, { containing: true });
    expect(await overflows(block)).toBe(true);
    const [at, size] = await Promise.all([block.getLocation(), block.getSize()]);
    expect(at.x + size.width).toBeLessThanOrEqual(viewport);
  });

  it("keeps the scroll position while text streams in", async () => {
    const first = words(300, "first");
    const second = words(300, "second");
    const held = gate();
    provider.reset([{ delta: { content: first } }, held, { delta: { content: ` ${second}` } }]);
    writeClipboardText(words());
    await relaunch({ settings: customSettings(provider) });
    await expect(paragraph()).toHaveText(first);

    // Over the window's middle, since the paragraph's own middle lies below it.
    await browser.action("wheel").scroll({ x: 100, y: 120, deltaY: 2000 }).perform();
    const top = async () => (await paragraph().getLocation()).y;
    await browser.waitUntil(async () => (await top()) < 0, { timeoutMsg: "the content didn't scroll" });
    const scrolled = await top();

    held.open();
    await expect(paragraph()).toHaveText(`${first} ${second}`);
    expect(await top()).toBe(scrolled);
  });
});
