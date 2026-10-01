import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { resolveResource } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Link, MessageBar, MessageBarBody, MessageBarTitle, makeStyles, tokens } from "@fluentui/react-components";
import { strings } from "./i18n";

const sourceUrl = "https://github.com/mcdp-adk/sidelingo";
const useStyles = makeStyles({
  links: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalL },
});

function fileUrl(path: string): string {
  const url = new URL("file:///");
  url.pathname = path.replaceAll("\\", "/");
  return url.href;
}

export function AboutSection() {
  const styles = useStyles();
  const [version, setVersion] = useState<string | null>(null);
  const [resources, setResources] = useState<{ license: string; notices: string } | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  useEffect(() => {
    void getVersion()
      .then(setVersion)
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
      <p>{strings.copyright}</p>
      <p>{strings.licenseNotice}</p>
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
