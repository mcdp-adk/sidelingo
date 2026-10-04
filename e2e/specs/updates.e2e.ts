import { relaunch } from "../support/app";
import { clearClipboard } from "../support/clipboard";
import { StalledProxy } from "../support/proxy";
import { openSettings } from "../support/settings";

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
});
