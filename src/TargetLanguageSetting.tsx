import { useState } from "react";
import { Combobox, Field, Option, makeStyles, tokens } from "@fluentui/react-components";
import { strings, uiLanguage } from "./i18n";
import { englishName, languageOptions, type TargetLanguage } from "./languages";

const options = languageOptions(uiLanguage);
const useStyles = makeStyles({
  names: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalM },
  autonym: { color: tokens.colorNeutralForeground3 },
});

export function TargetLanguageSetting({
  value,
  commit,
}: {
  value: TargetLanguage;
  commit: (tag: TargetLanguage) => Promise<void>;
}) {
  const styles = useStyles();
  const [query, setQuery] = useState<string | null>(null);
  const name = options.find((option) => option.tag === value)!.name;
  const search = (query ?? "").trim().toLocaleLowerCase(uiLanguage);
  const filtered = options.filter(({ tag, name, autonym }) =>
    [name, autonym, englishName(tag), tag].some((text) => text.toLocaleLowerCase(uiLanguage).includes(search)),
  );
  return (
    <Field label={strings.targetLanguage}>
      <Combobox
        aria-label={strings.targetLanguage}
        value={query ?? name}
        selectedOptions={[value]}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={() => setQuery(null)}
        onOpenChange={(_, data) => {
          if (!data.open) setQuery(null);
        }}
        onOptionSelect={(_, data) => {
          // Fluent also reports clearing a selection while the user types.
          if (data.optionValue) {
            setQuery(null);
            void commit(data.optionValue as TargetLanguage);
          }
        }}
      >
        {filtered.map(({ tag, name, autonym }) => (
          <Option key={tag} value={tag} text={name}>
            <span className={styles.names}>
              <span>{name}</span>
              {autonym !== name && <span className={styles.autonym}>{autonym}</span>}
            </span>
          </Option>
        ))}
      </Combobox>
    </Field>
  );
}
