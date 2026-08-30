// The pre-turn intent classification: is this turn a QUESTION about the trip,
// or a request to CHANGE it?
//
// **Why this exists — the measurement, so nobody has to re-derive it.**
// Taken live on 2026-08-29 against the real /ask endpoint:
//
//   * The system instruction is ~570 tokens.
//   * Step 1's input, measured, is ~4,900 tokens.
//   * So the TOOL SCHEMAS are ~4,200 of the fixed per-step cost — roughly 85%
//     of it — and 12 of the 15 offered tools are write tools, ~3,400 tokens of
//     that.
//   * That cost is re-sent on EVERY step of EVERY turn, including the turns
//     that never write. Two turns the same evening ("How is the trip looking?",
//     "Which day has the most free time?") called zero write tools while
//     `uncalledTools` listed all twelve.
//   * On a real 3-step turn from that session: 4,827 + 5,539 + 8,039 = 18,405
//     input tokens today, against ~150 + 1,427 + 2,139 + 4,639 ≈ 8,355 with
//     classification — the extra ~150 being this call. About 55% of input
//     tokens on the common case.
//
// **Four rules, and the first one is load-bearing.**
//
//   1. **Bias to write on ANY uncertainty.** The two errors are not
//      symmetric. A question wrongly given write tools costs ~3,400 tokens. A
//      change request wrongly DENIED them cannot act at all — the user asks
//      for something to be added and gets prose about why nothing happened,
//      which is a broken interaction, not an expensive one. So anything
//      ambiguous, unparseable or errored gets the full set.
//   2. **It never widens access.** This selects WITHIN what the guard already
//      allows. `minimumRoleFor`/`offeredToolNamesFor` remain the authority;
//      `handleAskRequest` does not even call this for a viewer, because there
//      is no write half to withhold and paying for the call would be pure
//      waste.
//   3. **It fails open, toward the full tool set.** Throw, timeout,
//      unrecognised answer — all of them proceed with read + write. A cost
//      optimisation must never be able to break a turn, so this function is
//      total: it does not throw, and every caller can treat it as such.
//   4. **It goes through the model the turn already selected**, which came
//      from `selectAiModel()` — one kill-switch chokepoint, no second gateway
//      client (ADR-019's 2026-08-25 amendment, enforced by the lint wall in
//      apps/web/eslint.config.mjs).
//
// The extra round-trip is accepted (Mitchell raised it himself: "it would mean
// every call adds one extra step"). It is kept cheap the only way that works —
// no tools at all, a minimal instruction, and an output ceiling of one word.
import { generateText, type LanguageModel } from "ai";
import { sanitizeForLog, type AskIntentRecord, type AskUsage } from "@/server/ai/askAnalytics";

export type AskIntent = AskIntentRecord["intent"];

// The line that tells `simulatedModel` this is a classification call and not a
// turn — the same trick, and the same reasoning, as `ASK_SCOPE_PREFIX` in
// context.ts: the instruction is the only channel that reaches both a real
// model and the simulated one, so writer and reader live in one module and
// cannot drift apart. Without it the flag-off path (which is every Vercel
// environment) would answer a classification call with `read_trip`, fail open
// on every turn, and quietly buy nothing.
export const ASK_INTENT_MARKER = "Answer with one word: question or write.";

/**
 * The whole instruction. Deliberately short — it is re-sent on every turn, and
 * its entire job is a binary verdict.
 *
 * The tie-break is spelled out to the model rather than left to the parser,
 * because a model that says "write" when unsure is one round-trip cheaper than
 * one that says something unparseable and makes us fail open anyway.
 */
export const ASK_INTENT_INSTRUCTION = [
  "You classify one message sent to a trip-planning assistant. You do not answer it.",
  'Answer "write" if the message asks for the trip to be changed, or asks what to add, plan, book, move or remove.',
  'Answer "question" if it only asks about the trip as it already is.',
  'If you are unsure, answer "write".',
  ASK_INTENT_MARKER,
].join("\n");

/** True for the classification instruction above. Read by `simulatedModel`. */
export function isAskIntentCall(instructions: string): boolean {
  return instructions.includes(ASK_INTENT_MARKER);
}

// One word plus slack for a model that adds punctuation or a stray token. Low
// enough that a model which starts explaining itself is cut off rather than
// paid for — the cut-off answer still parses, because the verdict is the first
// word.
const MAX_VERDICT_TOKENS = 8;

// A ceiling on how long a cost optimisation may delay an answer. Beyond this
// the classification is worth less than the latency it is adding, so the turn
// proceeds with the full tool set — the same fail-open branch a throw takes.
const CLASSIFY_TIMEOUT_MS = 4_000;

/**
 * Classify one turn. Never throws; never widens what the caller may offer.
 *
 * @param model  The model `selectAiModel()` already chose for this turn.
 * @param question  The user's latest message, verbatim.
 * @param signal  The request's own signal, so a client that hangs up during
 *   classification stops it rather than paying for it. Combined with the
 *   timeout, not replaced by it.
 */
export async function classifyAskIntent(
  model: LanguageModel,
  question: string,
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<AskIntentRecord> {
  const startedAt = now();
  const timeout = AbortSignal.timeout(CLASSIFY_TIMEOUT_MS);
  try {
    const result = await generateText({
      model,
      system: ASK_INTENT_INSTRUCTION,
      prompt: question,
      // No `tools` key at all, which is the entire point: an empty tool set is
      // not the same message as no tool set, and the ~4,200 tokens this is
      // here to avoid are the schemas.
      maxOutputTokens: MAX_VERDICT_TOKENS,
      abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const verdict = sanitizeForLog(result.text.trim(), MAX_LOGGED_VERDICT_CHARS);
    return {
      intent: parseIntent(verdict),
      verdict,
      // "Unrecognised" and "said write" are both recorded as write, but only
      // one of them is a fail-open — telling them apart is how a drifting
      // classifier becomes visible instead of just becoming expensive.
      failedOpen: !isRecognised(verdict),
      latencyMs: now() - startedAt,
      usage: usageOf(result),
    };
  } catch (err) {
    return {
      intent: "write",
      verdict: `classification failed: ${sanitizeForLog(err instanceof Error ? err.message : safeString(err), MAX_LOGGED_VERDICT_CHARS)}`,
      failedOpen: true,
      latencyMs: now() - startedAt,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
  }
}

// Long enough to see a model that answered with a sentence instead of a word —
// which is the failure this field is for — and short enough that it stays a
// field rather than a payload.
const MAX_LOGGED_VERDICT_CHARS = 120;

// Letters only, so `Question.` and `QUESTION` read the same as `question`. The
// leniency stops at the word: a verdict that is not exactly one of the two
// recognised words is not interpreted, it fails open.
function normalize(verdict: string): string {
  return verdict.toLowerCase().replace(/[^a-z]/g, "");
}

function isRecognised(verdict: string): boolean {
  const word = normalize(verdict);
  return word === "question" || word === "write";
}

// Only an exact `question` narrows the tool set. Everything else — `write`,
// a paragraph, an empty string — is the full set, which is rule 1.
function parseIntent(verdict: string): AskIntent {
  return normalize(verdict) === "question" ? "question" : "write";
}

function usageOf(result: { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }): AskUsage {
  return {
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    totalTokens: result.usage?.totalTokens ?? null,
  };
}

// `String(err)` can itself throw — a null-prototype rejection has no
// `toString`. The catch above exists so a classification failure cannot break
// a turn; it would be a poor joke if describing the failure did.
function safeString(err: unknown): string {
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}
