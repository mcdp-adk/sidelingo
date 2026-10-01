import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Select,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { strings } from "./i18n";
import { AboutSection } from "./AboutSection";
import { AutostartSetting } from "./AutostartSetting";
import { PRESET_REGISTRY, PRESETS, type Preset, type ReasoningEffort } from "./presets";
import { patchSettings, useSettings } from "./settings-store";
import { ModelField } from "./ModelField";
import { TargetLanguageSetting } from "./TargetLanguageSetting";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column" },
  error: { flexShrink: 0, margin: tokens.spacingHorizontalL },
  page: { flex: 1, minHeight: 0, overflowY: "auto", padding: tokens.spacingHorizontalXXL },
  section: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalL,
    marginBottom: tokens.spacingVerticalXXXL,
  },
});

function TextSetting({
  label,
  value,
  commit,
}: {
  label: string;
  value: string;
  commit: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const save = () => {
    if (draft !== value) void commit(draft);
  };
  return (
    <Field label={label}>
      <Input
        aria-label={label}
        value={draft}
        onChange={(_, data) => setDraft(data.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
        }}
      />
    </Field>
  );
}

export function SettingsWindow() {
  const styles = useStyles();
  const settings = useSettings();
  const [error, setError] = useState<string | null>(null);
  const page = useRef<HTMLElement>(null);
  const preset = settings.activePreset;
  useEffect(() => {
    const unlisten = listen("settings-window-opened", () => page.current?.scrollTo({ top: 0 }));
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);
  const commit = async (patch: Record<string, unknown>) => {
    try {
      await patchSettings(patch);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <div className={styles.root}>
      {error && (
        <MessageBar intent="error" className={styles.error}>
          <MessageBarBody>
            <MessageBarTitle>{strings.settingsNotSaved}</MessageBarTitle>
            {error}
          </MessageBarBody>
        </MessageBar>
      )}
      <main ref={page} className={styles.page}>
        <h1>{strings.settings}</h1>
        <section className={styles.section} aria-label={strings.provider}>
          <h2>{strings.provider}</h2>
          <Field label={strings.preset}>
            <Select
              aria-label={strings.preset}
              value={preset ?? ""}
              onChange={(_, data) => void commit({ activePreset: data.value as Preset })}
            >
              <option value="" disabled hidden>
                {strings.chooseProvider}
              </option>
              {PRESETS.map((id) => (
                <option key={id} value={id}>
                  {id === "custom" ? strings.custom : PRESET_REGISTRY[id].label}
                </option>
              ))}
            </Select>
          </Field>
          {preset === "custom" && (
            <TextSetting
              label={strings.baseUrl}
              value={settings.presets.custom.baseUrl}
              commit={(baseUrl) => commit({ presets: { custom: { baseUrl } } })}
            />
          )}
          {preset && (
            <>
              <ModelField
                key={preset}
                settings={settings}
                preset={preset}
                commit={(model) => commit({ presets: { [preset]: { model } } })}
              />
              <Field label={strings.reasoningEffort}>
                <Select
                  aria-label={strings.reasoningEffort}
                  value={settings.presets[preset].reasoningEffort ?? ""}
                  onChange={(_, data) =>
                    void commit({
                      presets: { [preset]: { reasoningEffort: data.value ? (data.value as ReasoningEffort) : null } },
                    })
                  }
                >
                  <option value="">{strings.defaultEffort}</option>
                  {PRESET_REGISTRY[preset].efforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </section>
        <section className={styles.section} aria-label={strings.network}>
          <h2>{strings.network}</h2>
        </section>
        <section className={styles.section} aria-label={strings.general}>
          <h2>{strings.general}</h2>
          <TargetLanguageSetting
            value={settings.targetLanguage}
            commit={(targetLanguage) => commit({ targetLanguage })}
          />
          <AutostartSetting />
        </section>
        <section className={styles.section} aria-label={strings.about}>
          <h2>{strings.about}</h2>
          <AboutSection />
        </section>
      </main>
    </div>
  );
}
