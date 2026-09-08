import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { savedDayAdds, savedDays } from "./db/schema";

// The same shape `projections.ts` uses for "the pool, or a transaction on it".
// Spelled here rather than imported because that one is private to a module
// this one has no other business importing.
type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// The adds ledger's write path (M11b link 4).
//
// The rule: *an add only counts once per trip; copying your own day into your
// own trip does not count.* `SPEC.md` §15 is blunt about why this is a link and
// not a detail: **a build that counts raw inserts produces a different and
// gameable order**, and that ordering is the whole credibility of the
// leaderboard.
//
// **The design's copy carried a third clause — *and only after the trip has
// dates* — and Mitchell dropped it on 2026-09-08.** An add into an undated trip
// counts. The argument for the clause was that an undated trip is a wishlist,
// so counting it makes "most added" a measure of browsing; the argument against
// is that it bought almost nothing and cost real credit. Inflating somebody
// still needs N genuinely separate trips — once-per-trip caps each trip at one
// — and putting a date on each of N trips is trivial, so the clause deterred no
// determined gamer. What it did reliably was discard honest adds permanently:
// an uncounted add leaves no ledger row, and nothing on the trip side records
// where a day came from, so dating the trip afterwards could never credit it.
// `SPEC.md` §15 still states the old rule; the deviation is recorded in
// `.design-sync/handoff/DRIFT.md`.
//
// The two surviving clauses are enforced in two different places, on purpose:
//
//   1. **Once per trip** — the database. `saved_day_adds`' primary key is
//      `(saved_day_id, trip_id)`, so a second add into the same trip cannot be
//      written at all. `recordAdd` reads that as `ON CONFLICT DO NOTHING` and
//      reports "did not count" rather than raising, because a person inserting
//      the same day twice is doing something perfectly reasonable — it is only
//      the SECOND one that must not move a number.
//   2. **Not your own day** — here, in `addCounts`. It is a fact about a day's
//      author and the person adding it rather than about this table, so there is
//      nothing a constraint could key on.
//
// Nothing outside this module may touch `saved_days.adds`.

/** What the application-side clause is decided from. */
export type AddEligibility = {
  /** `saved_days.owner_id` — the author of the day being taken. */
  authorId: string;
  /** Who is doing the adding. */
  actorId: string;
};

/**
 * Does this add count towards the author's board position?
 *
 * Pure, and separated from the write so the rule can be read on its own. One
 * clause lives here:
 *
 *   * **The author is not their own audience.** Copying your own day into your
 *     own trip is the single cheapest way to inflate a board, and it is also a
 *     completely ordinary thing to do — reusing your own template is what the
 *     library is FOR. So it is silently uncounted, never refused.
 *
 * **The target trip is not an input, and that is the decision of 2026-09-08**
 * rather than an omission: an add into a trip with no dates counts, so there is
 * nothing about the trip left to ask. Deliberately not "the actor is not a
 * member of the source trip" or anything else clever either — every extra
 * clause is another thing a real add can fail for without the person being
 * told, and that is exactly how the dates clause went wrong.
 */
export function addCounts({ authorId, actorId }: AddEligibility): boolean {
  return authorId !== actorId;
}

/**
 * Write one ledger row and move the denormalised counter with it.
 *
 * **Takes a transaction rather than the pool**, and that is the point: the
 * counter is `count(*)` over this table and nothing else, so the only way the
 * two can be made to agree by construction is for both statements — and the
 * trip write that occasioned them — to commit or roll back together. A ledger
 * row with no counter bump silently under-ranks its author forever; a bump with
 * no row is the gameable count the ledger exists to prevent.
 *
 * Returns whether the add COUNTED. `false` means the composite primary key
 * already held this (day, trip) — the "once per trip" clause, refused by the
 * database rather than by a read-then-write this module could lose a race with.
 */
export async function recordAdd(
  tx: Queryable,
  add: { savedDayId: string; tripId: string; addedBy: string; createdAt: Date },
): Promise<boolean> {
  const written = await tx
    .insert(savedDayAdds)
    .values(add)
    .onConflictDoNothing()
    .returning({ savedDayId: savedDayAdds.savedDayId });
  if (written.length === 0) return false;

  // `adds + 1` computed by the database, never read-modify-written in JS: two
  // concurrent adds of the same day into two different trips are two ledger
  // rows and must be two increments, and a value carried through the
  // application would let the later one overwrite the earlier.
  await tx
    .update(savedDays)
    .set({ adds: sql`${savedDays.adds} + 1` })
    .where(eq(savedDays.id, add.savedDayId));
  return true;
}
