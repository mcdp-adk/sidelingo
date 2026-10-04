import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { capabilities, dataFolders, identifier, relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { customSettings, FakeProvider, gate } from "../support/provider";
import { HttpProxy, SocksProxy, StalledProxy } from "../support/proxy";
import { openSettings, replaceTextField, expectShownOption } from "../support/settings";
import { useLaunchEnvironment } from "../support/driver";

describe("Provider proxy", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("routes model lists and chat through a credentialed HTTP proxy and retains its encrypted password", async () => {
    const proxy = await HttpProxy.start();
    provider.reset();
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    const { pin } = await openSettings();
    try {
      const mode = () => $("select[aria-label='Proxy mode']");
      await expectShownOption(mode(), "System");
      await expect($("input[aria-label='Proxy URL']")).not.toExist();
      provider.models({ ids: ["proxied-model"] });
      await configureManualProxy(proxy.url);
      await expect($("input[aria-label='Proxy password']")).toHaveAttribute("type", "password");
      await $("input[role=combobox][aria-label='Model']").click();
      await expect($("//*[@role='option' and normalize-space(.)='proxied-model']")).toBeDisplayed();
      await browser.keys("Escape");
      await browser.switchToWindow(pin);
      const input = `HTTP proxy input ${Date.now()}`;
      writeClipboardText(input);
      await expect($("p")).toHaveText(input);
      expect(proxy.requests).toContainEqual(
        expect.objectContaining({ method: "GET", url: `${provider.baseUrl}/models` }),
      );
      const chat = proxy.requests.find(({ method }) => method === "POST")!;
      expect(chat.url).toBe(`${provider.baseUrl}/chat/completions`);
      expect(chat.headers["proxy-authorization"]).toBe("Basic cHJveHktdXNlcjpwcm94eS1wYXNzd29yZA==");
      expect(provider.requests[0].headers).not.toHaveProperty("proxy-authorization");
      const text = readFileSync(join(dataFolders(identifier).roaming, "settings.json"), "utf8");
      expect(text).not.toContain("proxy-password");
      expect(JSON.parse(text).proxy.passwordCiphertext).toEqual(expect.any(String));

      provider.reset();
      proxy.requests.length = 0;
      clearClipboard();
      await browser.reloadSession(capabilities());
      const restarted = `HTTP proxy after restart ${Date.now()}`;
      writeClipboardText(restarted);
      await expect($("p")).toHaveText(restarted);
      expect(proxy.requests).toHaveLength(1);
      expect(proxy.requests[0].headers["proxy-authorization"]).toBe("Basic cHJveHktdXNlcjpwcm94eS1wYXNzd29yZA==");
    } finally {
      await proxy.close();
    }
  });

  it("routes model lists and chat through a SOCKS5 proxy with username/password authentication", async () => {
    const proxy = await SocksProxy.start();
    provider.reset();
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    const { pin } = await openSettings();
    try {
      provider.models({ ids: ["socks-model"] });
      await configureManualProxy(proxy.url);
      await $("input[role=combobox][aria-label='Model']").click();
      await expect($("//*[@role='option' and normalize-space(.)='socks-model']")).toBeDisplayed();
      await browser.keys("Escape");
      await browser.switchToWindow(pin);
      const input = `SOCKS proxy input ${Date.now()}`;
      writeClipboardText(input);
      await expect($("p")).toHaveText(input);
      const endpoint = new URL(provider.baseUrl);
      expect(proxy.connections.length).toBeGreaterThanOrEqual(2);
      for (const connection of proxy.connections) {
        expect(connection).toEqual({
          username: "proxy-user",
          password: "proxy-password",
          host: "127.0.0.1",
          port: Number(endpoint.port),
        });
      }
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0].path).toBe("/v1/chat/completions");
    } finally {
      await proxy.close();
    }
  });

  it("uses the proxy environment present at launch in System mode", async () => {
    const proxy = await HttpProxy.start();
    provider.reset();
    provider.models({ ids: ["system-model"] });
    clearClipboard();
    try {
      await relaunch({
        settings: customSettings(provider),
        environment: {
          HTTP_PROXY: proxy.url.replace("://", "://proxy-user:proxy-password@"),
          HTTPS_PROXY: null,
          ALL_PROXY: null,
          // A nonmatching bypass also isolates any Windows manual bypass list without changing it.
          NO_PROXY: "unrelated.invalid",
        },
      });
      const { pin } = await openSettings();
      await expectShownOption($("select[aria-label='Proxy mode']"), "System");
      await expect($("input[aria-label='Proxy URL']")).not.toExist();
      await $("input[role=combobox][aria-label='Model']").click();
      await expect($("//*[@role='option' and normalize-space(.)='system-model']")).toBeDisplayed();
      await browser.keys("Escape");
      await browser.switchToWindow(pin);
      const input = `System proxy input ${Date.now()}`;
      writeClipboardText(input);
      await expect($("p")).toHaveText(input);
      expect(proxy.requests).toContainEqual(
        expect.objectContaining({ method: "GET", url: `${provider.baseUrl}/models` }),
      );
      const chat = proxy.requests.find(({ method }) => method === "POST")!;
      expect(chat.url).toBe(`${provider.baseUrl}/chat/completions`);
      expect(chat.headers["proxy-authorization"]).toBe("Basic cHJveHktdXNlcjpwcm94eS1wYXNzd29yZA==");
    } catch (reason) {
      // Preserve the failing System session before restoring its driver environment.
      const captures = resolve(import.meta.dirname, "..", "failures");
      mkdirSync(captures, { recursive: true });
      try {
        await browser.saveScreenshot(join(captures, "System_proxy_launch_environment.png"));
        writeFileSync(join(captures, "System_proxy_launch_environment.html"), await browser.getPageSource());
      } catch {
        /* Keep the original failure when its session is already unavailable. */
      }
      throw reason;
    } finally {
      try {
        await browser.deleteSession();
        await useLaunchEnvironment();
      } finally {
        await proxy.close();
      }
    }
  });

  it("limits proxy connection setup to about 10 seconds, refreshes after a mode change, and lets a longer stream finish", async () => {
    const proxy = await StalledProxy.start();
    const held = gate();
    let release: ReturnType<typeof setTimeout> | undefined;
    let streamingAt = 0;
    provider.reset();
    clearClipboard();
    try {
      await relaunch({ settings: { ...customSettings(provider), proxy: { mode: "manual", url: proxy.url } } });
      const { pin } = await openSettings();
      await browser.waitUntil(() => proxy.connectedAt !== null);
      const error = $('//*[starts-with(text(),"Can\'t fetch the model list: ")]');
      await error.waitForDisplayed({ timeout: 14_000 });
      const elapsed = Date.now() - proxy.connectedAt!;
      expect(elapsed).toBeGreaterThanOrEqual(9_000);
      expect(elapsed).toBeLessThan(13_000);
      expect(provider.modelRequests).toHaveLength(0);

      provider.models({ ids: ["after-mode-change"] });
      await $("select[aria-label='Proxy mode']").selectByVisibleText("System");
      await expect($("input[aria-label='Proxy URL']")).not.toExist();
      await $("input[role=combobox][aria-label='Model']").click();
      await expect($("//*[@role='option' and normalize-space(.)='after-mode-change']")).toBeDisplayed();
      await expect(error).not.toExist();
      expect(provider.modelRequests).toContainEqual(expect.objectContaining({ method: "GET", path: "/v1/models" }));
      await browser.keys("Escape");

      provider.reset([
        { delta: { content: "slow-start" } },
        {
          wait: held.wait,
          onReached: () => {
            streamingAt = Date.now();
            release = setTimeout(() => held.open(), 11_000);
          },
        },
        { delta: { content: "-finished" } },
      ]);
      await browser.switchToWindow(pin);
      writeClipboardText(`Slow stream ${Date.now()}`);
      await expect($("p")).toHaveText("slow-start");
      await expect($("p")).toHaveText("slow-start-finished", { wait: 14_000 });
      expect(Date.now() - streamingAt).toBeGreaterThanOrEqual(11_000);
      expect(provider.requests).toHaveLength(1);
    } finally {
      clearTimeout(release);
      held.open();
      await proxy.close();
    }
  });
});

async function configureManualProxy(url: string): Promise<void> {
  await $("select[aria-label='Proxy mode']").selectByVisibleText("Manual");
  await replaceTextField("Proxy URL", url);
  await browser.keys("Enter");
  await replaceTextField("Proxy username", "proxy-user");
  await browser.keys("Enter");
  await replaceTextField("Proxy password", "proxy-password");
  await browser.keys("Enter");
}
