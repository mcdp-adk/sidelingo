import { relaunch } from "../app";

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
      await relaunch({ language });
      await expect($("body")).toHaveText(text, { containing: true });
    });
  }
});
