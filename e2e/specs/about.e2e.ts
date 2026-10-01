import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { relaunch } from "../app";
import { clearClipboard } from "../clipboard";

const version = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")).version;

describe("About", () => {
  it("shows the running version, legal notices, and their actual link targets in both UI languages", async () => {
    for (const { language, title, versionLabel, copyright, notice, licenseLabel, sourceLabel, noticesLabel } of [
      {
        language: "en-US",
        title: "About",
        versionLabel: "Version",
        copyright: "Copyright © 2026 mcdp-adk",
        notice: "Licensed under GPL-3.0-only, with no warranty.",
        licenseLabel: "License",
        sourceLabel: "Source code",
        noticesLabel: "Third-party notices",
      },
      {
        language: "zh-TW",
        title: "关于",
        versionLabel: "版本",
        copyright: "版权所有 © 2026 mcdp-adk",
        notice: "遵循 GPL-3.0-only 许可，不提供任何担保。",
        licenseLabel: "许可证",
        sourceLabel: "源代码",
        noticesLabel: "第三方许可声明",
      },
    ]) {
      clearClipboard();
      await relaunch({ language });
      const pin = await browser.getWindowHandle();
      await $("[role=toolbar]").moveTo();
      const openSettings = $(
        language === "en-US" ? "button[aria-label='Settings (Ctrl+,)']" : "button[aria-label='设置 (Ctrl+,)']",
      );
      await expect(openSettings).toBeDisplayed();
      await openSettings.click();
      await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
      const settings = (await browser.getWindowHandles()).find((handle) => handle !== pin)!;
      await browser.switchToWindow(settings);
      const about = () => $(`section[aria-label='${title}']`);
      await about().scrollIntoView();
      await expect(about()).toHaveText(expect.stringContaining(`${versionLabel} ${version}`));
      await expect(about()).toHaveText(expect.stringContaining(copyright));
      await expect(about()).toHaveText(expect.stringContaining(notice));
      await expect(about().$(`a=${sourceLabel}`)).toHaveAttribute("href", "https://github.com/mcdp-adk/sidelingo");
      const license = about().$(`a=${licenseLabel}`);
      const notices = about().$(`a=${noticesLabel}`);
      await expect(license).toHaveAttribute("href", expect.stringMatching(/^file:\/\//));
      await expect(notices).toHaveAttribute("href", expect.stringMatching(/^file:\/\//));
      const licenseText = readFileSync(fileURLToPath((await license.getAttribute("href"))!), "utf8");
      expect(licenseText).toContain("GNU GENERAL PUBLIC LICENSE");
      expect(licenseText).toContain("Version 3, 29 June 2007");
      const noticesText = readFileSync(fileURLToPath((await notices.getAttribute("href"))!), "utf8");
      expect(noticesText).toContain("Permission is hereby granted, free of charge");
      expect(noticesText).toContain("Apache License");
      expect(noticesText).toContain("tauri-plugin-single-instance");
    }
  });
});
