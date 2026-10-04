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
  await $(`aria/${label}`).click();
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

/**
 * Sets up the Custom Preset as a user does on a fresh install, from the Pin window: the toolbar's Settings button,
 * Custom, then the Base URL and a Model, each committed with Enter. Returns to the Pin window and leaves the settings
 * window open.
 */
export async function setUpCustomProvider(baseUrl: string): Promise<{ pin: string; settings: string }> {
  const pin = await browser.getWindowHandle();
  await $("[role=toolbar]").moveTo();
  await $("aria/Settings (Ctrl+,)").click();
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
  const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
  await browser.switchToWindow(settings);
  await $("aria/Preset").selectByVisibleText("Custom");
  await replaceTextField("Base URL", baseUrl);
  await browser.keys("Enter");
  await replaceTextField("Model", "task-model");
  await browser.keys("Enter");
  await browser.switchToWindow(pin);
  return { pin, settings };
}
