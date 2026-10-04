import { relaunch } from "../support/app";
import { clearClipboard } from "../support/clipboard";

const chinese = "复制文本或图片，结果会显示在这里。";
const english = "Copy text or an image to see it here.";

describe("The UI language", () => {
  for (const [language, text] of [
    ["zh-CN", chinese],
    ["zh-TW", chinese],
    ["en-US", english],
    ["ja-JP", english],
  ]) {
    it(`is ${text === chinese ? "Simplified Chinese" : "English"} under ${language}`, async () => {
      // The hint shows only while there is nothing to show.
      clearClipboard();
      await relaunch({ language });
      await expect($("body")).toHaveText(text, { containing: true });
    });
  }
});
