import { capabilities, relaunch } from "../support/app";
import { clearClipboard } from "../support/clipboard";
import { basicAuthorization, HttpProxy, SocksProxy } from "../support/proxy";
import { chooseOption } from "../support/dropdown";
import { openSettings, replaceTextField } from "../support/settings";
import { FakeUpdateEndpoint } from "../support/updates";

// Queried afresh each time, so they still find the page after a restart.
const checkNow = () => $("button=Check now");
const checkFailure = () => $("div*=Could not check for updates");
const upToDate = () => $("p=Up to date");
const automaticChecks = () => $("aria/Automatically check for updates");

async function clickCheckNow(): Promise<void> {
  await checkNow().scrollIntoView();
  await checkNow().click();
}

describe("Task 12: update checks", () => {
  it("checks through the launch proxy, shows Check now's result or failure through a Manual proxy, and keeps automatic checks off after a restart", async function () {
    this.timeout(90_000);
    const stamp = Date.now();
    // Entered as typed: a literal percent sequence must reach the proxy undecoded.
    const credentials = { username: "updater%2Fuser+@example", password: `percent%41%2F@:/?+#${stamp}` };
    const updates = await FakeUpdateEndpoint.start();
    const system = await HttpProxy.start({ username: "system-user", password: `system-secret-${stamp}` });
    const manual = await HttpProxy.start(credentials);
    const socks = await SocksProxy.start(credentials);
    try {
      clearClipboard();
      await relaunch({
        environment: {
          HTTP_PROXY: system.url.replace("://", `://system-user:system-secret-${stamp}@`),
          HTTPS_PROXY: null,
          ALL_PROXY: null,
          NO_PROXY: "unrelated.invalid",
        },
      });
      // A fresh install checks once at startup, through the System proxy.
      // (Counted at the proxies: the spec's first launch, before this one, may have checked the endpoint directly.)
      await browser.waitUntil(
        () => system.requests.some(({ method, url }) => method === "GET" && url === updates.url),
        {
          timeoutMsg: "no startup check came through the launch proxy",
        },
      );

      // A Manual proxy that refuses the check: Check now says why it failed.
      await openSettings();
      await chooseOption("Proxy mode", "Manual");
      await replaceTextField("Proxy URL", manual.url);
      await browser.keys("Enter");
      await clickCheckNow();
      await expect(checkFailure()).toBeDisplayed();
      await expect(checkFailure()).toHaveText(/^Could not check for updates\s*\S/);
      expect(manual.requests).toHaveLength(1);

      // With its credentials, the check gets through and shows its result.
      await replaceTextField("Proxy username", credentials.username);
      await browser.keys("Enter");
      await replaceTextField("Proxy password", credentials.password);
      await browser.keys("Enter");
      await clickCheckNow();
      await browser.waitUntil(() => manual.requests.length === 2, { timeoutMsg: "no second check reached the proxy" });
      await expect(checkNow()).toBeEnabled();
      await expect(checkFailure()).not.toExist();
      await expect(upToDate()).toBeDisplayed();
      expect(manual.requests.at(-1)).toMatchObject({
        url: updates.url,
        headers: { "proxy-authorization": basicAuthorization(credentials) },
      });

      // A Manual SOCKS5 proxy carries it too.
      await replaceTextField("Proxy URL", socks.url);
      await browser.keys("Enter");
      await clickCheckNow();
      await browser.waitUntil(() => socks.connections.length === 1, { timeoutMsg: "no check through SOCKS5" });
      await expect(checkNow()).toBeEnabled();
      await expect(upToDate()).toBeDisplayed();
      await expect(checkFailure()).not.toExist();
      expect(socks.connections.at(-1)).toMatchObject(credentials);

      // Automatic checks stay off after a restart, and Check now still checks.
      await automaticChecks().scrollIntoView();
      await automaticChecks().click();
      await expect(automaticChecks()).not.toBeChecked();
      clearClipboard();
      await browser.reloadSession(capabilities());
      await openSettings();
      await automaticChecks().scrollIntoView();
      await expect(automaticChecks()).not.toBeChecked();
      // A startup check through the local proxy would land while the user reads the switch.
      await browser.pause(2_000);
      expect(socks.connections).toHaveLength(1);
      await clickCheckNow();
      await browser.waitUntil(() => socks.connections.length === 2, { timeoutMsg: "Check now made no request" });
      await expect(checkNow()).toBeEnabled();
      await expect(upToDate()).toBeDisplayed();
      expect(socks.connections.at(-1)).toMatchObject(credentials);
    } finally {
      await Promise.all([updates.close(), system.close(), manual.close(), socks.close()]);
    }
  });
});
