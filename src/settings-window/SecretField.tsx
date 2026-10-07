import { useEffect, useState } from "react";
import { Button, Field, Input } from "@fluentui/react-components";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";
import { protectSecret, undecryptable } from "../provider/credentials";

/** Entered secrets are masked in the UI and encrypted before a settings patch. */
export function SecretField({
  label,
  value,
  ciphertext,
  showLabel,
  hideLabel,
  undecryptableLabel,
  placeholder,
  commit,
}: {
  label: string;
  value: string | null;
  ciphertext: string | null;
  showLabel: string;
  hideLabel: string;
  undecryptableLabel: string;
  placeholder?: string;
  commit: (ciphertext: string | null) => Promise<void>;
}) {
  const entered = value ?? "";
  const unusable = undecryptable(ciphertext, value);
  const [draft, setDraft] = useState(entered);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(entered);
  }, [entered]);
  const save = async () => {
    if (draft === entered) return;
    try {
      await commit(await protectSecret(draft));
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <Field
      label={label}
      validationState={error || unusable ? "error" : "none"}
      validationMessage={error ?? (unusable ? undecryptableLabel : undefined)}
    >
      <Input
        aria-label={label}
        type={revealed ? "text" : "password"}
        value={draft}
        placeholder={placeholder}
        contentAfter={
          <Button
            appearance="transparent"
            aria-label={revealed ? hideLabel : showLabel}
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
