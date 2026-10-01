/** What one copy hands sidelingo; the Rust ↔ TypeScript interface's Input. */
export type Input = { kind: "text"; text: string };

/** A Round's progress, from its first update to its last. */
export interface RoundState {
  source: { text: string };
}

/**
 * The Round pipeline: runs one Round on `input`, yielding its state as it changes.
 * Text with no line break after trimming is its own Source text, with no call.
 */
export async function* run(input: Input): AsyncGenerator<RoundState> {
  const text = input.text.trim();
  // Multi-line text goes through Structuring, which #36 brings; until then it yields nothing.
  if (/[\r\n]/.test(text)) return;
  yield { source: { text } };
}
