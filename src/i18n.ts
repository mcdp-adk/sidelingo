export type UiLanguage = "zh-Hans" | "en";

/** Any Chinese gives Simplified Chinese, anything else English. */
function uiLanguageOf(tag: string): UiLanguage {
  return /^zh(-|$)/i.test(tag) ? "zh-Hans" : "en";
}

const en = {
  pinEmptyHint: "Copy text or an image to see it here.",
  structuringStatus: "Structuring…",
  translationStatus: "Translating…",
  noTextInImage: "No text found in the image",
  close: "Close (Esc)",
  copySelection: "Copy selection",
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
  settingsNotSaved: "Settings were not saved",
};

const zhHans: typeof en = {
  pinEmptyHint: "复制文本或图片，结果会显示在这里。",
  structuringStatus: "正在整理…",
  translationStatus: "正在翻译…",
  noTextInImage: "图像中没有找到文字",
  close: "关闭 (Esc)",
  copySelection: "复制所选内容",
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
  settingsNotSaved: "设置未保存",
};

/** The WebView's language defaults to the Windows display language. */
export const uiLanguage = uiLanguageOf(navigator.language);

export const strings = uiLanguage === "zh-Hans" ? zhHans : en;
