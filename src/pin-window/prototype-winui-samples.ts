// PROTOTYPE (branch prototype/winui-look): throwaway, never merge into main.
// Every element GFM and Streamdown can render, plus what Structuring actually produces.

export const KITCHEN_SINK_SOURCE = `# Heading 1 with \`inline code\`

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

A plain paragraph with **bold**, *italic*, ***bold italic***, ~~strikethrough~~, \`inline code\`, and a backtick inside code: \`\` a \`tick\` \`\`.
A second line in the same paragraph, after a soft break.
A line ending in two spaces
forces a hard break.

Links: [inline link](https://github.com/mcdp-adk/sidelingo), [link with a title](https://learn.microsoft.com "Microsoft Learn"), an autolink https://api.openai.com/v1/chat/completions, <https://example.com/angle-brackets>, an email <someone@example.com>, and a [reference link][ref].

[ref]: https://github.com/microsoft/microsoft-ui-xaml

A very long URL that must wrap: https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all/until/it/must/wrap/somewhere?query=string&and=more

A very long word: Pneumonoultramicroscopicsilicovolcanoconiosis-and-then-some-more-characters-to-force-a-wrap.

Escaped characters: \\*not italic\\*, \\# not a heading, 1\\. not a list.

Formulas stay plain text: E = mc^2, $x_1 + x_2$, \\frac{a}{b}.

Emoji and symbols: ✅ ⚠️ → © ™ ½.

---

## Lists

- Unordered item
- Item with **bold** and \`code\`
  - Nested item
    - Deeply nested item
- Item with a second paragraph

  The second paragraph of the same item.

5. Ordered list starting at five
6. Next
   1. Nested ordered
   2. Another
7. Item containing code:

   \`\`\`bash
   echo "code inside a list item"
   \`\`\`

- [x] Completed task
- [ ] Open task
  - [ ] Nested open task

## Quotes

> A single quote.

> A quote with **emphasis** and a list:
>
> - one
> - two
>
> > A nested quote.

## Code

\`\`\`ts
// Labelled TypeScript
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

\`\`\`
Unlabelled block
    with indentation kept
\`\`\`

\`\`\`log
2026-10-05T18:12:19.000Z INFO  sidelingo::round  structuring started input_chars=1832 provider=openrouter model=~openai/gpt-luna-latest effort=low
2026-10-05T18:12:21.412Z ERROR sidelingo::round  translation failed status=429 detail="rate limit exceeded, retry after 20s"
\`\`\`

\`\`\`json
{ "displayMode": "both", "hotkey": "Win+Alt+Q", "presets": { "custom": { "baseUrl": "http://localhost:11434/v1" } } }
\`\`\`

\`\`\`mermaid
graph LR; Input --> Structuring --> Translation
\`\`\`

A tall block that should scroll inside itself:

\`\`\`text
line 01
line 02
line 03
line 04
line 05
line 06
line 07
line 08
line 09
line 10
line 11
line 12
line 13
line 14
line 15
line 16
line 17
line 18
line 19
line 20
line 21
line 22
line 23
line 24
line 25
\`\`\`

## Tables

| Left | Centre | Right |
| :--- | :---: | ---: |
| a | b | 1 |
| \`code\` | [link](https://example.com) | 22 |
| **bold** |  | 333 |

| Preset | Base URL | Key | Models | Reasoning efforts | Notes |
| --- | --- | --- | --- | --- | --- |
| OpenAI | https://api.openai.com/v1 | Required | gpt-luna-latest, gpt-luna-mini | minimal, low, medium, high | A wide table that must scroll sideways inside itself rather than widen the window |
| Ollama Cloud | https://ollama.com/v1 | Required | deepseek-v4.1-flash | none | |

## Footnotes and HTML

A sentence with a footnote.[^1]

[^1]: The footnote text.

Inline HTML: <kbd>Ctrl</kbd>+<kbd>C</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <mark>marked</mark>, line<br>break.

<details>
<summary>Details element</summary>

Hidden content.

</details>

![An image](https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png)

Last paragraph.`;

export const KITCHEN_SINK_TRANSLATION = `# 一级标题，含 \`行内代码\`

## 二级标题

### 三级标题

正文段落：**加粗**、*斜体*、~~删除线~~、\`行内代码\`。**加粗紧挨中文标点**，以及“引号”和《书名号》。链接后跟句号：[README](https://github.com/mcdp-adk/sidelingo)。

中英混排：sidelingo 会遵循 \`HTTPS_PROXY\` 环境变量和 Windows 手动代理，详见 https://github.com/mcdp-adk/sidelingo 。

很长的路径：C:\\Users\\Someone\\AppData\\Roaming\\io.github.mcdp-adk.sidelingo\\settings.json 会换行。

---

- 无序列表
  - 嵌套项
- [x] 已完成
- [ ] 未完成

1. 有序列表
2. 第二项

> 引用：被更新的复制取消的一轮不会留下错误。

\`\`\`powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"   # 注释里的中文
pnpm dev:desktop --some-very-long-flag-that-should-scroll-sideways-inside-the-code-block-only
\`\`\`

| 预设 | 基础 URL | 密钥 |
| --- | --- | --- |
| OpenAI | https://api.openai.com/v1 | 必填 |
| Ollama Cloud | https://ollama.com/v1 | 必填 |

脚注示例。[^1]

[^1]: 脚注内容。

日文：「東京」へようこそ。韩文：안녕하세요.`;
