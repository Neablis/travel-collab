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
//   3. **It fails open, toward the full tool set.** Throw, timeout, abort, a
//      structured field the model never filled — all of them proceed with
//      read + write. A cost optimisation must never be able to break a turn,
//      so this function is total: it does not throw, and every caller can
//      treat it as such.
//   4. **It goes through a model `selectAiModel()` handed the caller** —
//      `ModelSelection.classifierModel`, which may be a DIFFERENT model id
//      from the one that answers (`AI_CLASSIFIER_MODEL`) but is still built at
//      the one kill-switch chokepoint, with no second gateway client (ADR-019's
//      2026-08-25 amendment, enforced by the lint wall in
//      apps/web/eslint.config.mjs).
//
// The extra round-trip is accepted (Mitchell raised it himself: "it would mean
// every call adds one extra step"). It is kept cheap the only way that works —
// no tools at all, and a minimal instruction.
//
// **The verdict is a SCHEMA, not a parsed string, and that is the correctness
// fix (KI-88).** It used to be free text capped at 8 output tokens, which made
// this function's correctness depend on the configured model's output *style*.
// Observed live on 2026-08-29 with `ai-live` on and `AI_MODEL` pointed at
// `deepseek/deepseek-v4-flash-0731`: "What day risks being too draining or
// complicated?" — an unambiguous question — came back `intent: "write"`,
// `verdict: ""`, `failedOpen: true`, because the model spent the whole 8-token
// budget on reasoning and emitted no text at all. Step 1 then cost 4,906
// tokens: the full 15-tool payload, the entire saving gone, and no error
// anywhere. A reasoning model still populates structured output *after* it
// reasons, which is the whole point of asking for a typed field instead of a
// word.
import { generateText, Output, type LanguageModel } from "ai";
import { sanitizeForLog, type AskIntentRecord, type AskUsage } from "@/server/ai/askAnalytics";

export type AskIntent = AskIntentRecord["intent"];

// The line that tells `simulatedModel` this is a classification call and not a
// turn — the same trick, and the same reasoning, as `ASK_SCOPE_PREFIX` in
// context.ts: the instruction is the only channel that reaches both a real
// model and the simulated one, so writer and reader live in one module and
// cannot drift apart. Without it the flag-off path (which is every Vercel
// environment) would answer a classification call with `read_trip`, fail open
// on every turn, and quietly buy nothing.
const ASK_INTENT_MARKER = "Set intent to question or write.";

/**
 * The whole instruction. Deliberately short — it is re-sent on every turn, and
 * its entire job is a binary verdict.
 *
 * The tie-break is spelled out to the model rather than left to the schema,
 * because `intent` is a required enum: a model that has no rule for "unsure"
 * picks one anyway, and we would rather it picked the safe one than the
 * likelier one.
 */
export const ASK_INTENT_INSTRUCTION = [
  "You classify the LAST message sent to a trip-planning assistant. You do not answer it.",
  "Earlier messages are context only. A short reply like \"yes\" means whatever was just offered, so classify what it agrees to.",
  'Use "write" if the message asks for the trip to be changed, agrees to a change that was offered, or asks what to add, plan, book, move or remove.',
  'Use "question" if it only asks about the trip as it already is.',
  'If you are unsure, use "write".',
  ASK_INTENT_MARKER,
].join("\n");

/** True for the classification instruction above. Read by `simulatedModel`. */
export function isAskIntentCall(instructions: string): boolean {
  return instructions.includes(ASK_INTENT_MARKER);
}

/**
 * The verdict, as a typed field the model fills rather than a word we parse.
 *
 * `Output.choice` asks the provider for JSON matching `{ result: enum }` and
 * validates the answer against that enum before `generateText` returns, so an
 * off-enum or unparseable answer arrives here as a THROW — which is already
 * the fail-open branch. Nothing downstream normalises casing or strips
 * punctuation any more, because nothing downstream sees prose.
 *
 * Exported so `simulatedModel` can emit a verdict in the same shape rather
 * than hard-coding the SDK's wire format at a second site — the same
 * writer-and-reader-in-one-module rule `ASK_INTENT_MARKER` follows.
 */
const INTENT_CHOICES: AskIntent[] = ["question", "write"];
const INTENT_OUTPUT = Output.choice({
  options: INTENT_CHOICES,
  name: "intent",
  description: "Whether the last message asks about the trip (question) or asks for it to change (write).",
});

/** One classification verdict, in the wire shape `INTENT_OUTPUT` parses. */
export function askIntentVerdictText(intent: AskIntent): string {
  return JSON.stringify({ result: intent });
}

