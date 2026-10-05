// An issue closes only with every acceptance criterion ticked (AGENTS.md). A PR's closing keywords close their issues
// on merge whether or not they are ticked, so this check refuses a PR that would close an issue with an unticked box.
// CI runs it with the pull_request event; locally, pass the PR number and have `gh auth token` in GITHUB_TOKEN.
import { readFile } from "node:fs/promises";

const repository = process.env.GITHUB_REPOSITORY ?? "mcdp-adk/sidelingo";
const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}` };

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
  return response.json();
}

const pullRequest = process.argv[2]
  ? await github(`pulls/${process.argv[2]}`)
  : JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request;

// GitHub's closing keywords, followed by an issue in this repository.
const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi;
const issues = [...new Set([...(pullRequest.body ?? "").matchAll(closing)].map((match) => Number(match[1])))];

const problems = [];
for (const number of issues) {
  const issue = await github(`issues/${number}`);
  const unticked = (issue.body ?? "").split("\n").filter((line) => /^\s*[-*] \[ \]/.test(line));
  for (const line of unticked) problems.push(`#${number}: ${line.trim()}`);
}

if (problems.length > 0) {
  console.error(
    "This PR closes issues with unticked acceptance criteria. Tick each with its evidence, then re-run this check:",
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `Every criterion is ticked in the issues this PR closes (${issues.map((n) => `#${n}`).join(", ") || "none"}).`,
);
