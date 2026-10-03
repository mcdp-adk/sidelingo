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

/** The display language supplies the initial tag only while settings hold none. */
export function initialTargetLanguage(displayLanguage: string): TargetLanguage {
  const locale = new Intl.Locale(displayLanguage).maximize();
  if (locale.language === "zh") return locale.script === "Hant" ? "zh-Hant" : "zh-Hans";
  const language = locale.language as TargetLanguage;
  return TARGET_LANGUAGES.includes(language) ? language : "en";
}

const englishNames = new Intl.DisplayNames("en", { type: "language" });

/** A language's English name, as the Translation prompt names it. */
export function englishName(tag: TargetLanguage): string {
  return englishNames.of(tag) ?? tag;
}

/** Names remain derived from the tags, in the interface language and the language itself. */
export function languageOptions(uiLanguage: string) {
  const names = new Intl.DisplayNames(uiLanguage, { type: "language" });
  const collator = new Intl.Collator(uiLanguage);
  return TARGET_LANGUAGES.map((tag) => {
    const ownName = new Intl.DisplayNames(tag, { type: "language" }).of(tag) ?? tag;
    return {
      tag,
      name: names.of(tag) ?? tag,
      autonym: ownName.charAt(0).toLocaleUpperCase(tag) + ownName.slice(1),
    };
  }).sort((left, right) => collator.compare(left.name, right.name));
}
