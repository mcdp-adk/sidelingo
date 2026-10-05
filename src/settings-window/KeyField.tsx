import { strings } from "../i18n";
import { PRESET_REGISTRY, type Preset } from "../provider/presets";
import { currentEnteredKey, currentKeySources } from "../settings/settings-store";
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
  const enteredKey = currentEnteredKey(preset);
  const variable = PRESET_REGISTRY[preset].keyVariable;
  const environmentKey = variable ? currentKeySources(preset).environment?.[variable] : null;
  const undecryptable = ciphertext !== null && enteredKey === null;
  const placeholder = undecryptable
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
