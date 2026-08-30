import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { savedDayAdds, savedDays } from "./db/schema";

// The same shape `projections.ts` uses for "the pool, or a transaction on it".
// Spelled here rather than imported because that one is private to a module
// this one has no other business importing.
type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// The adds ledger's write path (M11b link 4).
//
// The rule, verbatim from the design: *an add only counts once per trip, and
// only after the trip has dates; copying your own day into your own trip does
// not count.* `SPEC.md` §15 is blunt about why this is a link and not a detail:
// **a build that counts raw inserts produces a different and gameable order**,
// and that ordering is the whole credibility of the leaderboard.
//
// The three clauses are enforced in two different places, on purpose:
//
//   1. **Once per trip** — the database. `saved_day_adds`' primary key is
//      `(saved_day_id, trip_id)`, so a second add into the same trip cannot be
//      written at all. `recordAdd` reads that as `ON CONFLICT DO NOTHING` and
//      reports "did not count" rather than raising, because a person inserting
//      the same day twice is doing something perfectly reasonable — it is only
//      the SECOND one that must not move a number.
//   2. **Dated trip, and not your own day** — here, in `addCounts`. Both are
//      facts about a trip and an actor rather than about this table, so there
//      is nothing a constraint could key on.
//
// Nothing outside this module may touch `saved_days.adds`.

/** What the two application-side clauses are decided from. */
export type AddEligibility = {
  /** `saved_days.owner_id` — the author of the day being taken. */
  authorId: string;
  /** Who is doing the adding. */
  actorId: string;
  /** The target trip's `startDate`; null means the trip has no dates yet. */
  tripStartDate: string | null;
};

/**
 * Does this add count towards the author's board position?
 *
 * Pure, and separated from the write so the rule can be read on its own. The
 * two clauses:
 *
 *   * **The trip has dates.** An undated trip is a wishlist — days get dropped
 *     into one to look at them, and counting that would make "most added" a
 *     measure of browsing. `startDate` is the whole of "has dates": the domain
 *     mints a trip's days from it (`SetTripDates`), so a trip with a start date
 *     is a trip on a calendar.
 *   * **The author is not their own audience.** Copying your own day into your
 *     own trip is the single cheapest way to inflate a board, and it is also a
 *     completely ordinary thing to do — reusing your own template is what the
 *     library is FOR. So it is silently uncounted, never refused.
 *
 * Deliberately not "the actor is not a member of the source trip" or anything
 * else clever: every extra clause is another thing a real add can fail for
 * without the person being told, and the design named exactly these three.
 */
export function addCounts({ authorId, actorId, tripStartDate }: AddEligibility): boolean {
  if (tripStartDate === null) return false;
  if (authorId === actorId) return false;
  return true;
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
