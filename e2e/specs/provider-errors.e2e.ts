import { relaunch } from "../app";
import { readClipboardText, writeClipboardBitmap, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate, type Step } from "../provider";

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

  it("shows a Structuring HTTP error and does not start Translation", async () => {
    const locales = [
      { language: "en-US", stage: "Structuring failed", category: "Provider HTTP error", status: "429" },
      { language: "zh-CN", stage: "整理失败", category: "服务商 HTTP 错误", status: "429" },
    ];
    for (const locale of locales) {
      const copied = `Wrapped line ${Date.now()}\ncontinues here`;
      const detail = `Synthetic Provider detail ${Date.now()}\n  indented  continuation`;
      provider.reset({ status: 429, message: detail });
      writeClipboardText(copied);
      await relaunch({ language: locale.language, settings: customSettings(provider) });

      await browser.waitUntil(() => provider.requests.length > 0, {
        timeoutMsg: "the multiline Input did not reach the fake Provider",
      });
      expect(provider.requests).toHaveLength(1);
      expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(true);

      await expect($("body")).toHaveText(detail, { containing: true });
      const visible = await $("body").getText();
      expect(visible).toContain(locale.stage);
      expect(visible).toContain(locale.category);
      expect(visible).toContain(locale.status);
      expect(visible).toContain(detail);
      expect(provider.requests).toHaveLength(1);
    }
  });

  it("shows an image hint when a 400 rejects an image Input", async () => {
    const detail = `Synthetic image rejection ${Date.now()}`;
    provider.reset({ status: 400, message: detail });
    writeClipboardBitmap(2, 2);
    await relaunch({ settings: customSettings(provider) });

    await browser.waitUntil(() => provider.requests.length > 0, {
      timeoutMsg: "the bitmap Input did not reach the fake Provider",
    });
    expect(provider.requests).toHaveLength(1);
    const request = provider.requests[0];
    expect(request.method).toBe("POST");
    expect(Array.isArray(request.body.messages[1].content)).toBe(true);
    expect(request.body.messages[1].content.some((part: { type?: string }) => part.type === "image_url")).toBe(true);

    await expect($("body")).toHaveText(detail, { containing: true });
    const visible = await $("body").getText();
    expect(visible).toMatch(/Structuring failed/);
    expect(visible).toMatch(/Provider HTTP error 400/);
    expect(visible).toContain(detail);
    expect(provider.requests).toHaveLength(1);
    expect(visible).toContain("the model may not support images");
  });

  it("keeps an image hint when Translation returns HTTP 400", async () => {
    const source = `Source extracted from bitmap ${Date.now()}`;
    const detail = `Synthetic image Translation rejection ${Date.now()}`;
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content) ? [{ delta: { content: source } }] : { status: 400, message: detail },
    );
    writeClipboardBitmap(2, 2);
    await relaunch({ settings: { ...customSettings(provider), displayMode: "both" } });

    await browser.waitUntil(() => provider.requests.length >= 2, {
      timeoutMsg: "the completed image Structuring request did not reach Translation",
    });
    expect(provider.requests).toHaveLength(2);
    expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(true);
    expect(
      provider.requests[0].body.messages[1].content.some((part: { type?: string }) => part.type === "image_url"),
    ).toBe(true);
    expect(provider.requests[1].body.messages[1].content).toContain(source);

    const sourcePane = $("[role=region][aria-label='Source']");
    await expect(sourcePane).toHaveText(source, { containing: true });
    await expect($("button[aria-label='Copy source']")).toBeEnabled();
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();

    const translationPane = $("[role=region][aria-label='Translation']");
    await expect(translationPane).toHaveText(detail, { containing: true });
    const visible = await translationPane.getText();
    expect(visible).toMatch(/Translation failed/);
    expect(visible).toMatch(/Provider HTTP error 400/);
    expect(visible).toContain(detail);
    expect(provider.requests).toHaveLength(2);
    expect(visible).toContain("the model may not support images");
  });

  it("shows an effort hint when a 400 rejects a non-Default request", async () => {
    const copied = `Single-line Input ${Date.now()}`;
    const detail = `Synthetic effort rejection ${Date.now()}`;
    const defaults = customSettings(provider);
    const settings = {
      ...defaults,
      presets: {
        ...defaults.presets,
        custom: { ...defaults.presets.custom, reasoningEffort: "low" },
      },
    };
    provider.reset({ status: 400, message: detail });
    writeClipboardText(copied);
    await relaunch({ settings });

    await browser.waitUntil(() => provider.requests.length > 0, {
      timeoutMsg: "the single-line Input did not reach the fake Provider",
    });
    expect(provider.requests).toHaveLength(1);
    expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(false);
    expect(provider.requests[0].body.reasoning_effort).toBe("low");

    await expect($("body")).toHaveText(detail, { containing: true });
    const visible = await $("body").getText();
    expect(visible).toMatch(/Translation failed/);
    expect(visible).toMatch(/Provider HTTP error 400/);
    expect(visible).toContain(detail);
    expect(provider.requests).toHaveLength(1);
    expect(visible).toContain("the model may not support this reasoning effort; try Default");
  });

  it("shows neither 400 hint for a text Input at Default", async () => {
    const copied = `Single-line Default Input ${Date.now()}`;
    const detail = `Synthetic Default rejection ${Date.now()}`;
    provider.reset({ status: 400, message: detail });
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });

    await browser.waitUntil(() => provider.requests.length > 0, {
      timeoutMsg: "the Default Input did not reach the fake Provider",
    });
    expect(provider.requests).toHaveLength(1);
    expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(false);

    await expect($("body")).toHaveText(detail, { containing: true });
    const visible = await $("body").getText();
    expect(visible).toMatch(/Translation failed/);
    expect(visible).toMatch(/Provider HTTP error 400/);
    expect(visible).toContain(detail);
    expect(visible).not.toContain("the model may not support images");
    expect(visible).not.toContain("the model may not support this reasoning effort; try Default");
    expect(provider.requests).toHaveLength(1);
  });

  it("shows both 400 hints in the UI language when both contexts apply", async () => {
    const detail = `Synthetic combined rejection ${Date.now()}`;
    const defaults = customSettings(provider);
    const settings = {
      ...defaults,
      presets: {
        ...defaults.presets,
        custom: { ...defaults.presets.custom, reasoningEffort: "low" },
      },
    };
    provider.reset({ status: 400, message: detail });
    writeClipboardBitmap(2, 2);
    await relaunch({ language: "zh-CN", settings });

    await browser.waitUntil(() => provider.requests.length > 0, {
      timeoutMsg: "the image Input with non-Default effort did not reach the fake Provider",
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body.reasoning_effort).toBe("low");
    expect(
      provider.requests[0].body.messages[1].content.some((part: { type?: string }) => part.type === "image_url"),
    ).toBe(true);

    await expect($("body")).toHaveText(detail, { containing: true });
    const visible = await $("body").getText();
    expect(visible).toContain("整理失败");
    expect(visible).toContain("服务商 HTTP 错误 400");
    expect(visible).toContain(detail);
    expect(visible).toContain("模型可能不支持图像");
    expect(visible).toContain("模型可能不支持当前推理强度；请尝试“默认”");
    expect(visible).not.toContain("the model may not support images");
    expect(visible).not.toContain("the model may not support this reasoning effort; try Default");
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

  it("offers Open settings for HTTP 403 and 404 but not 500", async () => {
    for (const scenario of [
      { status: 403, shouldOfferSettings: true },
      { status: 404, shouldOfferSettings: true },
      { status: 500, shouldOfferSettings: false },
    ]) {
      const copied = `Single-line HTTP ${scenario.status} failure ${Date.now()}`;
      const detail = `Synthetic HTTP ${scenario.status} failure ${Date.now()}`;
      provider.reset({ status: scenario.status, message: detail });
      writeClipboardText(copied);
      await relaunch({ settings: customSettings(provider) });

      await browser.waitUntil(() => provider.requests.length > 0, {
        timeoutMsg: `the HTTP ${scenario.status} Input did not reach the fake Provider`,
      });
      expect(provider.requests).toHaveLength(1);
      await expect($("body")).toHaveText(detail, { containing: true });
      const visible = await $("body").getText();
      expect(visible).toMatch(/Translation failed/);
      expect(visible).toMatch(new RegExp(`Provider HTTP error ${scenario.status}`));
      expect(visible).toContain(detail);
      expect(provider.requests).toHaveLength(1);

      const openSettings = $("[role=group]").$(`button=Open settings`);
      if (scenario.shouldOfferSettings) await expect(openSettings).toBeDisplayed();
      else await expect(openSettings).not.toExist();
    }
  });

  it("keeps the completed Source when Translation returns an HTTP error", async () => {
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    const source = `## Retained Source ${Date.now()}`;
    const detail = `Synthetic Translation detail ${Date.now()}`;
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content) ? [{ delta: { content: source } }] : { status: 429, message: detail },
    );
    writeClipboardText(copied);
    await relaunch({ settings: { ...customSettings(provider), displayMode: "both" } });

    await browser.waitUntil(() => provider.requests.length >= 2, {
      timeoutMsg: "the completed Source did not reach the Translation request",
    });
    expect(provider.requests).toHaveLength(2);
    expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(true);
    expect(Array.isArray(provider.requests[1].body.messages[1].content)).toBe(false);
    expect(provider.requests[1].body.messages[1].content).toContain(source);
    await expect($("[role=region][aria-label='Source']")).toHaveText(source.slice(3), { containing: true });
    await expect($("button[aria-label='Copy source']")).toBeEnabled();
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();

    try {
      const pane = $("[role=region][aria-label='Translation']");
      await expect(pane).toHaveText(detail, { containing: true });
      const visible = await pane.getText();
      expect(visible).toMatch(/Translation failed|翻译失败/);
      expect(visible).toMatch(/Provider HTTP error 429|服务商 HTTP 错误 429/);
      expect(visible).toContain(detail);

      await browser.keys(["Control", "1"]);
      const sourcePane = $("[role=region][aria-label='Source']");
      await expect(sourcePane).toHaveText(source.slice(3), { containing: true });
      await expect($("body")).not.toHaveText(detail, { containing: true });
      await expect($("button[aria-label='Copy source']")).toBeEnabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();

      await browser.keys(["Control", "2"]);
      const translationPane = $("[role=region][aria-label='Translation']");
      await expect(translationPane).toHaveText(detail, { containing: true });
      await browser.waitUntil(async () => /Translation failed|翻译失败/.test(await translationPane.getText()));
      await expect($("button[aria-label='Copy source']")).toBeEnabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();

      await browser.keys(["Control", "3"]);
      await expect(sourcePane).toHaveText(source.slice(3), { containing: true });
      await expect(translationPane).toHaveText(detail, { containing: true });
      await browser.waitUntil(async () => /Translation failed|翻译失败/.test(await translationPane.getText()));
    } finally {
      expect(provider.requests).toHaveLength(2);
    }
  });

  it("shows an SSE Provider error and does not start Translation", async () => {
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    const detail = `Synthetic SSE Provider detail ${Date.now()}`;
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content)
        ? [{ error: { message: detail } }]
        : [{ delta: { content: `Unexpected Translation ${Date.now()}` } }],
    );
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider) });

    await browser.waitUntil(() => provider.requests.length > 0, {
      timeoutMsg: "the multiline Input did not reach the fake Provider",
    });
    expect(provider.requests[0].method).toBe("POST");
    expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(true);

    await browser.waitUntil(
      async () => {
        const current = await $("body").getText();
        return current.includes(detail) || current.includes("Unexpected Translation");
      },
      { timeoutMsg: "neither the SSE error nor an unexpected Translation result became visible" },
    );
    const settled = await $("body").getText();
    expect(provider.requests).toHaveLength(1);
    expect(settled).toMatch(/Structuring failed|整理失败/);
    expect(settled).toMatch(/Provider error|服务商错误/);
    expect(settled).toContain(detail);
  });

  it("keeps partial Source and shows verbatim malformed SSE data as a Provider error", async () => {
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    const partial = `## Partial Source ${Date.now()}`;
    const malformed = `{broken-${Date.now()}`;
    const held = gate();
    provider.reset([{ delta: { content: partial } }, { wait: held.wait }, { rawData: malformed }]);
    writeClipboardText(copied);
    await relaunch({ settings: { ...customSettings(provider), displayMode: "both" } });

    try {
      const sourcePane = $("[role=region][aria-label='Source']");
      await expect(sourcePane).toHaveText(partial.slice(3), { containing: true });
      await expect($("button[aria-label='Copy source']")).toBeDisabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0].body.messages[1].content).toEqual([{ type: "text", text: copied }]);

      held.open();
      await expect(sourcePane).toHaveText("Provider error", { containing: true });
      const visible = await sourcePane.getText();
      expect(visible).toContain("Structuring failed");
      expect(visible).toContain(malformed);
      expect(visible).toContain(partial.slice(3));
      expect(visible.indexOf(partial.slice(3))).toBeLessThan(visible.indexOf("Provider error"));
      await expect($("[role=region][aria-label='Translation']")).toHaveText(malformed, { containing: true });
      await expect($("button[aria-label='Copy source']")).toBeDisabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      expect(provider.requests).toHaveLength(1);
    } finally {
      held.open();
    }
  });

  it("shows an empty Structuring response and does not start Translation", async () => {
    const thought = `private reasoning ${Date.now()}`;
    const scenarios = [
      { name: "empty response", reply: [] as Step[], thought: undefined },
      { name: "hidden reasoning only", reply: [{ delta: { content: `<think>${thought}</think>` } }], thought },
      { name: "HTTP 204", reply: { status: 204, message: "" }, thought: undefined },
    ];

    for (const scenario of scenarios) {
      const copied = `Wrapped line ${Date.now()}\ncontinues here`;
      provider.reset(({ body }) =>
        Array.isArray(body.messages[1].content)
          ? scenario.reply
          : [{ delta: { content: `Unexpected Translation ${scenario.name} ${Date.now()}` } }],
      );
      writeClipboardText(copied);
      await relaunch({ settings: customSettings(provider) });

      await browser.waitUntil(() => provider.requests.length > 0, {
        timeoutMsg: "the multiline Input did not reach the fake Provider",
      });
      expect(provider.requests[0].method).toBe("POST");
      expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(true);

      await browser.waitUntil(
        async () => {
          const visible = await $("body").getText();
          return /Empty response|响应为空/.test(visible) || visible.includes("Unexpected Translation");
        },
        { timeoutMsg: "neither the empty-response message nor an unexpected Translation result became visible" },
      );
      const visible = await $("body").getText();
      expect(provider.requests).toHaveLength(1);
      expect(visible).toMatch(/Structuring failed|整理失败/);
      expect(visible).toMatch(/Empty response|响应为空/);
      await expect($("button[aria-label='Copy source']")).toBeDisabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      if (scenario.thought) expect(visible).not.toContain(scenario.thought);
    }
  });

  it("shows an empty Translation response and keeps the completed Source", async () => {
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    const source = `## Completed Source ${Date.now()}`;
    const response = gate();
    let translationCalls = 0;
    provider.reset(({ body }) => {
      if (Array.isArray(body.messages[1].content)) return [{ delta: { content: source } }];
      translationCalls += 1;
      return translationCalls === 1 ? [{ wait: response.wait, onReached: response.signalReached }] : [];
    });
    writeClipboardText(copied);
    await relaunch({ settings: { ...customSettings(provider), displayMode: "both" } });

    await response.reached;
    expect(provider.requests).toHaveLength(2);
    expect(Array.isArray(provider.requests[0].body.messages[1].content)).toBe(true);
    expect(Array.isArray(provider.requests[1].body.messages[1].content)).toBe(false);
    expect(provider.requests[1].body.messages[1].content).toContain(source);
    await expect($("[role=region][aria-label='Source']")).toHaveText(source.slice(3), { containing: true });
    await expect($("button[aria-label='Copy source']")).toBeEnabled();
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();
    await browser.waitUntil(
      async () => /Translating…|正在翻译/.test(await $("[role=region][aria-label='Translation']").getText()),
      {
        timeoutMsg: "Translation did not enter its visible running state",
      },
    );

    response.open();
    await browser.waitUntil(
      async () => {
        const visible = await $("[role=region][aria-label='Translation']").getText();
        return /Empty response|响应为空/.test(visible) || !/Translating…|正在翻译/.test(visible);
      },
      { timeoutMsg: "the empty Translation stream did not reach a terminal visible state" },
    );
    const visible = await $("[role=region][aria-label='Translation']").getText();
    expect(provider.requests).toHaveLength(2);
    expect(visible).toMatch(/Translation failed|翻译失败/);
    expect(visible).toMatch(/Empty response|响应为空/);
    await expect($("button[aria-label='Copy source']")).toBeEnabled();
    await expect($("button[aria-label='Copy translation']")).toBeDisabled();
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

  it("shows a network error when an HTTP error body drops before completing", async () => {
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    const detail = `Synthetic interrupted HTTP error ${Date.now()}`;
    const held = gate();
    provider.reset(({ body }) =>
      Array.isArray(body.messages[1].content)
        ? {
            status: 429,
            message: detail,
            dropAfterPartialBody: { wait: held.wait, onReached: held.signalReached },
          }
        : [{ delta: { content: "Unexpected Translation after interrupted error body" } }],
    );
    writeClipboardText(copied);
    await relaunch({ settings: { ...customSettings(provider), displayMode: "both" } });

    try {
      await held.reached;
      expect(provider.requests).toHaveLength(1);
      const request = provider.requests[0];
      expect(request.method).toBe("POST");
      expect(request.body.messages[1].content).toEqual([{ type: "text", text: copied }]);
      const sourcePane = $("[role=region][aria-label='Source']");
      await expect(sourcePane).toHaveText("Structuring…", { containing: true });
      await expect($("button[aria-label='Copy source']")).toBeDisabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();

      held.open();
      await browser.waitUntil(() => provider.interruptedRequests.includes(request), {
        timeoutMsg: "the partial HTTP error response did not actually drop",
      });
      await expect(sourcePane).toHaveText("Network error", { containing: true });
      await expect(sourcePane).toHaveText("Structuring failed", { containing: true });
      const translationPane = $("[role=region][aria-label='Translation']");
      await expect(translationPane).toHaveText("Network error", { containing: true });
      await expect($("button[aria-label='Copy source']")).toBeDisabled();
      await expect($("button[aria-label='Copy translation']")).toBeDisabled();
      expect(provider.requests).toHaveLength(1);
    } finally {
      held.open();
    }
  });

  it("shows a network error when the Provider Base URL is a closed local port", async () => {
    const unavailable = await FakeProvider.start();
    const baseUrl = unavailable.baseUrl;
    await unavailable.close();
    const copied = `Wrapped line ${Date.now()}\ncontinues here`;
    provider.reset();
    writeClipboardText(copied);
    await relaunch({ settings: customSettings(provider, { baseUrl }) });

    await browser.waitUntil(async () => /Network error|网络错误/.test(await $("body").getText()), {
      timeoutMsg: "the closed Provider Base URL did not show a network error",
    });
    const visible = await $("body").getText();
    expect(visible).toMatch(/Structuring failed|整理失败/);
    expect(visible).toMatch(/Network error|网络错误/);
    expect(provider.requests).toHaveLength(0);

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
