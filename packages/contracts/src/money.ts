import { z } from "zod";

// Integer minor units (e.g. cents) + an ISO-4217 code. Never a float (ADR-008):
// stored money must rebuild bit-identically under the golden test, and all
// arithmetic is integer. `currency` keeps every amount self-describing so
// multi-currency is a later additive step.
export const Money = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof Money>;

/**
 * **The most a person can enter for one amount: 100,000,000,000 minor units**
 * (a billion in a two-decimal currency). zod 4's `.int()` refuses anything
 * past `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991), where zod 3 let it
 * through, and a trip's derived totals are parsed with it too — so two stops
 * of 5e15 each made a trip whose `TripDetail` no longer parsed, for every
 * member. Capping what a command may carry keeps any realistic sum of them
 * far below that bound. `Money` itself is not capped: it is also the shape of
 * stored events, and those must replay as they were written.
 */
export const MAX_AMOUNT_MINOR = 100_000_000_000;

/** `Money` as a command may carry it: `amountMinor` at most `MAX_AMOUNT_MINOR`. */
export const MoneyInput = Money.extend({
  amountMinor: z.number().int().nonnegative().max(MAX_AMOUNT_MINOR),
});
export type MoneyInput = z.infer<typeof MoneyInput>;
