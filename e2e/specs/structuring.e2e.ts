import { relaunch } from "../app";
import { writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider } from "../provider";

describe("Structuring multi-line text", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
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
