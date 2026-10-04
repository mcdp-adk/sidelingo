import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capabilities, dataFolders, identifier, quit, relaunch } from "../support/app";
import { clearClipboard, writeClipboardText } from "../support/clipboard";
import { runPowerShell } from "../support/powershell";
import { FakeProvider } from "../support/provider";
import { expectShownOption, replaceTextField } from "../support/settings";

const launchKey = "synthetic-openai-launch-key";
const enteredKey = "synthetic-custom-key-for-e2e-only";
const replacementKey = "synthetic-replacement-key-for-e2e-only";
const undecryptable = "The saved key could not be decrypted. Enter it again.";
const settingsFile = join(dataFolders(identifier).roaming, "settings.json");

/** The settings document as saved so far, or nothing before the first save. */
function savedText(): string {
  try {
    return readFileSync(settingsFile, "utf8");
  } catch {
    return "";
  }
}

/** Reads the saved key as another program of the same Windows user can: through DPAPI, not sidelingo. */
function decryptForThisUser(ciphertext: string): string {
  return runPowerShell(
    "Add-Type -AssemblyName System.Security; $cipher = [Convert]::FromBase64String([Console]::In.ReadToEnd()); " +
      "[Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect(" +
      "$cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)))",
    ciphertext,
  );
}

/** Switches to the Settings window the Pin window's notice opens. */
async function openSettingsFromNotice(pin: string): Promise<void> {
  await $("[role=group]").$("button=Open settings").click();
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
  await browser.switchToWindow((await browser.getWindowHandles()).find((handle) => handle !== pin)!);
  await expect($("h1")).toHaveText("Settings");
}

describe("Task 10: the user's Provider keys", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("keeps an entered key encrypted, names a launch key's source, and asks again for a key it can't decrypt", async () => {
    const environment = {
      OPENAI_API_KEY: launchKey,
      OPENROUTER_API_KEY: null,
      DEEPSEEK_API_KEY: null,
      OLLAMA_API_KEY: null,
    };
    provider.reset([{ delta: { content: "Translated with the entered key" } }]);
    clearClipboard();
    await relaunch({ environment });
    let pin = await browser.getWindowHandle();
    writeClipboardText(`A line before any Provider ${Date.now()}`);
    await expect($("[role=group]")).toHaveText("Choose a Provider", { containing: true });
    await openSettingsFromNotice(pin);

    // The launch environment's key: its variable is named, its value is never shown or saved.
    const preset = () => $("aria/Preset");
    const key = () => $("aria/Key");
    await preset().selectByVisibleText("OpenAI");
    await expect(key()).toHaveValue("");
    await expect(key()).toHaveAttribute("placeholder", "Using OPENAI_API_KEY; changes take effect after restart.");
    await browser.waitUntil(() => savedText().includes('"openai"'), { timeoutMsg: "choosing OpenAI was not saved" });
    expect(readFileSync(settingsFile, "utf8")).not.toContain(launchKey);
    // A Preset whose variable isn't set at launch says so.
    await preset().selectByVisibleText("OpenRouter");
    await expect(key()).toHaveAttribute(
      "placeholder",
      "No key; environment variable changes take effect after restart.",
    );

    // A Custom key typed in Settings is masked, used, and saved only as DPAPI ciphertext.
    await preset().selectByVisibleText("Custom");
    await expect(key()).toHaveAttribute("placeholder", "No key.");
    await replaceTextField("Base URL", provider.baseUrl);
    await browser.keys("Enter");
    await replaceTextField("Model", "fake-model");
    await browser.keys("Enter");
    await replaceTextField("Key", enteredKey);
    await expect(key()).toHaveAttribute("type", "password");
    await browser.keys("Enter");
    await browser.waitUntil(() => savedText().includes("keyCiphertext"), {
      timeoutMsg: "the entered key was not saved",
    });
    await browser.switchToWindow(pin);
    writeClipboardText(`A line with the entered key ${Date.now()}`);
    await expect($("p")).toHaveText("Translated with the entered key");
    expect(provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${enteredKey}`);
    const saved = readFileSync(settingsFile, "utf8");
    expect(saved).not.toContain(enteredKey);
    expect(decryptForThisUser(JSON.parse(saved).presets.custom.keyCiphertext)).toBe(enteredKey);

    // After a restart, the line still on the clipboard is translated with the decrypted saved key.
    provider.reset([{ delta: { content: "Translated after a restart" } }]);
    await browser.reloadSession(capabilities());
    await expect($("p")).toHaveText("Translated after a restart");
    expect(provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${enteredKey}`);

    // The saved keys can't be decrypted, as when the document comes from another Windows user.
    await quit();
    const document = JSON.parse(readFileSync(settingsFile, "utf8"));
    const foreign = Buffer.from("not-a-DPAPI-ciphertext").toString("base64");
    document.presets.custom.keyCiphertext = foreign;
    document.presets.openai = { ...document.presets.openai, keyCiphertext: foreign };
    writeFileSync(settingsFile, JSON.stringify(document));
    provider.reset([{ delta: { content: "Translated with the replacement key" } }]);
    await browser.reloadSession(capabilities());
    pin = await browser.getWindowHandle();
    await expect($("[role=group]")).toHaveText(undecryptable, { containing: true });
    expect(provider.requests).toHaveLength(0);
    await openSettingsFromNotice(pin);
    await expect($("body")).toHaveText(undecryptable, { containing: true });
    await expect(key()).toHaveValue("");
    await expect(key()).toHaveAttribute("aria-invalid", "true");

    // OpenAI's saved key is flagged too: the launch key doesn't stand in for it.
    await preset().selectByVisibleText("OpenAI");
    await expect(key()).toHaveAttribute(
      "placeholder",
      "No key; environment variable changes take effect after restart.",
    );
    await expect(key()).toHaveAttribute("aria-invalid", "true");
    await expect($("body")).toHaveText(undecryptable, { containing: true });

    // The user enters a replacement, checks it by revealing it, and saves it.
    await preset().selectByVisibleText("Custom");
    await expectShownOption(preset(), "Custom");
    await replaceTextField("Key", replacementKey);
    await $("aria/Show key").click();
    await expect(key()).toHaveAttribute("type", "text");
    await expect(key()).toHaveValue(replacementKey);
    await $("aria/Hide key").click();
    await expect(key()).toHaveAttribute("type", "password");
    await key().click();
    await browser.keys("Enter");
    await expect($("body")).not.toHaveText(undecryptable, { containing: true });
    await browser.switchToWindow(pin);
    writeClipboardText(`A line with the replacement key ${Date.now()}`);
    await expect($("p")).toHaveText("Translated with the replacement key");
    expect(provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${replacementKey}`);
  });
});
