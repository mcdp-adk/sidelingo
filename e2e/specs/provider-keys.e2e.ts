import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { dataFolders, identifier, relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { StalledProxy } from "../proxy";
import { customSettings, FakeProvider } from "../provider";
import { openSettings, replaceTextField, expectShownOption } from "../settings";

describe("Provider keys", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("shows the named launch key source without exposing its value", async () => {
    const noNamedKeys = {
      OPENAI_API_KEY: null,
      OPENROUTER_API_KEY: null,
      DEEPSEEK_API_KEY: null,
      OLLAMA_API_KEY: null,
    };
    const incompleteOpenAI = {
      schemaVersion: 1,
      automaticUpdates: false,
      activePreset: "openai",
      presets: { openai: { model: "" } },
    };
    const cases = [
      {
        name: "set",
        environment: { ...noNamedKeys, OPENAI_API_KEY: "synthetic-openai-launch-key" },
        placeholder: "Using OPENAI_API_KEY; changes take effect after restart.",
      },
      {
        name: "unset",
        environment: noNamedKeys,
        placeholder: "No key; environment variable changes take effect after restart.",
      },
      {
        name: "inherited",
        environment: {},
        workerEnvironment: { OPENAI_API_KEY: "synthetic-inherited-launch-key" },
        placeholder: "No key; environment variable changes take effect after restart.",
      },
    ];

    for (const item of cases) {
      const proxy = await StalledProxy.start();
      const previousOpenAIKey = process.env.OPENAI_API_KEY;
      try {
        if ("workerEnvironment" in item) Object.assign(process.env, item.workerEnvironment);
        clearClipboard();
        await relaunch({
          settings: {
            ...incompleteOpenAI,
            proxy: { mode: "manual", url: proxy.url },
          },
          environment: item.environment,
        });
        await expect($("body")).toHaveText("Copy text or an image to see it here.", { containing: true });
        expect(proxy.connectedAt).toBeNull();

        writeClipboardText(`OpenAI placeholder ${item.name} ${Date.now()}`);
        await $("button[aria-label='Regenerate (Ctrl+R / F5)']").waitForEnabled();
        await expect($("[role=group]")).toHaveText("Enter a model", { containing: true });
        expect(proxy.connectedAt).toBeNull();

        await openSettings();
        await expectShownOption($("select[aria-label='Preset']"), "OpenAI");
        const key = $("input[aria-label='Key']");
        await expect(key).toHaveValue("");
        await expect(key).toHaveAttribute("placeholder", item.placeholder);

        if (item.name === "set") {
          await browser.waitUntil(() => proxy.connectedAt !== null, {
            timeout: 14_000,
            timeoutMsg: "Opening Settings on the active OpenAI Preset did not reach its Manual proxy.",
          });

          const model = "environment-persistence-proof-model";
          await replaceTextField("Model", model);
          await browser.keys("Enter");
          const settingsPath = join(dataFolders(identifier).roaming, "settings.json");
          await browser.waitUntil(() => {
            try {
              return JSON.parse(readFileSync(settingsPath, "utf8")).presets.openai.model === model;
            } catch {
              return false;
            }
          });
          const writtenSettings = readFileSync(settingsPath, "utf8");
          expect(writtenSettings.includes("synthetic-openai-launch-key")).toBe(false);
        } else {
          expect(proxy.connectedAt).toBeNull();
        }
      } finally {
        if ("workerEnvironment" in item) {
          if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
          else process.env.OPENAI_API_KEY = previousOpenAIKey;
        }
        await proxy.close();
      }
    }
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
