/** A closed dropdown, found by its role and accessible name, as a user finds it. */
export function dropdown(name: string): ReturnType<typeof $> {
  return $(`[role=combobox][aria-label="${name}"]`);
}

/** Opens the dropdown named `name` and chooses the option reading `text`, as a user does with the pointer. */
export async function chooseOption(name: string, text: string): Promise<void> {
  await dropdown(name).click();
  await $(`//*[@role="listbox"]//*[@role="option"][normalize-space()="${text}"]`).click();
  await expectChosen(name, text);
}

/** Waits until the closed dropdown named `name` shows `text`, its choice or its placeholder, as a user reads it. */
export async function expectChosen(name: string, text: string): Promise<void> {
  // Ask afresh each time; a controlled dropdown changes its choice after a save.
  await browser.waitUntil(async () => (await dropdown(name).getText()).trim() === text, {
    timeoutMsg: `the ${name} dropdown never showed "${text}"`,
  });
}
