/** Opens Settings through its focused Pin shortcut, waiting for the user-visible toolbar first. */
export async function openSettings(): Promise<{ pin: string; settings: string }> {
  const pin = await browser.getWindowHandle();
  await $("[role=toolbar]").moveTo();
  await expect($("button[aria-label='Settings (Ctrl+,)']")).toBeDisplayed();
  await browser.keys(["Control", ","]);
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
  const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
  await browser.switchToWindow(settings);
  await expect($("h1")).toHaveText("Settings");
  return { pin, settings };
}

/** Replace a controlled text field as a user does, without WebDriver's synthetic clear. */
export async function replaceTextField(label: string, value: string): Promise<void> {
  await $(`input[aria-label='${label}']`).click();
  await browser.keys(["Control", "a"]);
  await browser.keys(value);
}

/** Preset names as the Preset dropdown shows them in English. */
export const PRESET_NAMES: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  "ollama-cloud": "Ollama Cloud",
  custom: "Custom",
};

/** Waits until a closed dropdown shows `text`, as a user reads it. */
export async function expectShownOption(dropdown: ReturnType<typeof $>, text: string): Promise<void> {
  // Query the chosen option afresh each time; a controlled dropdown changes it after a save.
  await browser.waitUntil(async () => (await dropdown.$("option:checked").getProperty("text")) === text, {
    timeoutMsg: `the dropdown never showed "${text}"`,
  });
}
