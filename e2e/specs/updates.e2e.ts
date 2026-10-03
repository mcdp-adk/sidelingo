import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { capabilities, dataFolders, identifier, relaunch } from "../app";
import { clearClipboard } from "../clipboard";
import { StalledProxy, UpdaterProxy, UpdaterSocksProxy } from "../proxy";
import { openSettings, replaceTextField } from "../settings";
import { useLaunchEnvironment } from "../driver";

/** Advance only the selected WebView's public clock, waiting for the complete virtual budget. */
async function advanceBrowserTime(budget: number): Promise<void> {
  const before = (await browser.execute(() => ({ date: Date.now(), monotonic: performance.now() }))) as unknown as {
    date: number;
    monotonic: number;
  };
  await browser.sendCommandAndGetResult("Emulation.setVirtualTimePolicy", {
    policy: "advance",
    budget,
    maxVirtualTimeTaskStarvationCount: 100,
  });
  await browser.waitUntil(
    async () => {
      const now = (await browser.execute(() => ({ date: Date.now(), monotonic: performance.now() }))) as unknown as {
        date: number;
        monotonic: number;
      };
      return now.date - before.date >= budget - 1 && now.monotonic - before.monotonic >= budget - 1;
    },
    { timeout: 15_000, interval: 100, timeoutMsg: "The public browser clock did not consume its full virtual budget" },
  );
}

describe("Updates", () => {
  it("schedules silent checks every 24 hours until disabled while Check now still shows its failure cause", async function () {
    this.timeout(90_000);
    const day = 86_400_000;
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
      const { pin, settings } = await openSettings();
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

      const startupConnection = proxy.connectedAt;
      const failedStartup = proxy.closedConnections;
      await browser.switchToWindow(pin);
      await browser.sendCommandAndGetResult("Emulation.setVirtualTimePolicy", { policy: "pause" });
      const elapsed = (await browser.execute(() => performance.now())) as unknown as number;
      // Registration cannot precede this WebView's creation or follow its completed startup check.
      expect(elapsed).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(60_000);
      await advanceBrowserTime(Math.floor(day - elapsed - 1_000));
      // The virtual clock is paused at its budget; allow real IPC/socket work to become observable.
      await browser.pause(1_000);
      expect(proxy.connectedAt).toBe(startupConnection);
      expect(proxy.closedConnections).toBe(failedStartup);

      // Cross a full day beyond the observable control-ready sample, not a guessed registration instant.
      await advanceBrowserTime(Math.ceil(elapsed + 2_000));
      await browser.waitUntil(() => proxy.connectedAt !== startupConnection, {
        timeout: 5_000,
        timeoutMsg: "No scheduled updater request reached the actual proxy after a complete day",
      });
      await browser.waitUntil(() => proxy.closedConnections > failedStartup, { timeout: 14_000 });
      await browser.switchToWindow(settings);
      await expect(check).toBeEnabled();
      await expect(about).not.toHaveText("Could not check for updates", { containing: true });
      await expect(about).not.toHaveText("error sending request", { containing: true });

      const automatic = $("input[role=switch][aria-label='Automatically check for updates']");
      await automatic.scrollIntoView();
      await automatic.click();
      await expect(automatic).not.toBeChecked();
      const lastConnection = proxy.connectedAt;
      const failedAutomatic = proxy.closedConnections;
      await browser.switchToWindow(pin);
      await advanceBrowserTime(day);
      await browser.pause(1_000);
      expect(proxy.connectedAt).toBe(lastConnection);
      expect(proxy.closedConnections).toBe(failedAutomatic);

      await browser.switchToWindow(settings);
      await check.scrollIntoView();
      await check.click();
      await browser.waitUntil(() => proxy.closedConnections > failedAutomatic, { timeout: 14_000 });
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
