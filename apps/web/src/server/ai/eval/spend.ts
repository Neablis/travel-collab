// **What an eval turn cost, in the ledger's own arithmetic** (M33).
//
// Every eval turn is a paid model call, and a run is a loop of them; on
// 2026-10-05 a day of runs spent $0.25 without one saying so first (Mitchell:
// "we should be really clear when we are running eval loops"). The runner caps
// a run on this number and prints it, so it must be the same price the cost
// console would put on the same turn: `microUsdForSteps` for the agent's steps
// at the model each ran on, and `microUsdFor` for the classifier's round-trip.
// No second pricing rule lives here.
//
// **A part that reported no usage is charged an estimate, never nothing**
// (KI-2026-10-13-c). The ledger's own price is null for it — unmeasured is not
// free — but the cap is the run's one guard on paid spend, and a null used to
// add $0 to it: a 3-step Opus turn went by as "unpriced" and the run reported
// $0.38 against about $0.47 spent. Here such a part is priced at the model's
// rate on a generous guess, and the turn says which part it guessed.
import type { TurnLedger } from "@/server/assistant/ledger";
import { MAX_STEP_OUTPUT_TOKENS } from "@/server/ai/handleAskRequest";
import { microUsdFor, rateAt } from "@/server/entitlements/modelRates";

/**
 * The input charged to a part that reported none, when the turn offers
 * nothing better to go on: no step reported its input, and neither did the
 * turn. Above any turn the live set has measured (the long trip's ceiling is
 * 30,000), so a guess errs towards stopping the run early.
 */
export const UNREPORTED_INPUT_TOKENS = 100_000;

/** What one eval turn is charged against the cap. */
export interface TurnSpend {
  /**
   * Micro-dollars: exact where every part reported its usage, an estimate
   * where one did not (`estimated`). Null only where a part's model has no
   * rate, which a run must opt into (`EVAL_ALLOW_UNPRICED`).
   */
  microUsd: number | null;
  /** One line per part that reported no usage, naming it and what it was charged. Empty when all were measured. */
  estimated: string[];
}

/**
 * One turn's spend. A step that reported no input is charged the most the
 * turn could have spent on it: the larger of the turn's input no step accounts
 * for and the largest input any step reported (a later step re-reads every
 * earlier one, so steps only grow), or `UNREPORTED_INPUT_TOKENS` when neither
 * exists. No output is charged as the agent's per-step ceiling,
 * `MAX_STEP_OUTPUT_TOKENS`. A guessed input is priced as fresh, never cached.
 */
export function turnSpend(ledger: TurnLedger, at: Date): TurnSpend {
  const estimated: string[] = [];
  const reportedIn = ledger.stepSpend.flatMap((step) => (step.tokensIn === null ? [] : [step.tokensIn]));
  const turnIn = ledger.cost.turn.tokensIn;
  const unattributedIn = turnIn === null ? 0 : Math.max(0, turnIn - reportedIn.reduce((sum, n) => sum + n, 0));
  const largestIn = Math.max(unattributedIn, ...reportedIn);
  const guessIn = largestIn > 0 ? largestIn : UNREPORTED_INPUT_TOKENS;

  const charge = (part: string, model: string, tokensIn: number | null, tokensOut: number | null, inputGuess: number, cacheRead: number | null, cacheWrite: number | null) => {
    const chargedIn = tokensIn ?? inputGuess;
    const chargedOut = tokensOut ?? MAX_STEP_OUTPUT_TOKENS;
    if (tokensIn === null || tokensOut === null) {
      const missing = tokensIn === null && tokensOut === null ? "no usage" : tokensIn === null ? "no input tokens" : "no output tokens";
      estimated.push(`${part} (${model}) reported ${missing}; charged ${chargedIn} in / ${chargedOut} out`);
    }
    return microUsdFor(model, chargedIn, chargedOut, at, undefined, tokensIn === null ? 0 : cacheRead, tokensIn === null ? 0 : cacheWrite);
  };

  let total = 0;
  for (const step of ledger.stepSpend) {
    const cost = charge(`step ${step.index + 1}`, step.model, step.tokensIn, step.tokensOut, guessIn, step.cacheReadTokens, step.cacheWriteTokens);
    if (cost === null) return { microUsd: null, estimated };
    total += cost;
  }
  const classifier = ledger.cost.classifier;
  if (classifier !== null) {
    // Its input is its own prompt, not the agent's, so the agent's steps say nothing of it.
    const cost = charge("the classifier", classifier.model, classifier.tokensIn, classifier.tokensOut, UNREPORTED_INPUT_TOKENS, null, null);
    if (cost === null) return { microUsd: null, estimated };
    total += cost;
  }
  return { microUsd: total, estimated };
}

