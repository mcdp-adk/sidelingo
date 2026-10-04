import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  Field,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Select,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { strings } from "../i18n";
import { AboutSection } from "./AboutSection";
import { AutostartSetting } from "./AutostartSetting";
import { PRESET_REGISTRY, PRESETS, type Preset, type ReasoningEffort } from "../provider/presets";
import { patchSettings, useSettings } from "../settings/settings-store";
import { ModelField } from "./ModelField";
import { KeyField } from "./KeyField";
import { TargetLanguageSetting } from "./TargetLanguageSetting";
import { HotkeySetting } from "./HotkeySetting";
import { TextSetting } from "./TextSetting";
import { NetworkSettings } from "./NetworkSettings";

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

export function SettingsWindow() {
  const styles = useStyles();
  const settings = useSettings();
  const [error, setError] = useState<string | null>(null);
  const page = useRef<HTMLElement>(null);
  const general = useRef<HTMLElement>(null);
  const hotkeyRecorder = useRef<HTMLButtonElement>(null);
  const initialNotificationTarget = useRef<Promise<"hotkey" | null> | null>(null);
  const preset = settings.activePreset;
  useEffect(() => {
    let active = true;
    const arrive = (target: "hotkey" | null, resetScroll: boolean) => {
      if (!active) return;
      if (target === "hotkey") {
        general.current?.scrollIntoView({ block: "start" });
        hotkeyRecorder.current?.focus({ preventScroll: true });
      } else if (resetScroll) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        page.current?.scrollTo({ top: 0 });
      }
    };
    const unlisten = listen("settings-window-opened", () => {
      void invoke<"hotkey" | null>("take_notification_target")
        .then((target) => arrive(target, true))
        .catch(console.error);
    });
    // Share the one-shot read across StrictMode's effect replay so activation
    // on first window creation is not consumed by a discarded effect.
    initialNotificationTarget.current ??= invoke<"hotkey" | null>("take_notification_target");
    void initialNotificationTarget.current.then((target) => arrive(target, false)).catch(console.error);
    return () => {
      active = false;
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
              <KeyField
                key={`key-${preset}`}
                preset={preset}
                ciphertext={settings.presets[preset].keyCiphertext}
                commit={(keyCiphertext) => commit({ presets: { [preset]: { keyCiphertext } } })}
              />
              <ModelField
                key={`model-${preset}`}
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
          <NetworkSettings settings={settings} commit={commit} />
        </section>
        <section ref={general} className={styles.section} aria-label={strings.general}>
          <h2>{strings.general}</h2>
          <TargetLanguageSetting
            value={settings.targetLanguage}
            commit={(targetLanguage) => commit({ targetLanguage })}
          />
          <HotkeySetting
            recorderRef={hotkeyRecorder}
            value={settings.hotkey}
            onSaveError={setError}
            commit={async (hotkey) => {
              await patchSettings({ hotkey });
            }}
          />
          <AutostartSetting />
        </section>
        <section className={styles.section} aria-label={strings.about}>
          <h2>{strings.about}</h2>
          <AboutSection
            automaticUpdates={settings.automaticUpdates}
            commit={(automaticUpdates) => commit({ automaticUpdates })}
          />
        </section>
      </main>
    </div>
  );
}
