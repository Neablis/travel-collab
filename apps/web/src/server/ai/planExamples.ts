// Server-only: never import from UI code (reaches the embedding provider and
// the database). Part 4 of the RAG stack: serving retrieved example days to
// plan turns, behind the RAG_PLAN_RETRIEVAL flag, fail-open end to end.
//
// The shape of a plan turn with examples is:
//
//   question -> embedText -> retrieveDayChunks -> formatExampleBlocks -> prompt
//
// and every arrow in that chain can return "no examples" without breaking the
// turn. `getPlanExamples` is the whole chain with its timeout; the two pure
// helpers below shape its input (prompt blocks) and its bookkeeping output
// (which examples the final text leaned on, best-effort).
import { data, rule, type PromptBlock } from "@/server/assistant/prompt";
import { embedText } from "@/server/ai/embeddings";
import { retrieveDayChunks, type DayChunk } from "@/server/ai/retrieval";
import { serverConfig } from "@/server/config";
// Re-exported so the serving path (`handleAskRequest.ts`) names the type
// through this module, the RAG serving seam, rather than reaching past it
// into the retrieval helper.
export type { DayChunk };

/**
 * The turn-level budget for plan-turn example retrieval, in milliseconds.
 * `embedText` has its own (larger) provider timeout; this is the caller's
 * budget, per the note on `retrieveDayChunks`: the serving path owns the
 * clock, the helpers own the failure modes. A plan turn that cannot find
 * examples in this long plans from scratch, exactly as it does today.
 */
const PLAN_EXAMPLE_BUDGET_MS = 2_000;

/**
 * The example days for a plan turn: embed the request, run the hybrid
 * retrieval, return up to `serverConfig.ragPlanExampleCount` day-chunks.
 *
 * Retrieval fetches the full candidate set; only
 * {@link selectPromptExamples} decides how many reach the prompt, so the
 * serving logs keep the wider recall picture while the model sees the
 * token-cheap top few.
 * **The contract is fail-open, like the two helpers it chains.** This
 * function never throws and returns `[]` on every failure, each logged with
 * the `rag:` prefix:
 * - the flag is off — checked first, so no embedding call and no database
 *   query is made (the M48 exit gate's "same prompt as today" half);
 * - the request could not be embedded (`embedText` returned null);
 * - retrieval returned nothing (`retrieveDayChunks` is itself fail-open);
 * - the whole chain exceeded the turn-level budget (`timeoutMs`), which
 *   aborts the WAIT, not the underlying provider calls.
 *
 * A programmer error below (`embedText`'s empty-text throw) is also caught
 * here rather than surfacing: a turn must never be more expensive for having
 * tried.
 *
 * @param question The plan request, embedded as-is.
 * @param userId The asker, for the retrieval's privacy filter. A string on
 * the signed-in path; null sees only public examples.
 * @param timeoutMs The turn-level budget. A param, not a constant, so a
 * test can shrink it without waiting out the real one.
 * @returns The example days, or `[]` on any failure (logged).
 */
export async function getPlanExamples({
  question,
  userId,
  timeoutMs = PLAN_EXAMPLE_BUDGET_MS,
}: {
  question: string;
  userId: string | null;
  timeoutMs?: number;
}): Promise<DayChunk[]> {
  // The flag's first half: off means no lookup at all — no embedding call,
  // no database query — so a plan turn sends the model today's prompt.
  if (!serverConfig.ragPlanRetrieval) return [];
  try {
    const examples = await Promise.race([
      (async () => {
        const embedding = await embedText(question);
        // Fail-open: the provider could not be reached in time, and the turn
        // plans from scratch.
        if (embedding === null) return [];
        return retrieveDayChunks({
          queryEmbedding: embedding,
          queryText: question,
          userId,
          k: serverConfig.ragPlanExampleCount,
        });
      })(),
      new Promise<DayChunk[]>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("rag: plan example retrieval timed out")), timeoutMs);
        // The race settles first in the success case; an unref'd timer must
        // never keep the process alive after that.
        timer.unref?.();
      }),
    ]);
    return examples;
  } catch (error) {
    // Fail-open: embedding threw (a programmer error, e.g. an empty
    // question), retrieval threw past its own catch, or the budget ran out.
    // The log is the record; the turn goes on without examples.
    console.error("rag: plan example lookup failed, continuing without examples", { error });
    return [];
  }
}

