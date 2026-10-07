import { strings } from "../i18n";
import { undecryptable } from "../provider/credentials";
import { PRESET_REGISTRY, type Preset } from "../provider/presets";
import { useSettings } from "../settings/settings-store";
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
  const { enteredKey, environment } = useSettings().keySources(preset);
  const variable = PRESET_REGISTRY[preset].keyVariable;
  const environmentKey = variable ? environment?.[variable] : null;
  const placeholder = undecryptable(ciphertext, enteredKey)
    ? variable
      ? strings.keyNoEnvironment
      : strings.keyNone
    : variable
      ? environmentKey
        ? strings.keyFromEnvironment(variable)
        : strings.keyNoEnvironment
      : strings.keyNone;

  return (
    <SecretField
      label={strings.key}
      value={enteredKey}
      ciphertext={ciphertext}
      showLabel={strings.showKey}
      hideLabel={strings.hideKey}
      undecryptableLabel={strings.keyUndecryptable}
      placeholder={placeholder}
      commit={commit}
    />
  );
}
