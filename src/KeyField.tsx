import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Field, Input } from "@fluentui/react-components";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";
import { strings } from "./i18n";
import type { Preset } from "./presets";
import { currentEnteredKey } from "./settings-store";

export function KeyField({
  preset,
  ciphertext,
  commit,
}: {
  preset: Preset;
  ciphertext: string | null;
  commit: (ciphertext: string | null) => Promise<void>;
}) {
  const entered = currentEnteredKey(preset);
  const value = entered ?? "";
  const undecryptable = ciphertext !== null && entered === null;
  const [draft, setDraft] = useState(value);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const save = async () => {
    if (draft === value) return;
    try {
      const ciphertext = draft ? await invoke<string>("protect_secret", { secret: draft }) : null;
      await commit(ciphertext);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <Field
      label={strings.key}
      validationState={error || undecryptable ? "error" : "none"}
      validationMessage={error ?? (undecryptable ? strings.keyUndecryptable : undefined)}
    >
      <Input
        aria-label={strings.key}
        type={revealed ? "text" : "password"}
        value={draft}
        contentAfter={
          <Button
            appearance="transparent"
            aria-label={revealed ? strings.hideKey : strings.showKey}
            icon={revealed ? <EyeOffRegular /> : <EyeRegular />}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRevealed(!revealed)}
          />
        }
        onChange={(_, data) => setDraft(data.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
      />
    </Field>
  );
}