// The output budget, and it is NOT a one-word ceiling any more.
//
// The old value was 8 — one word plus slack — and that is precisely what
// KI-88 turned out to be: a reasoning model spends its output budget on
// reasoning tokens before it emits anything, so it hit the ceiling having said
// nothing and the classifier failed open on every turn. A budget that only
// fits the answer cannot survive a model that thinks first, and which model is
// configured is one environment variable away from changing.
//
// So this is a COST ceiling rather than a style ceiling: generous enough for a
// short reasoning preamble plus the ~10 tokens of `{"result":"question"}`, and
// still a bound so a runaway model cannot bill without limit. The real bound
// on both spend and latency is `CLASSIFY_TIMEOUT_MS` below; output tokens at
// this scale are a rounding error against the ~3,400 input tokens a narrowed
// step saves. Hitting the ceiling mid-answer is still safe — the step ends on
// `length`, the structured field is never populated, and rule 1 applies.
const MAX_VERDICT_TOKENS = 512;

// A ceiling on how long a cost optimisation may delay an answer. Beyond this
// the classification is worth less than the latency it is adding, so the turn
// proceeds with the full tool set — the same fail-open branch a throw takes.
const CLASSIFY_TIMEOUT_MS = 4_000;

/**
 * One earlier message, as the classifier is shown it.
 */
export interface AskIntentContextMessage {
  role: "user" | "assistant";
  text: string;
}

// How much of one earlier message the classifier is shown.
//
// The context exists to resolve an affirmation, and what resolves one is the
// SUBJECT of what was just offered — which is in the opening sentence of the
// assistant's answer ("I've drafted 2 changes for day 3…") and of the user's
// own request. So: the head of each message, two messages, 300 characters
// each. At the ~3 chars/token this payload measures at, that is ~200 tokens
// worst case on top of the ~150-token call — about 10% of the ~3,378 tokens a
// narrowed step saves, and only on follow-up turns. Whole turns would have
// eaten the saving outright: the assistant's answers run to paragraphs.
const MAX_CONTEXT_CHARS_PER_MESSAGE = 300;

// Short, bare agreement — the belt to the classifier's braces.
//
// The 2026-08-29 live thread is the case: a long request that read the trip
// and proposed nothing, then "Yes go ahead", which did all ten writes. Three
// bare words are not classifiable in isolation, and a model answering
// "question" to them is being reasonable, not broken — so fail-open does not
// cover it, because nothing failed. A rule does.
//
// Deliberately a word SET and a length ceiling rather than a parser: every
// word must be an agreement word and there may be at most six of them, so
// "Yes go ahead" matches and "yes, but move the temple to day 4 first" does
// not (it is longer, and `move`/`temple` are not in the set — it would reach
// the model, which is the right place for it).
//
// The cost of being wrong here is tokens and nothing else, which is why the
// set is allowed to be loose. Extend it by adding words.
const AGREEMENT_WORDS = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "ya",
  "ok",
  "okay",
  "k",
  "sure",
  "please",
  "do",
  "it",
  "that",
  "them",
  "all",
  "go",
  "ahead",
  "for",
  "sounds",
  "looks",
  "good",
  "great",
  "perfect",
  "nice",
  "lovely",
  "thanks",
  "thank",
  "you",
  "confirm",
  "confirmed",
  "approve",
  "approved",
  "apply",
  "proceed",
  "continue",
  "and",
  "then",
  "lets",
  "let",
  "us",
]);

const MAX_AGREEMENT_WORDS = 6;

/** True for a short, bare agreement — see `AGREEMENT_WORDS`. */
export function isBareAgreement(message: string): boolean {
  const words = message
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.length <= MAX_AGREEMENT_WORDS && words.every((word) => AGREEMENT_WORDS.has(word));
}

/**
 * What the classifier is shown, as one user message.
 *
 * Inlined into a single message rather than sent as a real multi-message
 * prompt, for two reasons: the SDK call shape stays identical (one system,
 * one user), and `simulatedModel` — which reads the latest user message —
 * sees the context too, so the flag-off path classifies a follow-up with the
 * same information a live model gets.
 */
function askIntentPrompt(question: string, context: readonly AskIntentContextMessage[]): string {
  if (context.length === 0) return question;
  return [
    "Earlier in the conversation:",
    ...context.map((message) => `${message.role}: ${truncate(message.text, MAX_CONTEXT_CHARS_PER_MESSAGE)}`),
    "",
    "The message to classify:",
    question,
  ].join("\n");
}

