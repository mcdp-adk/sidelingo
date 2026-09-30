# Copy the Translation prompt, write Structuring

sidelingo takes its prompts from two kinds of source. Translation copies Read Frog's `default` prompt verbatim. Structuring is sidelingo's own prompt, because Read Frog has no prompt that structures text or reads images. Each prompt lives in its own file whose header names the source repository, the pinned commit (`b4a45b9`), and whether the prompt is copied or original. Upstream changes are never picked up automatically; upgrading means diffing against a newer commit by hand.

## Considered Options

- **Adapt every prompt to one house style**: consistent, but gives up verbatim reuse of the Translation prompt, the reason for ADR 0001.
- **Track Read Frog automatically** (a submodule or a copy step at build time): picks up improvements for free, but lets upstream wording change sidelingo's behaviour without review, and Read Frog's prompt layout is not a stable interface.
- **Read Frog's `precision-rewrite` prompt**: reads more like native writing, but it rewrites sentence order, runs a longer prompt on every Round, and its silent review workflow can leak into output. sidelingo's Inputs are short to medium and often technical, where staying close to the Source text matters more than style.
