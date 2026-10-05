// An issue closes only with every acceptance criterion ticked (AGENTS.md). A PR closes its issues on merge whether
// or not they are ticked, so this check refuses a PR that would close an issue with an unticked box.
// CI runs it with the pull_request event; locally, pass the PR number and have `gh auth token` in GITHUB_TOKEN.
import { readFile } from "node:fs/promises";

const [owner, name] = (process.env.GITHUB_REPOSITORY ?? "mcdp-adk/sidelingo").split("/");
const number = Number(
  process.argv[2] ?? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request.number,
);

// GitHub's own list of the issues this PR closes: its closing keywords and any issue linked to it by hand.
const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  body: JSON.stringify({
    query: `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) { closingIssuesReferences(first: 50) { nodes { number body } } }
      }
    }`,
    variables: { owner, name, number },
  }),
});
const { data, errors } = await response.json();
if (!response.ok || errors) throw new Error(`GitHub answered ${response.status}: ${JSON.stringify(errors)}`);
const issues = data.repository.pullRequest.closingIssuesReferences.nodes;

const problems = issues.flatMap((issue) =>
  issue.body
    .split("\n")
    .filter((line) => /^\s*[-*] \[ \]/.test(line))
    .map((line) => `#${issue.number}: ${line.trim()}`),
);

if (problems.length > 0) {
  console.error(
    "This PR closes issues with unticked acceptance criteria. Tick each with its evidence, then re-run this check:",
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `Every criterion is ticked in the issues this PR closes (${issues.map((issue) => `#${issue.number}`).join(", ") || "none"}).`,
);
