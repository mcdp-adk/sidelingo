// Task tests find elements as a user does and configure sidelingo through its UI (CODING_STANDARDS.md → User tasks).
// Allowed selectors: an accessible name (`aria/…`), a role (`[role=…]`, or a tag that is one, such as `button` or
// `p`), and visible text (`button=Copy`, `*=part`). Class, `#id`, any other attribute and XPath are refused, as is
// seeding or reading the settings document, which only a task about that document may do.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tasks = join(root, "e2e", "tasks");

/** A tag, a role attribute, or both, such as `[role=toolbar]` or `div[role="group"]`. */
const roleCompound = /^(?:[a-z][a-z0-9]*)?(?:\[role=(?:"[^"]*"|'[^']*'|[\w-]+)\])?$/i;

function selectorProblem(selector) {
  if (selector.startsWith("aria/")) return null;
  // WebdriverIO's text selectors: an optional tag, then `=` or `*=` and the visible text.
  if (/^[a-z0-9]*\*?=/i.test(selector)) return null;
  const compounds = selector.trim().split(/\s*[\s>+~,]\s*/);
  if (compounds.every((compound) => compound !== "" && roleCompound.test(compound))) return null;
  return `finds "${selector}"; use aria/<accessible name>, [role=…], a role's tag, or visible text`;
}

/** The selector strings passed to `$` and `$$`, with `${…}` placeholders filled in. */
function* selectorCalls(source) {
  const call = /(?<![\w$])\$\$?\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`|([^)\s]+))/g;
  for (const match of source.matchAll(call)) {
    const [, double, single, template, other] = match;
    const selector = double ?? single ?? template?.replace(/\$\{[^}]*\}/g, "x");
    yield { index: match.index, selector, other };
  }
}

/** The file's name, the harness's seeding helper, and `relaunch({ settings | settingsText })`. */
const settingsDocument = /settings\.json|\bcustomSettings\b|\brelaunch\([^)]*\bsettings(?:Text)?\b/g;

const problems = [];
const files = (await readdir(tasks, { recursive: true })).filter((name) => name.endsWith(".ts"));
if (files.length === 0) problems.push(`no task tests found in ${relative(root, tasks)}`);
for (const name of files) {
  const file = join(tasks, name);
  const source = await readFile(file, "utf8");
  const report = (index, problem) => {
    const line = source.slice(0, index).split("\n").length;
    problems.push(`${relative(root, file)}:${line}: ${problem}`);
  };
  for (const { index, selector, other } of selectorCalls(source)) {
    if (selector === undefined) report(index, `finds an element by \`${other}\`; pass the selector as a literal`);
    else {
      const problem = selectorProblem(selector);
      if (problem) report(index, problem);
    }
  }
  for (const match of source.matchAll(/\b(?:react|custom)\$\$?\(/g)) {
    report(match.index, `finds an element by component structure (\`${match[0]}\`)`);
  }
  for (const match of source.matchAll(settingsDocument)) {
    const use = match[0].replace(/^relaunch\(.*?(settings(?:Text)?)$/s, "relaunch({ $1 })");
    report(match.index, `uses the settings document (\`${use}\`); configure sidelingo through its UI`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${files.length} task test file(s) find elements as a user does.`);