function truncate(text: string, max: number): string {
  const flat = text.trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Classify one turn. Never throws; never widens what the caller may offer.
 *
 * @param model  The classifier model `selectAiModel()` chose for this turn
 *   (`ModelSelection.classifierModel`) — possibly a different, cheaper model
 *   id than the one answering, never a second gateway client.
 * @param question  The user's latest message, verbatim.
 * @param context  The messages immediately before it, oldest first. An
 *   affirmation ("Yes go ahead") is unclassifiable without them, and that turn
 *   is exactly the one that writes.
 * @param signal  The request's own signal, so a client that hangs up during
 *   classification stops it rather than paying for it. Combined with the
 *   timeout, not replaced by it.
 */
export async function classifyAskIntent(
  model: LanguageModel,
  question: string,
  context: readonly AskIntentContextMessage[] = [],
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<AskIntentRecord> {
  const startedAt = now();

  // The rule runs FIRST, and skips the call entirely — it is both safer than
  // the model (it cannot answer "question" to "Yes go ahead") and cheaper
  // (no round-trip at all on the turn that agrees).
  if (isBareAgreement(question)) {
    return {
      intent: "write",
      source: "affirmation",
      model: null,
      verdict: "bare agreement — no model call",
      context: null,
      failedOpen: false,
      latencyMs: now() - startedAt,
      usage: NO_USAGE,
    };
  }

  const prompt = askIntentPrompt(question, context);
  // The WHOLE prompt, question included, rather than the context alone. It
  // duplicates `question` on the record by a few hundred characters, and that
  // is the point: this field's job is to show the classifier's exact input,
  // and an input reassembled at read time from two fields is a reconstruction
  // that can be wrong about ordering, truncation and framing — which is
  // exactly what a reader is trying to rule out.
  const loggedContext = prompt === question ? null : sanitizeForLog(prompt, MAX_LOGGED_CONTEXT_CHARS);
  const timeout = AbortSignal.timeout(CLASSIFY_TIMEOUT_MS);
  // Hoisted out of the try so the fail-open branch can still report what the
  // model said and what it cost. A verdict the schema rejected is exactly the
  // case a reader needs the raw text for, and a reasoning model that burned
  // its budget without answering is exactly the case that must not report
  // zero spend (KI-88 read as free precisely because it did).
  let emitted: string | null = null;
  let usage: AskUsage = NO_USAGE;
  try {
    const result = await generateText({
      model,
      system: ASK_INTENT_INSTRUCTION,
      prompt,
      // No `tools` key at all, which is the entire point: an empty tool set is
      // not the same message as no tool set, and the ~4,200 tokens this is
      // here to avoid are the schemas. Adding context did not change that —
      // the context is prose, and prose is cheap. The output schema is tens of
      // tokens, not thousands.
      output: INTENT_OUTPUT,
      maxOutputTokens: MAX_VERDICT_TOKENS,
      abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // Names this call in Sentry's AI Agents view (ADR-032). It matters more
      // here than anywhere else in the app: this is a SECOND round-trip on
      // every editor turn, possibly on a different model id
      // (`AI_CLASSIFIER_MODEL`), and unnamed it is indistinguishable from the
      // turn it is supposed to be saving money on — which makes the one
      // comparison this whole file exists to enable impossible to draw.
      telemetry: { functionId: "classify_intent" },
    });
    emitted = result.text.trim();
    usage = usageOf(result);
    // Read INSIDE the try, deliberately: `result.output` throws when the step
    // did not finish cleanly enough to populate the field — a budget consumed
    // by reasoning tokens ends on `length` and lands here — so "the model
    // never filled it in" joins the throw, the timeout and the abort in one
    // fail-open branch rather than needing a second one.
    const intent = result.output;
    return {
      intent,
      source: "model",
      model: modelIdOf(model),
      // The raw JSON the model returned, not the parsed enum: `intent` already
      // carries the parsed value, and this field's job is to stay diagnosable
      // when the two disagree.
      verdict: sanitizeForLog(emitted, MAX_LOGGED_VERDICT_CHARS),
      context: loggedContext,
      failedOpen: false,
      latencyMs: now() - startedAt,
      usage,
    };
  } catch (err) {
    return {
      intent: "write",
      source: "model",
      model: modelIdOf(model),
      verdict: failureVerdict(err, emitted),
      context: loggedContext,
      failedOpen: true,
      latencyMs: now() - startedAt,
      usage,
    };
  }
}

const NO_USAGE: AskUsage = { inputTokens: null, outputTokens: null, totalTokens: null };

// A LanguageModel is either a bare model-id string or a provider model object
// carrying `.modelId` — the same normalisation handleAskRequest does for the
// answer model, duplicated rather than imported because that module imports
// this one.
function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

/**
 * Why the classifier failed open, and — when it can be recovered — what the
 * model actually emitted.
 *
 * The text is worth the trouble because it is the whole diagnosis of a model
 * whose output style broke this. `generateText` validates the structured field
 * before it returns, so on a schema failure there is no result to read it from;
 * the SDK's `NoObjectGeneratedError` carries the offending text instead.
 */
function failureVerdict(err: unknown, emitted: string | null): string {
  const reason = err instanceof Error ? err.message : safeString(err);
  const text = emitted || textOfError(err);
  return sanitizeForLog(
    text ? `classification failed: ${reason} — model emitted: ${text}` : `classification failed: ${reason}`,
    MAX_LOGGED_VERDICT_CHARS,
  );
}

function textOfError(err: unknown): string | null {
  const text = (err as { text?: unknown } | null | undefined)?.text;
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
}

// The whole classifier input, so a reader can see exactly what produced a
// verdict. Bounded by what it already is: two messages of 300 characters plus
// the question, which cannot reach 1000 without the question being long — and
// a long question is not the case this field exists to explain.
const MAX_LOGGED_CONTEXT_CHARS = 1000;

// Long enough to see the whole `{"result":"…"}` object, and enough of a
// failure's message plus the text that caused it to name the problem — which
// is the failure this field is for — while staying a field rather than a
// payload.
const MAX_LOGGED_VERDICT_CHARS = 120;

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
