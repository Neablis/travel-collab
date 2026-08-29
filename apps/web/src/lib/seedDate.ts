/**
 * Local calendar date, N days from today, as `YYYY-MM-DD`.
 *
 * The demo trip is always dated relative to *today* so it is always upcoming
 * (ADR-030): a fixed date goes stale, and a stale demo shows a trip that
 * already happened to everyone who arrives after it. Every in-app caller must
 * date it identically, which is why this is one function and not three.
 *
 * It lives in `lib/`, not in `@tc/fixtures`, deliberately: a wall-clock read
 * inside that package would break the determinism `pnpm seed:verify` rests on
 * (ADR-030), so the fixture takes `startDate` as an argument and the clock stays
 * on this side of the boundary.
 *
 * `apps/web/scripts/db-seed.ts` keeps its own copy. It is a standalone script
 * run as `node scripts/db-seed.ts`, outside the `@/` alias the app builds with;
 * the two must agree, and the fixture's own `verify.test.ts` does not cover
 * either, so change both together.
 */
export function isoDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * How far ahead the Japan demo trip starts. Ten days: far enough that every
 * day of a 14-day trip is in the future, near enough that it reads as a trip
 * someone is actually about to take. `db-seed.ts` uses the same number.
 */
export const DEMO_TRIP_LEAD_DAYS = 10;
