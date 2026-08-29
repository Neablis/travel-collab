import { randomUUID } from "node:crypto";

/**
 * Every trip an e2e spec creates is named through here.
 *
 * Two jobs, and both matter:
 *
 * 1. Uniqueness. Specs share the "alice" dev user's trip list (see
 *    playwright.config.ts's "setup" project), so two runs of the same spec
 *    would otherwise collide on a `getByRole("link", { name })` lookup — and
 *    so would two parallel workers, which is why the timestamp every spec
 *    already used is no longer the thing carrying uniqueness (see below).
 * 2. Ownership. Before this, nothing marked a trip as test debris and only
 *    m8 deleted the ones it made — so every run left ~14 trips behind for
 *    good. The home grid fetches once per card (KI-28), so each run made the
 *    next one slower and shifted layout-settle timing, which is how KI-28
 *    keeps coming back. `global.teardown.ts` deletes exactly the trips
 *    carrying this prefix, for exactly the signed-in test user.
 *
 * The prefix is deliberately conspicuous rather than clever: it shows up in
 * screenshots and traces as obviously-not-real data.
 */
export const E2E_TRIP_PREFIX = "[e2e]";

export function e2eTripName(label: string): string {
  // `Date.now()` alone was unique only to the millisecond, and Playwright runs
  // its workers in parallel against ONE shared database — two workers minting
  // the same name makes every `getByRole("link", { name })` in both specs
  // ambiguous, and leaves prefix cleanup unable to tell one trip from another.
  // The timestamp stays because it is what makes leftover debris readable;
  // the random suffix is what actually makes the name unique. Both sit after
  // the label, so the prefix and the readable part are untouched.
  return `${E2E_TRIP_PREFIX} ${label} ${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * `[e2e]` is regex punctuation — a character class, in fact, so an unescaped
 * `new RegExp(\`trip actions for ${tripName}\`)` silently stops matching the
 * trip it was built from rather than failing loudly. Specs that build a
 * pattern out of a trip name go through here.
 */
export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
