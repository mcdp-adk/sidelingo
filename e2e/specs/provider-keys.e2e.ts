import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { dataFolders, identifier, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider } from "../provider";
import { openSettings, replaceTextField } from "../settings";

describe("Provider keys", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("protects an entered Custom key for the Windows user and uses it after restarting", async () => {
    const key = "synthetic-custom-key-for-e2e-only";
    provider.reset([{ delta: { content: "Credential test completed" } }]);
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    const { pin } = await openSettings();
    await expect($("input[aria-label='Key']")).toHaveAttribute("type", "password");
    await replaceTextField("Key", key);
    await browser.keys("Enter");
    await browser.waitUntil(() =>
      provider.modelRequests.some(({ headers }) => headers.authorization === `Bearer ${key}`),
    );
    await browser.switchToWindow(pin);
    writeClipboardText("Custom credential proof");
    await expect($("p")).toHaveText("Credential test completed");
    expect(provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${key}`);
    const settingsPath = join(dataFolders(identifier).roaming, "settings.json");
    const stored = readFileSync(settingsPath, "utf8");
    expect(stored).not.toContain(key);
    const document = JSON.parse(stored);
    // Independent Windows DPAPI verifies encryption rather than a reversible text encoding.
    const decrypted = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Add-Type -AssemblyName System.Security; $cipher = [Convert]::FromBase64String([Console]::In.ReadToEnd()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))",
      ],
      { input: document.presets.custom.keyCiphertext, encoding: "utf8" },
    ).trim();
    expect(decrypted).toBe(key);
    // Seed only the real document the previous app wrote, proving decryption on a new process.
    await relaunch({ settings: document });
    await expect($("p")).toHaveText("Credential test completed");
    expect(provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${key}`);
  });

  it("flags an undecryptable key for re-entry and lets the user reveal its replacement", async () => {
    const settings = customSettings(provider);
    provider.reset();
    clearClipboard();
    await relaunch({
      settings: {
        ...settings,
        presets: { custom: { ...settings.presets.custom, keyCiphertext: "bm90LWEtRFBBUEktY2lwaGVydGV4dA==" } },
      },
    });
    await openSettings();
    const warning = $("//*[text()='The saved key could not be decrypted. Enter it again.']");
    const key = () => $("input[aria-label='Key']");
    await expect(warning).toBeDisplayed();
    await expect(key()).toHaveAttribute("aria-invalid", "true");
    await expect(key()).toHaveValue("");
    const replacement = "synthetic-replacement-key-for-e2e-only";
    await replaceTextField("Key", replacement);
    await $("button[aria-label='Show key']").click();
    await expect(key()).toHaveAttribute("type", "text");
    await expect(key()).toHaveValue(replacement);
    await $("button[aria-label='Hide key']").click();
    await expect(key()).toHaveAttribute("type", "password");
    await key().click();
    await browser.keys("Enter");
    await browser.waitUntil(() =>
      provider.modelRequests.some(({ headers }) => headers.authorization === `Bearer ${replacement}`),
    );
    await expect(warning).not.toExist();
    await expect(key()).not.toHaveAttribute("aria-invalid", "true");
  });
});
