import type { ComponentProps, ComponentType, JSX, KeyboardEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Link, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { CheckboxCheckedRegular, CheckboxUncheckedRegular, CopyRegular } from "@fluentui/react-icons";
import { Streamdown, type Components, type ExtraProps } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { strings } from "../i18n";
import "./markdown.css";

type HastNode = NonNullable<ExtraProps["node"]>;
/** Streamdown's `Components`, typed per element: its index signature accepts no element's own props. */
type ElementComponents = {
  [K in keyof JSX.IntrinsicElements]?:
    ComponentType<JSX.IntrinsicElements[K] & ExtraProps> | keyof JSX.IntrinsicElements;
};

const plugins = { cjk };
/** `<mark>`, beside the HTML Streamdown already lets through (GitHub's set: `kbd`, `sub`, `sup`, `details` and more). */
const allowedTags = { mark: [] };

const useStyles = makeStyles({
  // A link takes the type of the text it sits in, as a WinUI Hyperlink does.
  link: { fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit", lineHeight: "inherit" },
  mutedLink: {
    color: tokens.colorNeutralForeground3,
    ":hover": { color: tokens.colorNeutralForeground3 },
    ":active": { color: tokens.colorNeutralForeground3 },
  },
});

/** The text of a hast element, as written. */
function textOf(node: HastNode | HastNode["children"][number]): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(textOf).join("") : "";
}

/** The URL a click may open: the Pin window opens `http` and `https` only. */
function webUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A code block: a card with one copy button. Mermaid fences show their source the same way. */
function CodeBlock({ node }: ExtraProps) {
  const code = node ? textOf(node).replace(/\n$/, "") : "";
  return (
    <div className="look-code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <div className="look-code-copy">
        <Tooltip content={strings.copyCode} relationship="label">
          <Button
            size="small"
            appearance="subtle"
            icon={<CopyRegular />}
            // The app's own copy, which the clipboard follower knows as sidelingo's and so starts no Round.
            onClick={() =>
              void invoke("copy_text", { text: code }).catch((reason) => console.error("Code was not copied:", reason))
            }
          />
        </Tooltip>
      </div>
    </div>
  );
}

/** A Fluent link with its URL in a tooltip; a click opens it in the default browser and does nothing else. */
function MarkdownLink({ href, children, muted }: { href?: string; children?: ReactNode; muted: boolean }) {
  const styles = useStyles();
  const url = webUrl(href);
  // A footnote reference, an email address or an unfinished link stays text: there is nothing to open.
  if (!url) return <>{children}</>;
  const open = () => void openUrl(url).catch((reason) => console.error("The link was not opened:", reason));
  return (
    <Tooltip content={url} relationship="description">
      {/* No href: WebView2 would show its own status bar on hover and open new windows on Ctrl+click. */}
      <Link
        as="a"
        role="link"
        className={mergeClasses(styles.link, muted && styles.mutedLink)}
        onClick={open}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter") open();
        }}
      >
        {children}
      </Link>
    </Tooltip>
  );
}

/** A task list's mark: a checkbox icon that can't be toggled. */
function TaskMark({ checked }: { checked?: boolean }) {
  return (
    <span className="look-task" role="checkbox" aria-checked={Boolean(checked)} aria-readonly="true">
      {checked ? <CheckboxCheckedRegular /> : <CheckboxUncheckedRegular />}
    </span>
  );
}

/** Streamdown's components replaced where it draws web chrome; built once per appearance, so streaming stays cheap. */
function componentsFor(muted: boolean): Components {
  return {
    pre: CodeBlock,
    table: ({ children }: ComponentProps<"table">) => (
      <div className="look-table">
        <table>{children}</table>
      </div>
    ),
    input: ({ type, checked, node: _, ...rest }: ComponentProps<"input"> & ExtraProps) =>
      type === "checkbox" ? <TaskMark checked={checked} /> : <input type={type} {...rest} />,
    a: ({ href, children, ...rest }: ComponentProps<"a"> & ExtraProps) =>
      "data-footnote-backref" in rest ? null : (
        <MarkdownLink href={href} muted={muted}>
          {children}
        </MarkdownLink>
      ),
    img: ({ src, alt, title }: ComponentProps<"img"> & ExtraProps) => <img src={src} alt={alt} title={title} />,
    strong: "strong",
  } satisfies ElementComponents as Components;
}
const components = { plain: componentsFor(false), muted: componentsFor(true) };

/**
 * Source or Translated text, laid out the way the rest of Windows lays out reading text. `muted` draws it all in the
 * tertiary colour, for the Source text shown before a Translation starts.
 */
export function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <Streamdown
      className={mergeClasses("look-markdown", muted && "look-muted")}
      plugins={plugins}
      allowedTags={allowedTags}
      components={muted ? components.muted : components.plain}
      controls={false}
      lineNumbers={false}
      linkSafety={{ enabled: false }}
    >
      {text}
    </Streamdown>
  );
}
