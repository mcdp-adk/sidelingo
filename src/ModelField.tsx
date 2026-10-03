import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetch } from "@tauri-apps/plugin-http";
import { Combobox, Field, Option, Spinner } from "@fluentui/react-components";
import { strings } from "./i18n";
import { providerClient } from "./provider";
import { resolveProviderConnection, type ConnectionFailure, type Preset, type Settings } from "./settings";
import { currentKeySources, currentProxyPassword } from "./settings-store";

const client = providerClient(fetch);
function connectionMessage(failure: ConnectionFailure): string {
  switch (failure.kind) {
    case "no-provider":
      return strings.noProvider;
    case "missing-key":
      return failure.cause === "environment-unset"
        ? strings.keyMissingEnvironment(failure.variable)
        : strings.keyUndecryptable;
    case "missing-base-url":
      return strings.missingBaseUrl;
  }
}

export function ModelField({
  settings,
  preset,
  commit,
}: {
  settings: Settings;
  preset: Preset;
  commit: (model: string) => Promise<void>;
}) {
  const value = settings.presets[preset].model;
  const [draft, setDraft] = useState(value);
  const [filtering, setFiltering] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionEvent = useRef<unknown>(null);
  const proxyPassword = currentProxyPassword();
  const resolved = resolveProviderConnection(settings, currentKeySources(preset), proxyPassword);
  const key = "configuration" in resolved ? resolved.configuration.key : null;
  const baseUrl = "configuration" in resolved ? resolved.configuration.baseUrl : null;
  const connectionError = "error" in resolved ? resolved.error : null;
  const connectionErrorMessage = connectionError ? connectionMessage(connectionError) : null;

  useEffect(() => {
    setDraft(value);
    setFiltering(false);
  }, [value]);
  useEffect(() => {
    if ("error" in resolved) {
      setError(connectionMessage(resolved.error));
      setModels([]);
      setLoading(false);
      return;
    }
    let controller: AbortController | null = null;
    let disposed = false;
    const refresh = async () => {
      if (disposed) return;
      controller?.abort();
      const current = (controller = new AbortController());
      setLoading(true);
      setModels([]);
      try {
        const ids = await client.listModels(resolved.configuration, current.signal);
        if (current.signal.aborted) return;
        setModels(ids);
        setError(null);
      } catch (reason) {
        if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    };
    void refresh();
    const unlisten = listen("settings-window-opened", () => void refresh());
    return () => {
      disposed = true;
      controller?.abort();
      void unlisten.then((stop) => stop());
    };
    // A changed model does not change the connection or refresh its list.
  }, [
    preset,
    baseUrl,
    connectionError?.kind,
    connectionError?.kind === "missing-key" ? connectionError.cause : null,
    connectionError?.kind === "missing-key" && connectionError.cause === "environment-unset"
      ? connectionError.variable
      : null,
    connectionErrorMessage,
    key,
    settings.proxy.mode,
    settings.proxy.url,
    settings.proxy.username,
    settings.proxy.passwordCiphertext,
    proxyPassword,
  ]);

  const save = () => {
    if (draft !== value) void commit(draft);
  };
  // Unmatched free text must not leave a previous suggestion active for Enter.
  const choices = filtering ? models.filter((id) => id.toLowerCase().startsWith(draft.trim().toLowerCase())) : models;
  return (
    <Field
      label={strings.model}
      validationState={error !== null ? "error" : "none"}
      validationMessage={error !== null ? `${strings.modelListError}${error}` : undefined}
      hint={loading ? <Spinner size="tiny" label={strings.fetchingModels} /> : undefined}
    >
      <Combobox
        aria-label={strings.model}
        freeform
        value={draft}
        selectedOptions={models.includes(draft) ? [draft] : []}
        onChange={(event) => {
          setDraft(event.target.value);
          setFiltering(true);
        }}
        onOpenChange={(_, data) => {
          if (data.open) setFiltering(false);
        }}
        onOptionSelect={(event, data) => {
          if (data.optionValue === undefined) return;
          selectionEvent.current = event;
          setDraft(data.optionValue);
          void commit(data.optionValue);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          // Fluent selects a highlighted suggestion before this handler runs.
          // Save free text only when that same Enter has not already selected it.
          if (event.key === "Enter" && selectionEvent.current !== event) {
            event.preventDefault();
            save();
          }
          selectionEvent.current = null;
        }}
      >
        {choices.map((id) => (
          <Option key={id} value={id}>
            {id}
          </Option>
        ))}
      </Combobox>
    </Field>
  );
}