/** The configured models that have no rate as of `at`: a run on any of them cannot be capped. */
export function unpricedModels(models: readonly string[], at: Date): string[] {
  return [...new Set(models)].filter((model) => rateAt(model, at) === null);
}

/** The cap a run starts with when `EVAL_MAX_USD` is not set: ten cents. */
export const DEFAULT_CAP_MICRO_USD = 100_000;

/**
 * `EVAL_MAX_USD` as micro-dollars, or null when it is not a finite, non-negative
 * number. Null refuses the run: `Number("abc")` is NaN, and `spent >= NaN` is
 * never true, so a typo would otherwise be a run with no cap at all.
 */
export function capMicroUsdFrom(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_CAP_MICRO_USD;
  const usd = Number(raw);
  return Number.isFinite(usd) && usd >= 0 ? Math.round(usd * 1_000_000) : null;
}

/** Micro-dollars as dollars, to the cent's hundredth, for a person to read. */
export function dollars(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

/** The fields of a run's row that a cost comparison reads. */
export interface SpendRow {
  inputTokens: number | null;
  outputTokens: number | null;
  steps: number;
  microUsd: number | null;
}

/**
 * A turn's tokens on the basis `turnSpend` prices: the agent's steps plus the
 * classifier call. The two sit in different ledger fields, so a token mean
 * taken from the agent alone moves apart from the cost mean. Null stays null
 * (unmeasured is not zero); a classifier that reported nothing adds nothing.
 */
export function turnTokens(
  agent: { inputTokens: number | null; outputTokens: number | null },
  ledger: TurnLedger | undefined,
): { inputTokens: number | null; outputTokens: number | null } {
  const classifier = ledger?.cost.classifier ?? null;
  const add = (base: number | null, extra: number | null | undefined) => (base === null ? null : base + (extra ?? 0));
  return { inputTokens: add(agent.inputTokens, classifier?.tokensIn), outputTokens: add(agent.outputTokens, classifier?.tokensOut) };
}

/** A run's per-turn means: the numbers two runs (main, then a branch) are laid side by side on. */
export interface RunSummary {
  turns: number;
  /** Means over the turns that reported the figure; null where none did. */
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  meanSteps: number | null;
  meanMicroUsd: number | null;
  /** How many turns each mean is over; they differ where a turn did not report a figure. */
  counts: { inputTokens: number; outputTokens: number; steps: number; microUsd: number };
}

/**
 * The mean tokens, steps and spend per turn, tokens and spend on one basis
 * (the row's tokens include the classifier, see `turnTokens`). A turn with no reported figure
 * is left out of that figure's mean rather than counted as zero, so an
 * unpriced turn cannot make a run look cheaper (the ledger's own rule:
 * unmeasured is not free).
 */
export function summariseRows(rows: readonly SpendRow[]): RunSummary {
  const known = (values: readonly (number | null)[]) => values.filter((value): value is number => value !== null);
  const mean = (values: readonly (number | null)[]): number | null => {
    const present = known(values);
    return present.length === 0 ? null : Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
  };
  return {
    turns: rows.length,
    meanInputTokens: mean(rows.map((row) => row.inputTokens)),
    meanOutputTokens: mean(rows.map((row) => row.outputTokens)),
    meanSteps: mean(rows.map((row) => row.steps)),
    meanMicroUsd: mean(rows.map((row) => row.microUsd)),
    counts: {
      inputTokens: known(rows.map((row) => row.inputTokens)).length,
      outputTokens: known(rows.map((row) => row.outputTokens)).length,
      steps: rows.length,
      microUsd: known(rows.map((row) => row.microUsd)).length,
    },
  };
}
