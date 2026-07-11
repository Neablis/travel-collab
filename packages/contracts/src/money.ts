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
