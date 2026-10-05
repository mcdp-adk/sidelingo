/** Opens Settings through its focused Pin shortcut, waiting for the user-visible toolbar first. */
export async function openSettings(): Promise<{ pin: string; settings: string }> {
  const pin = await browser.getWindowHandle();
  await $("[role=toolbar]").moveTo();
  await expect($("aria/Settings (Ctrl+,)")).toBeDisplayed();
  await browser.keys(["Control", ","]);
  const settings = await switchToSettingsWindow(pin);
  await expect($("h1")).toHaveText("Settings");
  return { pin, settings };
}

/** Waits for the settings window to open beside the Pin window `pin`, switches to it, and returns its handle. */
export async function switchToSettingsWindow(pin: string): Promise<string> {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
  const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
  await browser.switchToWindow(settings);
  return settings;
}

/** Replace a controlled text field as a user does, without WebDriver's synthetic clear. */
export async function replaceTextField(label: string, value: string): Promise<void> {
  await $(`aria/${label}`).click();
  await browser.keys(["Control", "a"]);
  await browser.keys(value);
}

/** Waits until a closed dropdown, found by its accessible name, shows `text`, as a user reads it. */
export async function expectShownOption(dropdown: ReturnType<typeof $>, text: string): Promise<void> {
  // Ask afresh each time; a controlled dropdown changes its choice after a save.
  await browser.waitUntil(() => dropdown.$(`option=${text}`).isSelected(), {
    timeoutMsg: `the dropdown never showed "${text}"`,
  });
}

/** The Model `setUpCustomProvider` enters. */
export const TASK_MODEL = "task-model";

/**
 * Sets up the Custom Preset as a user does on a fresh install, from the Pin window: the toolbar's Settings button,
 * Custom, then the Base URL, the Model `TASK_MODEL` and an optional Key, each committed with Enter. Returns to the Pin window and
 * leaves the settings window open.
 */
export async function setUpCustomProvider(
  baseUrl: string,
  { key }: { key?: string } = {},
): Promise<{ pin: string; settings: string }> {
  const pin = await browser.getWindowHandle();
  await $("[role=toolbar]").moveTo();
  await $("aria/Settings (Ctrl+,)").click();
  const settings = await switchToSettingsWindow(pin);
  await $("aria/Preset").selectByVisibleText("Custom");
  await replaceTextField("Base URL", baseUrl);
  await browser.keys("Enter");
  await replaceTextField("Model", TASK_MODEL);
  await browser.keys("Enter");
  if (key !== undefined) {
    await replaceTextField("Key", key);
    await browser.keys("Enter");
  }
  await browser.switchToWindow(pin);
  return { pin, settings };
}

/**
 * Follows the Open settings button of the Pin window's notice or error, returning once Settings shows. The
 * choose-a-Provider notice appears only once something is copied; with nothing copied, open Settings from the toolbar.
 */
export async function followOpenSettings(): Promise<{ pin: string; settings: string }> {
  const pin = await browser.getWindowHandle();
  // The user waits to see the notice or error before pressing its button.
  await $("[role=group]").waitForDisplayed();
  await $("[role=group]").$("button=Open settings").click();
  const settings = await switchToSettingsWindow(pin);
  await expect($("h1")).toHaveText("Settings");
  return { pin, settings };
}

/** Waits until keyboard input goes to no control, as on arriving in a window that focuses nothing. */
export async function expectNothingFocused(): Promise<void> {
  await browser.waitUntil(() => browser.execute<boolean, []>("return document.activeElement === document.body"), {
    timeoutMsg: "a control has keyboard focus",
  });
}
