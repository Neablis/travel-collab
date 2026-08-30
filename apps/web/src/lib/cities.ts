import { z } from "zod";

// The wire shape of `GET /api/cities?q=` (M11b link 2), defined ONCE and read
// from both sides: the route validates what it is about to send, `apiClient`
// parses what it received.
//
// It lives in `src/lib` for `savedStops.ts`'s reason — the lint wall forbids UI
// importing `@/server/*`, and `src/server` may import `@/lib` — so one
// definition can serve both without either side hand-writing the other's type.
//
// **Where this really belongs is `packages/contracts`** (AGENTS.md invariant 5:
// cross-boundary types are Zod schemas there, with a changelog entry). It is
// here rather than there because M11b's contracts step was its own reviewed PR
// and had already landed; adding a schema to it from the server PR is exactly
// the drift that rule exists to stop. Flagged for the follow-up rather than
// done quietly — the shape below is deliberately trivial so that moving it is a
// cut and paste.

export const CityMatch = z.object({
  city: z.string().min(1),
  /**
   * How many **published** saved days touch this city. Private days are not
   * counted — a public index must not report a number only its author's data
   * explains (see `server/cities.ts`).
   */
  days: z.number().int().nonnegative(),
});
export type CityMatch = z.infer<typeof CityMatch>;

export const CitySearchResponse = z.object({ cities: z.array(CityMatch) });
export type CitySearchResponse = z.infer<typeof CitySearchResponse>;
