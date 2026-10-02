import { strings } from "./i18n";
import type { Preset } from "./presets";
import { currentEnteredKey } from "./settings-store";
import { SecretField } from "./SecretField";

export function KeyField({
  preset,
  ciphertext,
  commit,
}: {
  preset: Preset;
  ciphertext: string | null;
  commit: (ciphertext: string | null) => Promise<void>;
}) {
  return (
    <SecretField
      label={strings.key}
      value={currentEnteredKey(preset)}
      ciphertext={ciphertext}
      showLabel={strings.showKey}
      hideLabel={strings.hideKey}
      undecryptableLabel={strings.keyUndecryptable}
      commit={commit}
    />
  );
}