/**
 * The retrieved examples narrowed to what the prompt may carry: the top
 * `serverConfig.ragPlanExamplePromptCount` by retrieval rank. Retrieval
 * fetches the wider set (recall for the logs, candidates for tuning); the
 * prompt gets the few the model actually reads. Gate 2 showed 5 examples at
 * ~1500 input tokens with no output-token win — 3 shorter ones keep the
 * quality signal at ~40% of that input cost.
 *
 * Pure and total: `[]` in, `[]` out. The serving path applies this once and
 * passes the result to both the prompt blocks and the used-detection, so the
 * "used" heuristic only ever checks text the model actually saw.
 *
 * @param examples The days `getPlanExamples` returned, best first.
 * @returns At most `ragPlanExamplePromptCount` of them, order kept.
 */
export function selectPromptExamples(examples: DayChunk[]): DayChunk[] {
  return examples.slice(0, serverConfig.ragPlanExamplePromptCount);
}

/**
 * The retrieved examples as prompt blocks: one server-authored `rule` and
 * one `data` block, appended after the turn's existing instruction.
 *
 * The example text is outside text (ADR-043) — written by other users, in
 * other trips — so it arrives as a `data` block, never as a `rule`. The
 * `rule` beside it says the two things the turn needs said: adapt, never
 * copy verbatim, keep the plan tight (the examples are structure, not
 * material to restate), and the user's request wins over any example.
 *
 * Each example's text is truncated to `serverConfig.ragPlanExampleChars`
 * characters — token-efficient, not lossless.
 *
 * @param examples The days to format — normally the output of
 * {@link selectPromptExamples}, not the raw retrieval set. `[]` returns `[]`,
 * which is what keeps a flag-off turn's prompt byte-identical to today's.
 * @returns One `rule` block and one `data` block, or `[]` with no examples.
 */
export function formatExampleBlocks(examples: DayChunk[]): PromptBlock[] {
  if (examples.length === 0) return [];
  const compact = examples.map((example) => ({
    city: example.city,
    country: example.countryCode,
    tags: example.tags,
    // Code points, not UTF-16 units: a plain slice(0, n) can split a
    // surrogate pair when an emoji lands exactly on the boundary, leaving a
    // lone surrogate in the prompt.
    text: [...example.chunkText].slice(0, serverConfig.ragPlanExampleChars).join(""),
  }));
  return [
    rule(
      "Adapt from the example days below when they fit; never copy them verbatim. Keep the plan tight — use the examples for structure and inspiration, not as material to restate at length. The user's request wins over any example.",
    ),
    data("Example days from other trips (adapt, don't copy):", compact),
  ];
}

/** The word-run length that counts as "used" an example. Eight words is a full sentence's worth. */
const USED_EXAMPLE_WORDS = 8;

/**
 * Best-effort answer to "which of the retrieved examples did the turn's
 * final text lean on": the ids of examples where the output contains a
 * distinctive {@link USED_EXAMPLE_WORDS}-word verbatim run from the chunk's
 * text.
 *
 * **A heuristic, not a citation.** Matching is case- and
 * punctuation-insensitive (both sides are normalized before comparing), and
 * a generic phrase that happens to appear in both counts as a hit — there is
 * no distinctiveness measure. It is bookkeeping for the serving logs ("did
 * the model actually draw on what we gave it?"), never an authorization or a
 * billing input, and it must never throw.
 *
 * @param examples The days the turn retrieved.
 * @param outputText The turn's final text.
 * @returns The ids of the examples the output appears to use, in retrieval order.
 */
export function detectUsedExamples(examples: DayChunk[], outputText: string): string[] {
  const normalizedOutput = normalize(outputText);
  if (normalizedOutput === "") return [];
  return examples
    .filter((example) => containsVerbatimRun(normalizedOutput, example.chunkText, USED_EXAMPLE_WORDS))
    .map((example) => example.id);
}

/**
 * Case and punctuation to lowercase letters-and-digits words: the verbatim
 * check compares word runs, so "Morning," and "morning" are the same word
 * and an em dash is a word boundary.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Whether `normalizedHaystack` contains any `runLength`-word window from
 * `text` verbatim. Step-1 sliding windows: an 8-word run starting at any
 * offset must be found, so the stride cannot skip one. Total — the
 * normalizations above cannot throw, and `String.includes` cannot either.
 */
function containsVerbatimRun(normalizedHaystack: string, text: string, runLength: number): boolean {
  const words = normalize(text).split(" ");
  if (words.length < runLength) return false;
  for (let i = 0; i + runLength <= words.length; i += 1) {
    if (normalizedHaystack.includes(words.slice(i, i + runLength).join(" "))) return true;
  }
  return false;
}
