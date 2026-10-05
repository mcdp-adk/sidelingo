// PROTOTYPE (branch prototype/winui-look): the look module's Markdown renderer, to be folded into main once reviewed.
import { useState, type ComponentProps, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Link,
  Tooltip,
  mergeClasses,
} from "@fluentui/react-components";
import { CheckboxCheckedRegular, CheckboxUncheckedRegular, CheckmarkRegular, CopyRegular } from "@fluentui/react-icons";
import { Streamdown, defaultComponents, type Components } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { usePrototype } from "../pin-window/prototype-winui-store";
import "./markdown.css";

const plugins = { cjk };
/** Streamdown's own chrome (copy, download, fullscreen) is web chrome; sidelingo draws what it keeps. */
const controls = { code: false, table: false, mermaid: false, image: false } as const;

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="look-code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <Tooltip content={copied ? "Copied" : "Copy"} relationship="label">
        <Button
          className="look-code-copy"
          size="small"
          appearance="subtle"
          icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
          onClick={() =>
            void invoke("copy_text", { text: code }).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        />
      </Tooltip>
    </div>
  );
}

/** A Fluent Link that shows its destination on hover and opens in the default browser, optionally after a dialog. */
function WinLink({ href, children, confirm }: { href?: string; children?: ReactNode; confirm: boolean }) {
  const [open, setOpen] = useState(false);
  const url = href ?? "";
  const go = () => void openUrl(url).catch((reason) => console.error("Could not open link:", reason));
  return (
    <>
      <Tooltip content={url} relationship="description">
        <Link
          href={url}
          onClick={(e) => {
            e.preventDefault();
            if (confirm) setOpen(true);
            else go();
          }}
        >
          {children}
        </Link>
      </Tooltip>
      {confirm && (
        <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Open this link?</DialogTitle>
              <DialogContent className="look-dialog-url">{url}</DialogContent>
              <DialogActions>
                <Button
                  onClick={() => {
                    void invoke("copy_text", { text: url });
                    setOpen(false);
                  }}
                >
                  Copy link
                </Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    go();
                    setOpen(false);
                  }}
                >
                  Open link
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </>
  );
}

const DefaultCode = defaultComponents.code;

function componentsFor(confirmLinks: boolean): Components {
  return {
    // Block code becomes a card with one Fluent copy button; inline code keeps Streamdown's element.
    code: (props: ComponentProps<typeof DefaultCode>) => {
      if (!("data-block" in props)) return <DefaultCode {...props} />;
      return <CodeBlock code={String(props.children ?? "").replace(/\n$/, "")} />;
    },
    // Plain table elements: Streamdown's table adds a framed wrapper and a control bar.
    table: ({ children }: { children?: ReactNode }) => (
      <div className="look-table">
        <table>{children}</table>
      </div>
    ),
    thead: "thead",
    tbody: "tbody",
    tr: "tr",
    th: "th",
    td: "td",
    // A task list's box is a read-only mark, not a web checkbox.
    input: ({ type, checked }: { type?: string; checked?: boolean }) =>
      type === "checkbox" ? (
        checked ? (
          <CheckboxCheckedRegular className="look-task" />
        ) : (
          <CheckboxUncheckedRegular className="look-task" />
        )
      ) : null,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <WinLink href={href} confirm={confirmLinks}>
        {children}
      </WinLink>
    ),
  } as Components;
}

/** Built once per link behaviour, so Streamdown sees a stable object while text streams. */
const COMPONENTS = { direct: componentsFor(false), confirm: componentsFor(true) };

/** Source or Translated text, laid out the way the rest of Windows lays out reading text. */
export function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  const confirmLinks = usePrototype().links === 1;
  return (
    <div className={mergeClasses("look-markdown", muted && "look-markdown-muted")}>
      <Streamdown
        // Streamdown memoizes rendered blocks, so a different set of components needs a fresh instance.
        key={String(confirmLinks)}
        plugins={plugins}
        components={confirmLinks ? COMPONENTS.confirm : COMPONENTS.direct}
        controls={controls}
        lineNumbers={false}
      >
        {text}
      </Streamdown>
    </div>
  );
}
