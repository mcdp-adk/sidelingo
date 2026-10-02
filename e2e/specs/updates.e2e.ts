import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { capabilities, dataFolders, identifier, relaunch } from "../app";
import { clearClipboard } from "../clipboard";
import { StalledProxy, UpdaterProxy, UpdaterSocksProxy } from "../proxy";
import { openSettings, replaceTextField } from "../settings";
import { useLaunchEnvironment } from "../driver";

describe("Updates", () => {
  it("keeps a failed startup check silent and shows the cause of Check now through an unreachable Manual proxy", async () => {
    const proxy = await StalledProxy.start();
    clearClipboard();
    try {
      await relaunch({
        settings: {
          schemaVersion: 1,
          automaticUpdates: true,
          proxy: { mode: "manual", url: proxy.url.replace("socks5://", "http://") },
        },
      });
      await openSettings();
      const about = $("section[aria-label='About']");
      const check = about.$("button=Check now");
      await expect(check).toExist();
      await check.scrollIntoView();
      await expect(check).toBeDisplayed();
      // The server's closed connection proves an actual startup check failed.
      await browser.waitUntil(() => proxy.closedConnections >= 1, { timeout: 14_000 });
      await expect(check).toBeEnabled();
      await expect(about).not.toHaveText("Could not check for updates", { containing: true });
      await expect(about).not.toHaveText("error sending request", { containing: true });

      const failedStartup = proxy.closedConnections;
      await check.click();
      await browser.waitUntil(() => proxy.closedConnections > failedStartup, { timeout: 14_000 });
      await expect(about).toHaveText("Could not check for updates", { containing: true });
      await expect(about).toHaveText("error sending request", { containing: true });
    } finally {
      await proxy.close();
    }
  });

  it("retains automatic checks off after restart while Check now still makes a request", async () => {
    const proxy = await StalledProxy.start();
    clearClipboard();
    try {
      await relaunch({
        settings: {
          schemaVersion: 1,
          proxy: { mode: "manual", url: proxy.url.replace("socks5://", "http://") },
        },
      });
      await openSettings();
      const automatic = () => $("input[role=switch][aria-label='Automatically check for updates']");
      await expect(automatic()).toExist();
      await automatic().scrollIntoView();
      await expect(automatic()).toBeChecked();
      await automatic().click();
      await expect(automatic()).not.toBeChecked();
      const saved = () => JSON.parse(readFileSync(join(dataFolders(identifier).roaming, "settings.json"), "utf8"));
      await browser.waitUntil(() => saved().automaticUpdates === false);
      // Let the already-started automatic check fail before observing a new launch.
      await browser.waitUntil(() => proxy.closedConnections >= 1, { timeout: 14_000 });
      const beforeRestart = proxy.closedConnections;
      clearClipboard();
      await browser.reloadSession(capabilities());
      await openSettings();
      await automatic().scrollIntoView();
      await expect(automatic()).not.toBeChecked();
      // Longer than the SDK's whole-check timeout: an unwanted startup attempt would close by now.
      await browser.pause(12_000);
      expect(proxy.closedConnections).toBe(beforeRestart);
      const check = $("section[aria-label='About']").$("button=Check now");
      await check.scrollIntoView();
      await expect(check).toBeEnabled();
      await check.click();
      await browser.waitUntil(() => proxy.closedConnections > beforeRestart, { timeout: 14_000 });
      await expect(check).toBeEnabled();
    } finally {
      await proxy.close();
    }
  });

  it("reaches GitHub through an authenticated Manual proxy with literal percent sequences in entered credentials", async () => {
    const username = "updater%2Fuser+@example";
    const password = "percent%41%2F@:/?+#value";
    const proxy = await UpdaterProxy.start(username, password);
    clearClipboard();
    try {
      await relaunch({
        settings: {
          schemaVersion: 1,
          automaticUpdates: false,
          proxy: { mode: "manual", url: proxy.url },
        },
      });
      await openSettings();
      await replaceTextField("Proxy username", username);
      await replaceTextField("Proxy password", password);
      await browser.keys("Enter");
      await browser.waitUntil(() => {
        const saved = JSON.parse(readFileSync(join(dataFolders(identifier).roaming, "settings.json"), "utf8"));
        return Boolean(saved.proxy.passwordCiphertext);
      });
      const check = $("section[aria-label='About']").$("button=Check now");
      await check.scrollIntoView();
      await check.click();
      await browser.waitUntil(() => proxy.attempts.length > 0, { timeout: 14_000 });
      // No raw header, credentials or URL is retained in these receipts.
      expect(proxy.attempts.every((attempt) => attempt.destinationMatches)).toBe(true);
      expect(proxy.attempts.every((attempt) => attempt.authenticated)).toBe(true);
      await browser.waitUntil(() => proxy.upstreamConnected && proxy.upstreamBytesReceived, { timeout: 14_000 });
      await expect(check).toBeEnabled({ wait: 14_000 });
    } finally {
      await proxy.close();
    }
  });

  it("uses the child System proxy environment for startup and manual checks after malformed settings recovery", async () => {
    const proxy = await StalledProxy.start();
    const url = proxy.url.replace("socks5://", "http://");
    let failed = false;
    let failure: unknown;
    clearClipboard();
    try {
      await relaunch({
        settingsText: '{"schemaVersion":',
        environment: {
          HTTP_PROXY: url,
          HTTPS_PROXY: url,
          ALL_PROXY: url,
          NO_PROXY: "127.0.0.1,localhost",
        },
      });
      await openSettings();
      await expect($("select[aria-label='Proxy mode']")).toHaveValue("system");
      const check = $("section[aria-label='About']").$("button=Check now");
      await check.scrollIntoView();
      await browser.waitUntil(() => proxy.closedConnections >= 1, { timeout: 14_000 });
      await expect(check).toBeEnabled();
      const startupRequests = proxy.closedConnections;
      await check.click();
      await browser.waitUntil(() => proxy.closedConnections > startupRequests, { timeout: 14_000 });
      await expect(check).toBeEnabled();
    } catch (reason) {
      failed = true;
      failure = reason;
      const captures = resolve(import.meta.dirname, "..", "failures");
      mkdirSync(captures, { recursive: true });
      try {
        await browser.saveScreenshot(join(captures, "Updater_System_environment.png"));
        writeFileSync(join(captures, "Updater_System_environment.html"), await browser.getPageSource());
      } catch {
        /* Preserve the original failure if its session is already unavailable. */
      }
    } finally {
      for (const cleanup of [() => browser.deleteSession(), () => useLaunchEnvironment(), () => proxy.close()]) {
        try {
          await cleanup();
        } catch (reason) {
          if (!failed) failure = reason;
          failed = true;
        }
      }
    }
    if (failed) throw failure;
  });

  it("reaches GitHub through an authenticated Manual SOCKS5 updater proxy", async () => {
    const username = "socks%2Fuser";
    const password = "socks%41@password";
    const proxy = await UpdaterSocksProxy.start(username, password);
    clearClipboard();
    try {
      await relaunch({
        settings: { schemaVersion: 1, automaticUpdates: false, proxy: { mode: "manual", url: proxy.url } },
      });
      await openSettings();
      await replaceTextField("Proxy username", username);
      await replaceTextField("Proxy password", password);
      await browser.keys("Enter");
      await browser.waitUntil(() => {
        const saved = JSON.parse(readFileSync(join(dataFolders(identifier).roaming, "settings.json"), "utf8"));
        return Boolean(saved.proxy.passwordCiphertext);
      });
      const about = $("section[aria-label='About']");
      const check = about.$("button=Check now");
      await check.scrollIntoView();
      await check.click();
      await browser.waitUntil(
        async () => proxy.connected || (await about.getText()).includes("Could not check for updates"),
        { timeout: 14_000 },
      );
      expect(proxy.connected).toBe(true);
      await browser.waitUntil(() => proxy.upstreamConnected && proxy.upstreamBytesReceived, { timeout: 14_000 });
      expect(proxy.authenticated).toBe(true);
      expect(proxy.destinationMatches).toBe(true);
      await expect(check).toBeEnabled({ wait: 14_000 });
    } finally {
      await proxy.close();
    }
  });
});
