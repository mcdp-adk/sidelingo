import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Switch,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { strings } from "./i18n";
import { requestUpdateCheck, requestUpdateInstall, useUpdateStatus } from "./updates";

const sourceUrl = "https://github.com/mcdp-adk/sidelingo";
const useStyles = makeStyles({
  links: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalL },
  dataFolderPath: { overflowWrap: "anywhere" },
});

function fileUrl(path: string): string {
  const url = new URL("file:///");
  url.pathname = path.replaceAll("\\", "/");
  return url.href;
}

export function AboutSection({
  automaticUpdates,
  commit,
}: {
  automaticUpdates: boolean;
  commit: (enabled: boolean) => Promise<void>;
}) {
  const styles = useStyles();
  const updateStatus = useUpdateStatus();
  const [version, setVersion] = useState<string | null>(null);
  const [dataFolder, setDataFolder] = useState<string | null>(null);
  const [resources, setResources] = useState<{ license: string; notices: string } | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch((reason) => setError({ title: strings.aboutUnavailable, detail: String(reason) }));
    void invoke<string>("data_folder_path")
      .then(setDataFolder)
      .catch((reason) => setError({ title: strings.aboutUnavailable, detail: String(reason) }));
    void Promise.all([resolveResource("LICENSE.txt"), resolveResource("THIRD-PARTY-NOTICES.html")])
      .then(([license, notices]) => setResources({ license, notices }))
      .catch((reason) => setError({ title: strings.aboutUnavailable, detail: String(reason) }));
  }, []);
  const open = async (action: () => Promise<void>) => {
    try {
      await action();
      setError(null);
    } catch (reason) {
      setError({ title: strings.linkNotOpened, detail: String(reason) });
    }
  };
  return (
    <>
      {version && (
        <p>
          {strings.version} {version}
        </p>
      )}
      <Switch
        aria-label={strings.automaticUpdates}
        label={strings.automaticUpdates}
        checked={automaticUpdates}
        onChange={(_, data) => void commit(data.checked)}
      />
      <Button disabled={updateStatus.checking || updateStatus.installing} onClick={() => void requestUpdateCheck()}>
        {strings.checkNow}
      </Button>
      {updateStatus.checkError && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>{strings.updateCheckFailed}</MessageBarTitle>
            {updateStatus.checkError}
          </MessageBarBody>
        </MessageBar>
      )}
      {updateStatus.upToDate && <p role="status">{strings.upToDate}</p>}
      {updateStatus.availableVersion && (
        <Button disabled={updateStatus.checking || updateStatus.installing} onClick={() => void requestUpdateInstall()}>
          {strings.updateTo} {updateStatus.availableVersion}
        </Button>
      )}
      {updateStatus.installing && <p role="status">{strings.installingUpdate}</p>}
      {updateStatus.installError && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>{strings.updateInstallFailed}</MessageBarTitle>
            {updateStatus.installError}
          </MessageBarBody>
        </MessageBar>
      )}
      <p>{strings.copyright}</p>
      <p>{strings.licenseNotice}</p>
      {dataFolder && (
        <>
          <p>
            {strings.dataFolder}: <code className={styles.dataFolderPath}>{dataFolder}</code>
          </p>
          <Button onClick={() => void open(() => invoke("open_data_folder"))}>{strings.openFolder}</Button>
        </>
      )}
      <div className={styles.links}>
        {resources && (
          <Link
            href={fileUrl(resources.license)}
            onClick={(event) => {
              event.preventDefault();
              void open(() => openPath(resources.license));
            }}
          >
            {strings.license}
          </Link>
        )}
        <Link
          href={sourceUrl}
          onClick={(event) => {
            event.preventDefault();
            void open(() => openUrl(sourceUrl));
          }}
        >
          {strings.sourceCode}
        </Link>
        {resources && (
          <Link
            href={fileUrl(resources.notices)}
            onClick={(event) => {
              event.preventDefault();
              void open(() => openPath(resources.notices));
            }}
          >
            {strings.thirdPartyNotices}
          </Link>
        )}
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>{error.title}</MessageBarTitle>
            {error.detail}
          </MessageBarBody>
        </MessageBar>
      )}
    </>
  );
}
