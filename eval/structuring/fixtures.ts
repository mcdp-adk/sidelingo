import type { Input } from "../../src/round/round";
import appWindow from "./fixtures/app-window.png?inline";
import code from "./fixtures/code.png?inline";
import noText from "./fixtures/no-text.png?inline";

/** One synthetic Input for `pnpm eval:structuring`, with what good Source text looks like for it. */
export interface Fixture {
  name: string;
  group: "prose" | "lists" | "code" | "literals" | "table" | "cjk" | "one-line" | "image";
  input: Input;
  /** What good output looks like; the agent reads each result against it. */
  note: string;
}

const text = (value: string): Input => ({ kind: "text", text: value });

// Every Input is synthetic: no real screenshot, document, log, path or clipboard content.
export const fixtures: Fixture[] = [
  {
    name: "pdf-prose",
    group: "prose",
    input: text(`Field Notes on Pond Ecology                                    12

The common frog spends most of the year on land, re-
turning to its breeding pond only in early spring. Sur-
veys that count spawn clumps can therefore estimate
the adult population without disturbing the animals.

Field Notes on Pond Ecology                                    13

Water temperature matters more than day length. In
a cold year the first clumps may appear weeks later
than usual, and a late frost can kill the eggs that
were laid first.`),
    note: "Two paragraphs of prose. Running header 'Field Notes on Pond Ecology' and page numbers 12 and 13 are gone. Hard-wrapped lines are rejoined; 're-turning' and 'Sur-veys' become 'returning' and 'Surveys'. Every word otherwise kept.",
  },
  {
    name: "lost-paragraph-breaks",
    group: "prose",
    input: text(
      "The library opens at nine on weekdays and at ten on Saturdays. It is closed on Sundays and public holidays. Members can borrow up to eight items at a time.\nThe reading room on the second floor is reserved for quiet study. Laptops are welcome, but calls must be taken in the lobby.\nThe café next to the entrance serves coffee and light lunches until three in the afternoon.",
    ),
    note: "Three paragraphs: opening hours, the reading room, the café. Each source line is its own paragraph (a blank line between them), not merged into one and not turned into a list.",
  },
  {
    name: "one-long-paragraph",
    group: "prose",
    input: text(
      "When the old bridge was finally closed to traffic, the town council faced a choice it had postponed for a decade: repair the stone arches at great expense, or build a new crossing upstream and let the old one become a footpath. Engineers argued that the arches were sound and only the deck had failed, while shopkeepers on the riverbank feared that moving the traffic would empty their streets. After three public meetings and a survey of nearly every household, the council chose a compromise that pleased almost no one at first, repairing the deck for pedestrians and cyclists while the new bridge was built, and within a few years most residents could not imagine the town any other way.",
    ),
    note: "Exactly one paragraph, word for word. Not split into several paragraphs, no heading or list added.",
  },
  {
    name: "bulleted-list-nested",
    group: "lists",
    input: text(`Packing list for the field trip:
- Waterproof jacket
- Boots
  * Spare laces
  * Thick socks
• Notebook and two pencils
• Packed lunch
  - Sandwich
  - Apple`),
    note: "A lead-in line, then one Markdown bulleted list with six top-level items in order, where 'Boots' holds 'Spare laces' and 'Thick socks' and 'Packed lunch' holds 'Sandwich' and 'Apple' as nested items. Mixed markers (-, *, •) all become one list.",
  },
  {
    name: "numbered-list-wrapped",
    group: "lists",
    input: text(`1. Rinse the jars in hot water and leave them upside down
   on a clean towel to dry.
2. Weigh the fruit and the sugar, and keep the two
   amounts equal.
3. Simmer the fruit gently for ten minutes before adding
   the sugar.
4. Pour the jam into the warm jars and seal them at once.`),
    note: "A numbered list of four items, 1 to 4. Each hard-wrapped item is rejoined into one item; no continuation line becomes its own item or paragraph.",
  },
  {
    name: "dash-in-prose",
    group: "lists",
    input: text(`The results were mixed - better than last year, but still short of the target.
Three teams - north, east and south - met their goals; the west team did not.
We expect the next round - if funding holds - to start in March.`),
    note: "Prose, not a list: no line becomes a bullet. Each dash stays inside its sentence. One paragraph or three is acceptable as long as no list is made.",
  },
  {
    name: "multi-line-code",
    group: "code",
    input: text(`function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}`),
    note: "One fenced code block labelled javascript (or js), the code character for character with its indentation. Translated text keeps the code unchanged.",
  },
  {
    name: "one-line-command",
    group: "code",
    input: text(
      String.raw`Get-ChildItem -Path "C:\Program Files\Example App\logs" -Filter *.log -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 5`,
    ),
    note: "One fenced code block labelled powershell (or ps1/pwsh) holding the command exactly, backslashes and asterisk included. Not a paragraph. Translated text keeps the command unchanged.",
  },
  {
    name: "one-line-shell-comment",
    group: "code",
    input: text(`# export PATH="$HOME/.local/bin:$PATH"`),
    note: "One fenced code block labelled sh, bash or shell holding the line exactly, its leading # unescaped inside the fence. Not a heading, not an escaped paragraph. Translated text keeps the line unchanged.",
  },
  {
    name: "log-dump",
    group: "code",
    input: text(`2026-03-14 08:02:11 INFO  scheduler  Starting nightly export (job 4412)
2026-03-14 08:02:12 INFO  exporter   Reading 18234 rows from table orders_archive
2026-03-14 08:02:19 WARN  exporter   Row 9120 has an empty postcode; written as NULL
2026-03-14 08:02:27 ERROR uploader   Upload to bucket exports-demo failed: timeout after 30s
2026-03-14 08:02:57 INFO  uploader   Retry 1 of 3 succeeded
2026-03-14 08:02:58 INFO  scheduler  Export finished in 47s`),
    note: "One fenced block (no language, or text/log) with each log line on its own line, unchanged. Translated text leaves the log lines untranslated.",
  },
  {
    name: "config-file",
    group: "code",
    input: text(`[server]
host = "0.0.0.0"
port = 8080

[database]
url = "postgres://demo:demo@localhost:5432/garden"
pool_size = 10
# Seconds before an idle connection closes
idle_timeout = 300`),
    note: "One fenced block labelled toml (or ini) with every line, blank line and comment kept. Not a heading or list.",
  },
  {
    name: "lone-path",
    group: "literals",
    input: text(String.raw`D:\Projects\garden-planner\src\beds\raised_bed.ts`),
    note: "Inline code (single backticks) holding the path exactly, backslashes and underscore visible as typed. No fenced block, no prose added.",
  },
  {
    name: "lone-identifier",
    group: "literals",
    input: text("calculate_monthly_rainfall_total"),
    note: "Inline code holding the identifier exactly; the underscores show, nothing is italicized. Translated text keeps the identifier.",
  },
  {
    name: "lone-url",
    group: "literals",
    input: text("https://example.com/docs/getting-started?lang=en&page=2#install"),
    note: "Inline code (or the bare URL kept exact) holding the URL character for character, query and fragment included.",
  },
  {
    name: "identifiers-in-prose",
    group: "literals",
    input: text(`To reset the counter, call reset_total() before the loop starts.
The value is stored in MAX_RETRIES and read again by load_config when the app restarts.`),
    note: "Prose with the identifiers left as written: no backticks added around reset_total(), MAX_RETRIES or load_config. Underscores still render as underscores (escaped if needed), nothing turns italic.",
  },
  {
    name: "tab-separated-table",
    group: "table",
    input: text(
      "Plant\tSow indoors\tPlant out\tHarvest\nTomato\tMarch\tMay\tAugust\nRunner bean\tApril\tJune\tSeptember\nLettuce\tFebruary\tApril\tJune",
    ),
    note: "A GFM table with the header row Plant | Sow indoors | Plant out | Harvest and three data rows, every cell in its column.",
  },
  {
    name: "cjk-prose",
    group: "cjk",
    input: text(`社区花园每周六上午开放，欢迎附近的居民
带孩子一起来参加。上周我们在东侧的苗床种
下了番茄和豆角，下周计划搭建新的堆肥箱。

花园 第 3 页

如果你愿意帮忙浇水，请在入口处的登记表上
写下你的名字和方便的时间。`),
    note: "Two Chinese paragraphs with hard wraps rejoined and no stray spaces inserted between characters. The page footer '花园 第 3 页' is gone. Every character otherwise kept.",
  },
  {
    name: "one-line-phrase",
    group: "one-line",
    input: text("The meeting has been moved to Thursday afternoon."),
    note: "The sentence exactly as copied, as one paragraph. Nothing added.",
  },
  {
    name: "one-line-heading-marker",
    group: "one-line",
    input: text("# of seats left: 3 *after* the 2_000 early tickets"),
    note: "Shows exactly '# of seats left: 3 *after* the 2_000 early tickets' when rendered: not a heading, 'after' not italic, the asterisks and underscore visible (escaped as needed).",
  },
  {
    name: "one-line-dash-marker",
    group: "one-line",
    input: text(String.raw`- 5 degrees at night, so cover the *young* plants_ and C:\beds`),
    note: "Shows exactly '- 5 degrees at night, so cover the *young* plants_ and C:\\beds' when rendered: not a list item, 'young' not italic, the asterisks, underscore and backslash visible.",
  },
  {
    name: "app-window-screenshot",
    group: "image",
    input: { kind: "image", dataUrl: appWindow },
    note: "A heading 'Pond survey, spring' and the two body paragraphs, word for word. No title bar, menu, toolbar buttons, sidebar folders, search box or status bar text.",
  },
  {
    name: "code-screenshot",
    group: "image",
    input: { kind: "image", dataUrl: code },
    note: "One fenced block labelled python with the seven lines of count_frogs and their indentation. No line numbers.",
  },
  {
    name: "no-text-image",
    group: "image",
    input: { kind: "image", dataUrl: noText },
    note: "Outcome no-text (the model answered exactly NO_TEXT); no Source or Translated text.",
  },
];
