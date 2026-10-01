export type UiLanguage = "zh-Hans" | "en";

/** Any Chinese gives Simplified Chinese, anything else English. */
function uiLanguageOf(tag: string): UiLanguage {
  return /^zh(-|$)/i.test(tag) ? "zh-Hans" : "en";
}

const en = {
  pinEmptyHint: "Copy text or an image to see it here.",
};

const zhHans: typeof en = {
  pinEmptyHint: "复制文本或图片，结果会显示在这里。",
};

/** The WebView's language defaults to the Windows display language. */
export const uiLanguage = uiLanguageOf(navigator.language);

export const strings = uiLanguage === "zh-Hans" ? zhHans : en;
