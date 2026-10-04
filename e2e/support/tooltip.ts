/** Hovers `control` until a user sees `text` in a tooltip; description tooltips stay in the page while hidden. */
export async function expectTooltip(control: WebdriverIO.Element, text: string): Promise<void> {
  // A hover sometimes leaves the tooltip closed in a full run, so hover until it shows.
  await browser.waitUntil(
    async () => {
      await control.moveTo();
      for (const tooltip of await $$("[role=tooltip]")) {
        if ((await tooltip.isDisplayed()) && (await tooltip.getText()) === text) return true;
      }
      return false;
    },
    { timeoutMsg: `no tooltip showing "${text}"` },
  );
}
