// PROTOTYPE (Session C, branch prototype/winui-look): throwaway, never merge into main.
// Question: how should the Pin window's toolbar reveal and look, and how should its content read,
// once the web-style parts move toward WinUI 3? Each axis below is switchable from a floating bar
// shown only in dev builds; the choice lives in the URL's search params, so a reload keeps it.
import { useState, type ComponentProps } from "react";
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
} from "@fluentui/react-components";
import { CheckboxCheckedRegular, CheckboxUncheckedRegular, CheckmarkRegular, CopyRegular } from "@fluentui/react-icons";
import { defaultComponents, type Components } from "streamdown";
import "./prototype-winui-look.css";
import { AXES, cycle, usePrototype, type Axis } from "./prototype-winui-store";

export { usePrototype } from "./prototype-winui-store";

export function PrototypeSwitcher() {
  const prototype = usePrototype();
  if (!import.meta.env.DEV) return null;
  return (
    <div className="proto-switcher" onDoubleClick={(e) => e.stopPropagation()}>
      {(Object.keys(AXES) as Axis[]).map((axis) => (
        <button
          key={axis}
          type="button"
          title={`${axis}: click for next, right-click for previous`}
          onClick={() => cycle(axis, 1)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            cycle(axis, -1);
          }}
        >
          <b>{axis}</b> {AXES[axis][prototype[axis]]}
        </button>
      ))}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="proto-code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <Tooltip content={copied ? "Copied" : "Copy"} relationship="label">
        <Button
          className="proto-code-copy"
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

/** A Fluent Link that shows its destination on hover and opens in the default browser, optionally after a Fluent dialog. */
function WinLink({ href, children, confirm }: ComponentProps<"a"> & { confirm: boolean }) {
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
              <DialogContent className="proto-dialog-url">{url}</DialogContent>
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

function componentsFor(links: number): Components {
  return {
    // Block code becomes a WinUI-style card with one Fluent copy button; inline code keeps Streamdown's.
    code: (props: ComponentProps<typeof DefaultCode>) => {
      if (!("data-block" in props)) return <DefaultCode {...props} />;
      const text = String(props.children ?? "").replace(/\n$/, "");
      return <CodeBlock code={text} />;
    },
    // A task list's box is a read-only mark, not a web checkbox.
    input: ({ type, checked }: { type?: string; checked?: boolean }) =>
      type === "checkbox" ? (
        checked ? (
          <CheckboxCheckedRegular className="proto-task" />
        ) : (
          <CheckboxUncheckedRegular className="proto-task" />
        )
      ) : null,
    ...(links === 0 ? {} : { a: (props: ComponentProps<"a">) => <WinLink {...props} confirm={links === 2} /> }),
  } as Components;
}

/** Prebuilt per links variant, so Streamdown sees a stable object while text streams. */
export const winuiComponents = [componentsFor(0), componentsFor(1), componentsFor(2)];

export const winuiControls = { code: false, table: false, mermaid: false, image: false } as const;

export const SAMPLE_SOURCE = `# Configuring the proxy

When the **System proxy** is selected, sidelingo follows the \`HTTPS_PROXY\` environment variable and the Windows manual proxy. See [the README](https://github.com/mcdp-adk/sidelingo) for details.

## Steps

1. Open settings with \`Ctrl+,\`.
2. Choose a Provider, then enter its key.
   - Keys are encrypted for your Windows account.
   - A key read from an environment variable is never stored.
3. Copy any text to start a Round.

> A Round cancelled by a newer copy leaves no error.

- [x] Provider chosen
- [ ] Hotkey changed

\`\`\`powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
pnpm dev:desktop --some-very-long-flag-that-should-scroll-sideways-inside-the-code-block-only
\`\`\`

| Preset | Base URL | Key |
| --- | --- | --- |
| OpenAI | https://api.openai.com/v1 | Required |
| Ollama Cloud | https://ollama.com/v1 | Required |

### Notes

Long paths such as C:\\Users\\Someone\\AppData\\Roaming\\io.github.mcdp-adk.sidelingo\\settings.json wrap instead of scrolling.

---

That is all.`;

export const SAMPLE_TRANSLATION = `# 配置代理

选择 **系统代理** 时，sidelingo 会遵循 \`HTTPS_PROXY\` 环境变量和 Windows 手动代理。详情见[README](https://github.com/mcdp-adk/sidelingo)。

## 步骤

1. 用 \`Ctrl+,\` 打开设置。
2. 选择一个服务商，然后输入它的密钥。
   - 密钥会针对你的 Windows 账户加密。
   - 从环境变量读取的密钥不会被保存。
3. 复制任意文本即可开始一轮。

> 被更新的复制取消的一轮不会留下错误。

- [x] 已选择服务商
- [ ] 已更改热键

\`\`\`powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
pnpm dev:desktop --some-very-long-flag-that-should-scroll-sideways-inside-the-code-block-only
\`\`\`

| 预设 | 基础 URL | 密钥 |
| --- | --- | --- |
| OpenAI | https://api.openai.com/v1 | 必填 |
| Ollama Cloud | https://ollama.com/v1 | 必填 |

### 备注

像 C:\\Users\\Someone\\AppData\\Roaming\\io.github.mcdp-adk.sidelingo\\settings.json 这样的长路径会换行，而不是横向滚动。

---

就这些。`;
