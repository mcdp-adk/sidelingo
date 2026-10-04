import { relaunch } from "../app";
import { clearClipboard, writeClipboardText } from "../clipboard";
import { customSettings, FakeProvider, gate } from "../provider";
import { openSettings, replaceTextField } from "../settings";

describe("Provider model suggestions", () => {
  let provider: FakeProvider;
  before(async () => {
    provider = await FakeProvider.start();
  });
  after(async () => {
    await provider.close();
  });

  it("shows loading, lists the Provider's models, and still uses a free-form model name", async () => {
    provider.reset();
    const held = gate();
    provider.models({ ids: ["catalog-alpha", "catalog-beta"], wait: held.wait });
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    const { pin, settings } = await openSettings();
    try {
      await expect($("[role=progressbar]")).toBeDisplayed();
      held.open();
      await expect($("[role=progressbar]")).not.toExist();
      await $("input[role=combobox][aria-label='Model']").click();
      await expect($("//*[@role='option' and normalize-space(.)='catalog-alpha']")).toBeDisplayed();
      await expect($("//*[@role='option' and normalize-space(.)='catalog-beta']")).toBeDisplayed();
      await $("//*[@role='option' and normalize-space(.)='catalog-alpha']").click();
      await browser.switchToWindow(pin);
      const first = `selected-model-${Date.now()}`;
      writeClipboardText(first);
      await expect($("p")).toHaveText(first);
      expect(provider.requests.at(-1)?.body.model).toBe("catalog-alpha");
      await browser.switchToWindow(settings);
      await replaceTextField("Model", "unlisted/model@name");
      await browser.keys("Enter");
      await browser.switchToWindow(pin);
      const second = `free-form-model-${Date.now()}`;
      writeClipboardText(second);
      await expect($("p")).toHaveText(second);
      expect(provider.requests.at(-1)?.body.model).toBe("unlisted/model@name");
      expect(provider.modelRequests.map(({ method, path }) => ({ method, path }))).toContainEqual({
        method: "GET",
        path: "/v1/models",
      });
    } finally {
      held.open();
    }
  });

  it("keeps the Provider's failure message until a committed Base URL fetch succeeds", async () => {
    provider.reset();
    provider.models({ status: 503, message: "Model catalog unavailable" });
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    await openSettings();
    const error = $('//*[text()="Can\'t fetch the model list: Model catalog unavailable"]');
    await expect(error).toBeDisplayed();
    const held = gate();
    provider.models({ ids: ["recovered-model"], wait: held.wait });
    try {
      await replaceTextField("Base URL", `${provider.baseUrl}/second`);
      await browser.keys("Enter");
      await expect($("[role=progressbar]")).toBeDisplayed();
      await expect(error).toBeDisplayed();
      await browser.waitUntil(() => provider.modelRequests.some(({ path }) => path === "/v1/second/models"));
      held.open();
      await expect($("[role=progressbar]")).not.toExist();
      await expect(error).not.toExist();
      await $("input[role=combobox][aria-label='Model']").click();
      await expect($("//*[@role='option' and normalize-space(.)='recovered-model']")).toBeDisplayed();
    } finally {
      held.open();
    }
  });

  it("refreshes the model choices when Settings reopens and Custom is chosen again", async () => {
    provider.reset();
    provider.models({ ids: ["initial-model"] });
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    const { pin } = await openSettings();
    const model = () => $("input[role=combobox][aria-label='Model']");
    await model().click();
    await expect($("//*[@role='option' and normalize-space(.)='initial-model']")).toBeDisplayed();
    await browser.keys("Escape");
    provider.models({ ids: ["reopened-model"] });
    await browser.switchToWindow(pin);
    await openSettings();
    await model().click();
    await expect($("//*[@role='option' and normalize-space(.)='reopened-model']")).toBeDisplayed();
    await browser.keys("Escape");
    await $("select[aria-label='Preset']").selectByVisibleText("OpenAI");
    await expect(model()).toHaveValue("");
    provider.models({ ids: ["chosen-again-model"] });
    await $("select[aria-label='Preset']").selectByVisibleText("Custom");
    await expect(model()).toHaveValue("fake-model");
    await model().click();
    await expect($("//*[@role='option' and normalize-space(.)='chosen-again-model']")).toBeDisplayed();
  });

  it("uses the suggested model accepted with Enter", async () => {
    provider.reset();
    provider.models({ ids: ["catalog-alpha", "catalog-beta"] });
    clearClipboard();
    await relaunch({ settings: customSettings(provider) });
    const { pin } = await openSettings();
    await $("input[role=combobox][aria-label='Model']").click();
    await expect($("//*[@role='option' and normalize-space(.)='catalog-alpha']")).toBeDisplayed();
    await replaceTextField("Model", "catalog-a");
    await browser.keys("Enter");
    await browser.switchToWindow(pin);
    const copied = `keyboard-model-${Date.now()}`;
    writeClipboardText(copied);
    await expect($("p")).toHaveText(copied);
    expect(provider.requests.at(-1)?.body.model).toBe("catalog-alpha");
  });
});
