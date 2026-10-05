import { useEffect, useState } from "react";
import { Field, Input } from "@fluentui/react-components";

/** Ordinary text fields commit on Enter or blur. */
export function TextSetting({
  label,
  value,
  validate,
  commit,
}: {
  label: string;
  value: string;
  validate?: (value: string) => string | null;
  commit: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const save = () => {
    if (draft === value) return;
    const reason = validate?.(draft) ?? null;
    setError(reason);
    if (!reason) void commit(draft);
  };
  return (
    <Field label={label} validationState={error ? "error" : "none"} validationMessage={error ?? undefined}>
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
