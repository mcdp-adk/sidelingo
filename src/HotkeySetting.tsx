import { useEffect, useRef, useState, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Field, makeStyles, tokens } from "@fluentui/react-components";
import { strings } from "./i18n";

const useStyles = makeStyles({
  controls: { display: "flex", columnGap: tokens.spacingHorizontalS },
});

export function HotkeySetting({
  value,
  commit,
  onSaveError,
  recorderRef,
}: {
  value: string | null;
  commit: (hotkey: string | null) => Promise<void>;
  onSaveError: (reason: string | null) => void;
  recorderRef: Ref<HTMLButtonElement>;
}) {
  const styles = useStyles();
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousError = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void invoke<string | null>("read_hotkey_error")
      .then((reason) => {
        if (active) setError(reason);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);
  const record = async (hotkey: string | null) => {
    setRecording(false);
    setPending(true);
    try {
      try {
        await invoke("register_hotkey", { hotkey });
      } catch (reason) {
        setError(String(reason));
        return;
      }
      try {
        await commit(hotkey);
        onSaveError(null);
        setError(null);
      } catch (reason) {
        onSaveError(String(reason));
        // Restore the native registration to the still-authoritative saved
        // setting. A rollback failure remains visible as a registration error.
        try {
          await invoke("register_hotkey", { hotkey: value });
          setError(null);
        } catch (rollbackReason) {
          setError(String(rollbackReason));
        }
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <Field label={strings.hotkey} validationState={error ? "error" : "none"} validationMessage={error}>
      <div className={styles.controls}>
        <Button
          ref={recorderRef}
          aria-label={strings.hotkey}
          aria-invalid={error ? true : undefined}
          disabled={pending}
          onClick={() => {
            previousError.current = error;
            setRecording(true);
          }}
          onKeyDown={(event) => {
            if (!recording) return;
            event.preventDefault();
            if (event.key === "Escape") {
              setRecording(false);
              setError(previousError.current);
              return;
            }
            if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
            const modifiers = [
              event.metaKey && "Win",
              event.ctrlKey && "Ctrl",
              event.altKey && "Alt",
              event.shiftKey && "Shift",
            ].filter(Boolean);
            if (!modifiers.length) {
              setError(strings.hotkeyModifierRequired);
              return;
            }
            const key = (event.code || event.key).replace(/^(Key|Digit)/, "");
            void record([...modifiers, key].join("+"));
          }}
        >
          {recording ? strings.recordHotkey : (value ?? strings.noHotkey)}
        </Button>
        <Button disabled={pending || value === null} onClick={() => void record(null)}>
          {strings.clearHotkey}
        </Button>
      </div>
    </Field>
  );
}
