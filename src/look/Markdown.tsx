// PROTOTYPE (branch prototype/winui-look): the look module's Markdown renderer, to be folded into main once reviewed.
import { useState, type ComponentProps, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Link, Tooltip, mergeClasses } from "@fluentui/react-components";
import { CheckboxCheckedRegular, CheckboxUncheckedRegular, CheckmarkRegular, CopyRegular } from "@fluentui/react-icons";
import { Streamdown, defaultComponents, type Components } from "streamdown";
import { cjk } from "@streamdown/cjk";
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

/** A Fluent Link that shows its destination on hover and opens in the default browser, as WinUI's Hyperlink does. */
function WinLink({ href, children }: { href?: string; children?: ReactNode }) {
  const url = href ?? "";
  return (
    <Tooltip content={url} relationship="description">
      <Link
        href={url}
        onClick={(e) => {
          e.preventDefault();
          void openUrl(url).catch((reason) => console.error("Could not open link:", reason));
        }}
      >
        {children}
      </Link>
    </Tooltip>
  );
}

const DefaultCode = defaultComponents.code;

/** Built once, so Streamdown sees a stable object while text streams. */
const components = {
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
  a: ({ href, children }: { href?: string; children?: ReactNode }) => <WinLink href={href}>{children}</WinLink>,
} as Components;

/** Source or Translated text, laid out the way the rest of Windows lays out reading text. */
export function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className={mergeClasses("look-markdown", muted && "look-markdown-muted")}>
      <Streamdown plugins={plugins} components={components} controls={controls} lineNumbers={false}>
        {text}
      </Streamdown>
    </div>
  );
}
