import type { QuotaCounters } from "@/server/quota";

/**
 * The semantics `QuotaCounters` documents, as the smallest in-memory program
 * that states them (KI-2026-09-15-a).
 *
 * One definition, used in two places on purpose. `quota.int.test.ts` drives it
 * and `pgCounters` through the same generated bump/release sequences and
 * requires them to agree after every operation; `quota.property.test.ts` then
 * drives `reserveAiSteps`/`settleAiSteps` through it. The first proves this
 * model IS the SQL, so the second is a property over the real semantics rather
 * than over a stub — which is what the property suite's old `release` (a
 * no-op) was not. Change a rule here and the int differential fails until the
 * SQL matches; change the SQL and it fails until this does.
 *
 * - `bump` clamps `amount` to a positive integer, starts a later window AT the
 *   charge, and never rewinds to an earlier window.
 * - `release` subtracts only when the row is in exactly `windowStart`'s window
 *   (`=`, never `>=`), floors at zero, and treats a non-positive or non-finite
 *   amount as nothing to refund.
 */
export function referenceCounters(): QuotaCounters & {
  readonly rows: ReadonlyMap<string, { readonly windowStart: number; readonly hits: number }>;
} {
  const rows = new Map<string, { windowStart: number; hits: number }>();
  return {
    rows,
    async bump(bucket, windowStart, amount = 1) {
      const by = Math.max(1, Math.trunc(Number.isFinite(amount) ? amount : 1));
      const existing = rows.get(bucket);
      const next =
        existing === undefined || windowStart.getTime() > existing.windowStart
          ? { windowStart: windowStart.getTime(), hits: by }
          : { windowStart: existing.windowStart, hits: existing.hits + by };
      rows.set(bucket, next);
      return next.hits;
    },
    async release(bucket, windowStart, amount) {
      const by = Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0));
      const row = rows.get(bucket);
      if (row === undefined || row.windowStart !== windowStart.getTime()) return;
      rows.set(bucket, { windowStart: row.windowStart, hits: Math.max(0, row.hits - by) });
    },
  };
}
