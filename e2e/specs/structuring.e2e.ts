import { relaunch } from "../app";
import { writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";

const status = (text: string) => $(`//*[normalize-space(text())="${text}"]`);
const words = (prefix: string) => `${prefix}-${Date.now()}`;

describe("Structuring multi-line text", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  it("streams Source under a status, then translates the complete Source in one request", async () => {
    const copied = `A wrapped line ${Date.now()}\ncontinues here`;
    const sourcePart = `## Clean ${Date.now()}`;
    const source = `${sourcePart}\nwith the rest`;
    const translated = `译文-${Date.now()}`;
    const structuringGate = gate();
    const translationGate = gate();
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content)
        ? [
            { delta: { content: sourcePart } },
            { wait: structuringGate.wait },
            { delta: { content: "\nwith the rest" } },
          ]
        : [{ wait: translationGate.wait }, { delta: { content: translated } }],
    );
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });

    await expect(status("Structuring…")).toBeDisplayed();
    await expect($("h2")).toHaveText(sourcePart.slice(3));
    const sourceColor = await $("h2").getCSSProperty("color");
    const statusColor = await status("Structuring…").getCSSProperty("color");
    expect(sourceColor.value).not.toBe(statusColor.value);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.messages[1].content).toEqual([{ type: "text", text: copied }]);
    expect(provider.requests[0].body.messages[0].content).toContain("hard-wrapped");
    await expect($("body")).not.toHaveText(translated, { containing: true });

    structuringGate.open();
    await expect($("h2")).toHaveText(sourcePart.slice(3));
    await expect($("body")).toHaveText("with the rest", { containing: true });
    await expect(status("Translating…")).toBeDisplayed();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(source);

    translationGate.open();
    await expect($("body")).toHaveText(translated, { containing: true });
    await expect($("body")).not.toHaveText(sourcePart.slice(3), { containing: true });
    expect(provider.requests).toHaveLength(2);
  });

  it("removes reasoning prefixes from Structuring and Translation", async () => {
    const copied = `First line ${Date.now()}\nsecond line`;
    const source = `## ${words("Source")}`;
    const translated = words("Translated");
    const structuringGate = gate();
    const translationGate = gate();
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content)
        ? [
            { delta: { content: `<think>private structure</th` } },
            { wait: structuringGate.wait, onReached: structuringGate.signalReached },
            { delta: { content: `ink>${source}` } },
          ]
        : [
            { delta: { content: `<think>private translation</th` } },
            { wait: translationGate.wait, onReached: translationGate.signalReached },
            { delta: { content: `ink>${translated}` } },
          ],
    );
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });

    await structuringGate.reached;
    await browser.pause(100);
    await expect($("body")).not.toHaveText(/private structure|<think>|<\/think>/);
    structuringGate.open();

    await translationGate.reached;
    await browser.pause(100);
    await expect($("body")).not.toHaveText(/private translation|<think>|<\/think>/);
    translationGate.open();

    await expect($("body")).toHaveText(translated, { containing: true });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].body.messages[1].content).toContain(source);
    expect(provider.requests[1].body.messages[1].content).not.toContain("private structure");
    await expect($("body")).not.toHaveText(/private structure|private translation|<think>|<\/think>/);
  });

  it("shows the Translation status immediately for a single line", async () => {
    const copied = `Single line ${Date.now()}`;
    const translated = words("Translated");
    const held = gate();
    provider.reset([{ wait: held.wait }, { delta: { content: translated } }]);
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });

    await expect(status("Translating…")).toBeDisplayed();
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.messages[1].content).toContain(copied);
    held.open();
    await expect($("body")).toHaveText(translated, { containing: true });
  });

  it("renders GFM, CJK punctuation, and formulas as plain text", async () => {
    const copied = `Markdown input ${Date.now()}\ncontinued`;
    const markdown = `# 标题\n\n- 第一项\n- 第二项\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n\`\`\`text\nconst answer = 42;\n\`\`\`\n\n**强调**，以及[链接](https://example.com)。\n\n$E = mc^2$`;
    provider.reset([{ delta: { content: markdown } }]);
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });

    await expect($("h1")).toHaveText("标题");
    await expect($$("ul li")).toBeElementsArrayOfSize(2);
    await expect($$("table th")).toBeElementsArrayOfSize(2);
    await expect($$("table td")).toBeElementsArrayOfSize(2);
    await expect($("pre code")).toHaveText("const answer = 42;");
    const emphasis = $("//*[normalize-space(text())='强调']");
    await expect(emphasis).toHaveText("强调");
    expect(Number.parseInt((await emphasis.getCSSProperty("font-weight")).value ?? "0", 10)).toBeGreaterThanOrEqual(
      600,
    );
    const link = $("//button[normalize-space(.)='链接']");
    await expect(link).toBeDisplayed();
    expect((await link.getCSSProperty("text-decoration-line")).value).toContain("underline");
    expect(await $("body").getText()).toContain("强调，以及链接。");
    expect(await $("body").getText()).toContain("$E = mc^2$");
    expect(provider.requests).toHaveLength(2);
  });
});
