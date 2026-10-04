import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appExe, capabilities, dataFolders, identifier, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { psString, runPowerShell } from "../powershell";
import { customSettings, FakeProvider } from "../provider";
import { openSettings } from "../settings";
import { inspectWindows, monitorBounds, setWindowBounds, windowBounds } from "../window";

const runKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const approvalKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

function registration(): string | null {
  return JSON.parse(
    runPowerShell(`
$key = Get-Item -LiteralPath ${psString(runKey)}
ConvertTo-Json -InputObject @{ value = $key.GetValue(${psString(identifier)}, $null) } -Compress
`),
  ).value;
}

function removeRegistration() {
  runPowerShell(
    `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run', $true)
try { if ($key) { $key.DeleteValue(${psString(identifier)}, $false) } } finally { if ($key) { $key.Dispose() } }`,
  );
}

describe("Autostart and Pin window state", () => {
  let previous: string | null = null;
  let previousApproval: number[] | null = null;
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
    previous = registration();
    previousApproval = JSON.parse(
      runPowerShell(`
$key = Get-Item -LiteralPath ${psString(approvalKey)} -ErrorAction SilentlyContinue
$value = if ($key) { $key.GetValue(${psString(identifier)}, $null) } else { $null }
ConvertTo-Json -InputObject @{ value = $value } -Compress
`),
    ).value;
    removeRegistration();
  });
  after(async () => {
    removeRegistration();
    runPowerShell(`$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', $true)
try { if ($key) { $key.DeleteValue(${psString(identifier)}, $false) } } finally { if ($key) { $key.Dispose() } }`);
    if (previousApproval !== null) {
      runPowerShell(
        `Set-ItemProperty -LiteralPath ${psString(approvalKey)} -Name ${psString(identifier)} -Value ([byte[]]@(${previousApproval.join(",")}))`,
      );
    }
    if (previous !== null) {
      runPowerShell(
        `Set-ItemProperty -LiteralPath ${psString(runKey)} -Name ${psString(identifier)} -Value ${psString(previous)}`,
      );
    }
    await provider.close();
  });

  it("starts Autostart off and reflects OS registration changes after restarting or reopening Settings", async () => {
    clearClipboard();
    removeRegistration();
    await relaunch();
    await openSettings();
    const toggle = () => $("input[role=switch][aria-label='Start at sign-in']");
    await expect(toggle()).toExist();
    await expect(toggle()).toBeEnabled();
    await expect(toggle()).not.toBeChecked();
    await toggle().click();
    await expect(toggle()).toBeChecked();
    await expect(toggle()).toBeEnabled();
    expect(registration()).toBe(`\"${appExe}\" --autostart`);
    await browser.reloadSession(capabilities());
    await openSettings();
    await expect(toggle()).toBeChecked();
    const settings = await browser.getWindowHandle();
    await browser.switchToWindow((await browser.getWindowHandles()).find((handle) => handle !== settings)!);
    removeRegistration();
    await openSettings();
    await expect(toggle()).toBeEnabled();
    await expect(toggle()).not.toBeChecked();
  });

  it("keeps an Autostart-argument launch hidden without sending the clipboard to the Provider", async () => {
    const text = `autostart-input-${Date.now()}`;
    provider.reset();
    writeClipboardText(text);
    await relaunch({ settings: customSettings(provider) });
    await expect($("p")).toHaveText(text);
    expect(provider.requests).toHaveLength(1);

    provider.reset();
    await relaunch({ args: ["--autostart"], settings: customSettings(provider) });
    await expect($("[role=toolbar]")).toExist();
    // Observe beyond clipboard coalescing and the positive control's local HTTP round trip.
    await browser.pause(1000);
    expect(provider.requests).toHaveLength(0);
    expect(inspectWindows(appExe, "sidelingo").map((window) => window.visible)).toEqual([false]);

    // A manual second launch is the production route out of background startup.
    execFileSync(appExe, [], { stdio: "ignore", timeout: 5000 });
    await expect($("p")).toHaveText(text);
    expect(provider.requests).toHaveLength(1);
    expect(inspectWindows(appExe, "sidelingo").map((window) => window.visible)).toEqual([true]);
  });

  it("reopens the Pin window at its last position and size across hides, a restart, and off-screen recovery", async () => {
    clearClipboard();
    await relaunch();
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
    const expected = { x: 120, y: 160, width: 720, height: 480 };
    setWindowBounds(appExe, "sidelingo", expected);
    expect(windowBounds(appExe, "sidelingo")).toEqual([expected]);

    await browser.keys("Escape");
    await browser.waitUntil(() => inspectWindows(appExe, "sidelingo").every((window) => !window.visible));
    execFileSync(appExe, [], { stdio: "ignore", timeout: 5000 });
    expect(windowBounds(appExe, "sidelingo")).toEqual([expected]);

    // A real hide owns persistence; the harness never supplies window state.
    await browser.keys("Escape");
    await browser.waitUntil(() => inspectWindows(appExe, "sidelingo").every((window) => !window.visible));
    await browser.reloadSession(capabilities());
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
    expect(windowBounds(appExe, "sidelingo")).toEqual([expected]);

    // Seed only the e2e identifier's AppConfig; the normal application state is untouched.
    await browser.deleteSession();
    const monitors = monitorBounds();
    const primary = monitors.find((monitor) => monitor.primary);
    expect(primary).toBeDefined();
    const x = Math.max(...monitors.map((monitor) => monitor.x + monitor.width)) + 1000;
    const y = Math.max(...monitors.map((monitor) => monitor.y + monitor.height)) + 1000;
    const offscreen = { x, y, width: 720, height: 480 };
    expect(
      monitors.every(
        (monitor) =>
          offscreen.x + offscreen.width <= monitor.x ||
          offscreen.x >= monitor.x + monitor.width ||
          offscreen.y + offscreen.height <= monitor.y ||
          offscreen.y >= monitor.y + monitor.height,
      ),
    ).toBe(true);
    const statePath = join(dataFolders(identifier).roaming, ".window-state.json");
    const savedState = JSON.parse(readFileSync(statePath, "utf8")) as {
      pin: { x: number; y: number; prev_x: number; prev_y: number };
      [label: string]: unknown;
    };
    savedState.pin.x = offscreen.x;
    savedState.pin.y = offscreen.y;
    savedState.pin.prev_x = offscreen.x;
    savedState.pin.prev_y = offscreen.y;
    writeFileSync(statePath, JSON.stringify(savedState));
    await browser.reloadSession(capabilities());
    await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
    const restoredWindows = windowBounds(appExe, "sidelingo");
    expect(restoredWindows).toHaveLength(1);
    const [restored] = restoredWindows;
    expect(restored.width).toBe(expected.width);
    expect(restored.height).toBe(expected.height);
    expect(restored.x + restored.width).toBeGreaterThan(primary!.x);
    expect(restored.x).toBeLessThan(primary!.x + primary!.width);
    expect(restored.y + restored.height).toBeGreaterThan(primary!.y);
    expect(restored.y).toBeLessThan(primary!.y + primary!.height);
  });
});
