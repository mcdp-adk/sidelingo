/** The Target languages sidelingo offers, as BCP 47 tags. */
export const TARGET_LANGUAGES = [
  "zh-Hans",
  "zh-Hant",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "it",
  "ru",
  "ar",
  "vi",
  "th",
  "id",
  "tr",
  "pl",
  "nl",
  "uk",
  "hi",
] as const;

export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];

const englishNames = new Intl.DisplayNames("en", { type: "language" });

/** A language's English name, as the Translation prompt names it. */
export function englishName(tag: TargetLanguage): string {
  return englishNames.of(tag) ?? tag;
}
