import { Dropdown, Field, Option } from "@fluentui/react-components";
import { strings } from "../i18n";
import type { Settings } from "../settings/settings";
import { currentProxyPassword } from "../settings/settings-store";
import { SecretField } from "./SecretField";
import { TextSetting } from "./TextSetting";

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
  return (
    <>
      <Field label={strings.proxyMode}>
        <Dropdown
          aria-label={strings.proxyMode}
          value={proxy.mode === "manual" ? strings.manualProxy : strings.systemProxy}
          selectedOptions={[proxy.mode]}
          onOptionSelect={(_, data) => void commit({ proxy: { mode: data.optionValue } })}
        >
          <Option value="system">{strings.systemProxy}</Option>
          <Option value="manual">{strings.manualProxy}</Option>
        </Dropdown>
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
            value={currentProxyPassword()}
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
