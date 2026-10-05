import { dataFolderLeaks, relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { FakeProvider, gate, keepingText } from "../support/provider";
import { basicAuthorization, HttpProxy, SocksProxy, StalledProxy } from "../support/proxy";
import { chooseOption, expectChosen } from "../support/dropdown";
import { replaceTextField, setUpCustomProvider } from "../support/settings";

describe("Task 9: Provider traffic goes through the chosen proxy", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("follows the launch proxy environment, then a Manual HTTP and SOCKS5 proxy, and gives up on an unreachable one", async function () {
    // Two waits are real: about 10 s for the unreachable proxy, then an 11 s stream.
    this.timeout(120_000);
    const stamp = Date.now();
    const credentials = { username: "proxy-user", password: `proxy-secret-${stamp}` };
    const system = await HttpProxy.start({ username: "system-user", password: `system-secret-${stamp}` });
    const manual = await HttpProxy.start(credentials);
    const socks = await SocksProxy.start(credentials);
    const stalled = await StalledProxy.start();
    const held = gate();
    let release: ReturnType<typeof setTimeout> | undefined;
    try {
      provider.reset();
      provider.models({ ids: ["through-system"] });
      clearClipboard();
      await relaunch({
        environment: {
          HTTP_PROXY: system.url.replace("://", `://system-user:system-secret-${stamp}@`),
          HTTPS_PROXY: null,
          ALL_PROXY: null,
          // A bypass list that leaves the local Provider behind the proxy.
          NO_PROXY: "unrelated.invalid",
        },
      });

      // System mode, the default, follows the proxy environment present at launch.
      const { pin, settings } = await setUpCustomProvider(provider.baseUrl);
      await browser.switchToWindow(settings);
      await expectChosen("Proxy mode", "System");
      await $("aria/Model").click();
      await expect($("aria/through-system")).toBeDisplayed();
      await browser.keys("Escape");
      expect(system.requests).toContainEqual(
        expect.objectContaining({ method: "GET", url: `${provider.baseUrl}/models` }),
      );
      await browser.switchToWindow(pin);
      const first = `Through the launch proxy ${stamp}`;
      writeClipboardText(first);
      await expect($("p")).toHaveText(first);
      const systemChat = system.requests.find(({ method }) => method === "POST")!;
      expect(systemChat.url).toBe(`${provider.baseUrl}/chat/completions`);
      expect(systemChat.headers["proxy-authorization"]).toBe(
        basicAuthorization({ username: "system-user", password: `system-secret-${stamp}` }),
      );
      expect(provider.requests.at(-1)!.headers).not.toHaveProperty("proxy-authorization");

      // A Manual HTTP proxy with credentials carries the model list and the Round.
      provider.models({ ids: ["through-manual-http"] });
      await browser.switchToWindow(settings);
      await chooseOption("Proxy mode", "Manual");
      await replaceTextField("Proxy URL", manual.url);
      await browser.keys("Enter");
      await replaceTextField("Proxy username", credentials.username);
      await browser.keys("Enter");
      await replaceTextField("Proxy password", credentials.password);
      await browser.keys("Enter");
      await $("aria/Model").click();
      await expect($("aria/through-manual-http")).toBeDisplayed();
      await browser.keys("Escape");
      await browser.switchToWindow(pin);
      const second = `Through the Manual HTTP proxy ${stamp}`;
      writeClipboardText(second);
      await expect($("p")).toHaveText(second);
      const manualChat = manual.requests.find(({ method }) => method === "POST")!;
      expect(manualChat.url).toBe(`${provider.baseUrl}/chat/completions`);
      expect(manualChat.headers["proxy-authorization"]).toBe(basicAuthorization(credentials));
      expect(dataFolderLeaks({ "the proxy password": credentials.password })).toEqual([]);

      // So does a SOCKS5 proxy, with the same credentials.
      provider.models({ ids: ["through-socks"] });
      await browser.switchToWindow(settings);
      await replaceTextField("Proxy URL", socks.url);
      await browser.keys("Enter");
      await $("aria/Model").click();
      await expect($("aria/through-socks")).toBeDisplayed();
      await browser.keys("Escape");
      await browser.switchToWindow(pin);
      const roundsBefore = provider.requests.length;
      const third = `Through the SOCKS5 proxy ${stamp}`;
      writeClipboardText(third);
      await expect($("p")).toHaveText(third);
      // Structuring, then Translation.
      expect(provider.requests).toHaveLength(roundsBefore + 2);
      const endpoint = { host: "127.0.0.1", port: Number(new URL(provider.baseUrl).port) };
      // At least the model list and the Round.
      expect(socks.connections.length).toBeGreaterThanOrEqual(2);
      for (const connection of socks.connections) expect(connection).toEqual({ ...credentials, ...endpoint });

      // An unreachable proxy fails the model list in about 10 seconds.
      await browser.switchToWindow(settings);
      const modelRequestsBefore = provider.modelRequests.length;
      await replaceTextField("Proxy URL", stalled.url);
      await browser.keys("Enter");
      await browser.waitUntil(() => stalled.connectedAt !== null);
      const failure = $("div*=Can't fetch the model list: ");
      await failure.waitForDisplayed({ timeout: 15_000 });
      const elapsed = Date.now() - stalled.connectedAt!;
      expect(elapsed).toBeGreaterThanOrEqual(9_000);
      expect(elapsed).toBeLessThan(13_000);
      expect(provider.modelRequests).toHaveLength(modelRequestsBefore);

      // Back in System mode the list comes again, and a stream longer than that limit still finishes.
      provider.models({ ids: ["after-mode-change"] });
      await chooseOption("Proxy mode", "System");
      await $("aria/Model").click();
      await expect($("aria/after-mode-change")).toBeDisplayed();
      await expect(failure).not.toExist();
      await browser.keys("Escape");
      let streamingAt = 0;
      provider.reset(
        keepingText([
          { delta: { content: "slow-start" } },
          {
            wait: held.wait,
            onReached: () => {
              streamingAt = Date.now();
              release = setTimeout(() => held.open(), 11_000);
            },
          },
          { delta: { content: "-finished" } },
        ]),
      );
      await browser.switchToWindow(pin);
      writeClipboardText(`A slow stream ${stamp}`);
      await expect($("p")).toHaveText("slow-start");
      await expect($("p")).toHaveText("slow-start-finished", { wait: 15_000 });
      expect(Date.now() - streamingAt).toBeGreaterThanOrEqual(11_000);
      expect(provider.requests).toHaveLength(2);
    } finally {
      clearTimeout(release);
      held.open();
      await Promise.all([system.close(), manual.close(), socks.close(), stalled.close()]);
    }
  });
});
