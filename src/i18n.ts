export type UiLanguage = "zh-Hans" | "en";

/** Any Chinese gives Simplified Chinese, anything else English. */
function uiLanguageOf(tag: string): UiLanguage {
  return /^zh(-|$)/i.test(tag) ? "zh-Hans" : "en";
}

const en = {
  pinEmptyHint: "Copy text or an image to see it here.",
  structuringStatus: "Structuring…",
  translationStatus: "Translating…",
  close: "Close (Esc)",
  copySelection: "Copy selection",
  copySource: "Copy source",
  copyTranslation: "Copy translation",
  settings: "Settings",
  settingsShortcut: "Settings (Ctrl+,)",
  provider: "Provider",
  preset: "Preset",
  chooseProvider: "Choose a Provider",
  custom: "Custom",
  baseUrl: "Base URL",
  model: "Model",
  network: "Network",
  general: "General",
  about: "About",
  version: "Version",
  copyright: "Copyright © 2026 mcdp-adk",
  licenseNotice: "Licensed under GPL-3.0-only, with no warranty.",
  aboutUnavailable: "Application information could not be loaded",
  license: "License",
  sourceCode: "Source code",
  thirdPartyNotices: "Third-party notices",
  linkNotOpened: "The link could not be opened",
  settingsNotSaved: "Settings were not saved",
};

const zhHans: typeof en = {
  pinEmptyHint: "复制文本或图片，结果会显示在这里。",
  structuringStatus: "正在整理…",
  translationStatus: "正在翻译…",
  close: "关闭 (Esc)",
  copySelection: "复制所选内容",
  copySource: "复制原文",
  copyTranslation: "复制译文",
  settings: "设置",
  settingsShortcut: "设置 (Ctrl+,)",
  provider: "服务商",
  preset: "预设",
  chooseProvider: "选择服务商",
  custom: "自定义",
  baseUrl: "Base URL",
  model: "模型",
  network: "网络",
  general: "常规",
  about: "关于",
  version: "版本",
  copyright: "版权所有 © 2026 mcdp-adk",
  licenseNotice: "遵循 GPL-3.0-only 许可，不提供任何担保。",
  aboutUnavailable: "无法加载应用信息",
  license: "许可证",
  sourceCode: "源代码",
  thirdPartyNotices: "第三方许可声明",
  linkNotOpened: "无法打开链接",
  settingsNotSaved: "设置未保存",
};

/** The WebView's language defaults to the Windows display language. */
export const uiLanguage = uiLanguageOf(navigator.language);

export const strings = uiLanguage === "zh-Hans" ? zhHans : en;
