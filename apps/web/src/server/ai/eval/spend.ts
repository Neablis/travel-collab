// **What an eval turn cost, in the ledger's own arithmetic** (M33).
//
// Every eval turn is a paid model call, and a run is a loop of them; on
// 2026-10-05 a day of runs spent $0.25 without one saying so first (Mitchell:
// "we should be really clear when we are running eval loops"). The runner caps
// a run on this number and prints it, so it must be the same price the cost
// console would put on the same turn: `microUsdForSteps` for the agent's steps
// at the model each ran on, and `microUsdFor` for the classifier's round-trip.
// No second pricing rule lives here.
import type { TurnLedger } from "@/server/assistant/ledger";
import { microUsdFor, rateAt } from "@/server/entitlements/modelRates";
import { microUsdForSteps } from "@/server/entitlements/usage";

/**
 * One turn's spend in micro-dollars, or null when any part of it has no rate.
 * Null is not zero: a run cannot cap what it cannot price.
 */
export function turnMicroUsd(ledger: TurnLedger, at: Date): number | null {
  const steps = microUsdForSteps(
    ledger.stepSpend.map((step) => ({
      turnId: ledger.cost.turnId ?? "",
      model: step.model,
      tokensIn: step.tokensIn,
      tokensOut: step.tokensOut,
      cacheReadTokens: step.cacheReadTokens,
      cacheWriteTokens: step.cacheWriteTokens,
    })),
    at,
  );
  if (steps === null) return null;
  const classifier = ledger.cost.classifier;
  if (classifier === null) return steps;
  const classified = microUsdFor(classifier.model, classifier.tokensIn, classifier.tokensOut, at);
  return classified === null ? null : steps + classified;
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
