import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Field, Switch } from "@fluentui/react-components";
import { strings } from "./i18n";

export function AutostartSetting() {
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const refresh = async () => {
      setPending(true);
      try {
        setEnabled(await invoke<boolean>("read_autostart"));
        setError(undefined);
      } catch (reason) {
        setError(String(reason));
      } finally {
        setPending(false);
      }
    };
    void refresh();
    const unlisten = listen("settings-window-opened", () => void refresh());
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const change = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setPending(true);
    try {
      setEnabled(await invoke<boolean>("set_autostart", { enabled: next }));
      setError(undefined);
    } catch (reason) {
      setEnabled(previous);
      setError(String(reason));
      // The OS is authoritative, even if both registration and its rollback
      // failed. Keep the error beside the actual registration state.
      try {
        setEnabled(await invoke<boolean>("read_autostart"));
      } catch {
        /* Keep the last known state. */
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Field validationState={error ? "error" : "none"} validationMessage={error}>
      <Switch
        aria-label={strings.autostart}
        label={strings.autostart}
        checked={enabled}
        disabled={pending}
        onChange={(_, data) => void change(data.checked)}
      />
    </Field>
  );
}
