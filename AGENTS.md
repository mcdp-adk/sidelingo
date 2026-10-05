# sidelingo

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `mcdp-adk/sidelingo`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Invariants

- Changes reach `main` through a PR unless the owner asks for a direct commit.
- Every ticked acceptance criterion has evidence, and an issue closes only with every criterion ticked.
- Only the owner rewords an acceptance criterion; an agent proposes the new wording in conversation.
- Evidence cites commits reachable from the PR or `main`, and states its results on GitHub. Captures and logs stay local, unnamed by path.
- A PR for an issue starts with `Closes #N` when it finishes the issue, or `Refs #N` when it doesn't.
- While working, test a change at the layer that owns it (ADR 0006); the task layer runs in full once, before merge.
- A PR that changes code merges only after the task layer (`pnpm test:e2e`) passes locally, with the run shown in the PR. CI runs the rest.
