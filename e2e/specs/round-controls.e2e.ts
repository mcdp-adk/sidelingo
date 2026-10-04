import { relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider, gate } from "../support/provider";

describe("Round controls", () => {
  let provider: FakeProvider;

  before(async () => {
    provider = await FakeProvider.start();
  });

  after(async () => {
    await provider.close();
  });

  for (const [shortcut, keys] of [
    ["Ctrl+R", ["Control", "r"]],
    ["F5", ["F5"]],
  ] as const) {
    it(`cancels streaming Structuring with ${shortcut} and reruns the retained Input through Translation`, async () => {
      const input = `Retained shortcut Input ${Date.now()}\ncontinues`;
      const partial = `Old partial Source ${Date.now()}`;
      const source = `Regenerated whole Source ${Date.now()}`;
      const translation = `Regenerated whole Translation ${Date.now()}`;
      const held = gate();
      provider.reset(({ body }) =>
        Array.isArray(body.messages[1].content)
          ? provider.requests.length === 1
            ? [
                { delta: { content: partial } },
                { keepAliveUntil: held.wait },
                { delta: { content: " obsolete shortcut suffix" } },
              ]
            : [{ delta: { content: source } }]
          : [{ delta: { content: translation } }],
      );
      clearClipboard();
      await relaunch({ settings: customSettings(provider) });
      try {
        writeClipboardText(input);
        await expect($("body")).toHaveText(partial, { containing: true });
        await expect($("button[aria-label='Copy translation']")).toBeDisabled();
        const obsolete = provider.requests[0];
        // Regenerate uses the Session's Input, even when nothing usable remains in the clipboard.
        clearClipboard();
        await browser.keys([...keys]);
        await browser.waitUntil(() => provider.interruptedRequests.includes(obsolete), {
          timeout: 5_000,
          timeoutMsg: `${shortcut} left the obsolete Structuring HTTP response open at the Provider`,
        });
        await expect($("body")).toHaveText(translation, { containing: true });
        await $("button[aria-label='Copy translation']").waitForEnabled();
        expect(provider.requests).toHaveLength(3);
        expect(provider.requests[1].body.messages[1].content).toEqual([{ type: "text", text: input }]);
        expect(provider.requests[2].body.messages[1].content).toContain(source);
        held.open();
        await browser.pause(350);
        await expect($("body")).toHaveText(translation, { containing: true });
        await expect($("body")).not.toHaveText("obsolete shortcut suffix", { containing: true });
        expect(provider.requests).toHaveLength(3);
      } finally {
        held.open();
      }
    });
  }
});
