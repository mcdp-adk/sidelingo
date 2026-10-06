import { Field } from "@fluentui/react-components";
import { strings } from "../i18n";
import { ChoiceDropdown } from "../look/ChoiceDropdown";
import type { Settings } from "../settings/settings";
import { useSettings } from "../settings/settings-store";
import { SecretField } from "./SecretField";
import { TextSetting } from "./TextSetting";

const PROXY_MODES: readonly Settings["proxy"]["mode"][] = ["system", "manual"];

function validateUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return strings.proxyCredentialsSeparate;
    return ["http:", "https:", "socks5:"].includes(url.protocol) ? null : strings.proxyUrlInvalid;
  } catch {
    return strings.proxyUrlInvalid;
  }
}

export function NetworkSettings({
  settings,
  commit,
}: {
  settings: Settings;
  commit: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const proxy = settings.proxy;
  const { proxyPassword } = useSettings();
  const proxyModeLabels = { system: strings.systemProxy, manual: strings.manualProxy };
  return (
    <>
      <Field label={strings.proxyMode}>
        <ChoiceDropdown
          aria-label={strings.proxyMode}
          choices={PROXY_MODES}
          value={proxy.mode}
          labelOf={(mode) => proxyModeLabels[mode]}
          onChoose={(mode) => void commit({ proxy: { mode } })}
        />
      </Field>
      {proxy.mode === "manual" && (
        <>
          <TextSetting
            label={strings.proxyUrl}
            value={proxy.url}
            validate={validateUrl}
            commit={(url) => commit({ proxy: { url } })}
          />
          <TextSetting
            label={strings.proxyUsername}
            value={proxy.username}
            commit={(username) => commit({ proxy: { username } })}
          />
          <SecretField
            label={strings.proxyPassword}
            value={proxyPassword}
            ciphertext={proxy.passwordCiphertext}
            showLabel={strings.showPassword}
            hideLabel={strings.hidePassword}
            undecryptableLabel={strings.passwordUndecryptable}
            commit={(passwordCiphertext) => commit({ proxy: { passwordCiphertext } })}
          />
        </>
      )}
    </>
  );
}
