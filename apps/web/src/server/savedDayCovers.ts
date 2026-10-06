import { eq, sql } from "drizzle-orm";
import type { CoverCandidate, TripCover } from "@tc/contracts";
import { db } from "./db/client";
import { savedDayCovers } from "./db/schema";
import { coverJson, coverOf, coverValues } from "./tripCovers";

// A playbook day's cover photo (M37 part 5): ordinary Community CRUD on
// `saved_day_covers`, `trip_covers`' shape. The routes under
// `app/api/saved-days/[savedDayId]/cover/` are the only writers, and only for
// the day's author.
//
// **Nothing here decides who may see a cover.** Every read takes a day the
// caller has already read through the library's own rule — `readableSavedDay`
// for one day, `matchPredicate` for a listing — so a private, moderated or
// deleted day hides its cover exactly as it hides itself, and no read here
// needs a second copy of that rule to forget.

/**
 * `left join saved_day_covers` onto `playbooks.ts`'s `saved_days d`, and the
 * cover it finds as one jsonb value (`DiscoverDay.cover`). One join, not a
 * read per card.
 */
export const SAVED_DAY_COVER_JOIN = sql`left join ${savedDayCovers} on ${savedDayCovers.savedDayId} = d.id`;
export const SAVED_DAY_COVER_JSON = coverJson(savedDayCovers, savedDayCovers.savedDayId);

/** The day's cover, or `null` when it has none. Its caller has passed the read seam. */
export async function getSavedDayCover(savedDayId: string): Promise<TripCover | null> {
  const [row] = await db.select().from(savedDayCovers).where(eq(savedDayCovers.savedDayId, savedDayId));
  return row ? coverOf(row) : null;
}

/**
 * Make `candidate` the day's cover, replacing any it had. The caller has
 * checked the author and that the candidate came from the cover source.
 */
export async function setSavedDayCover(
  savedDayId: string,
  candidate: CoverCandidate,
  userId: string,
  now: Date = new Date(),
): Promise<TripCover> {
  const values = coverValues(candidate, userId, now);
  const [row] = await db
    .insert(savedDayCovers)
    .values({ savedDayId, ...values })
    .onConflictDoUpdate({ target: savedDayCovers.savedDayId, set: values })
    .returning();
  return coverOf(row!);
}

/** Remove the day's cover. Clearing a day with none is not an error. */
export async function clearSavedDayCover(savedDayId: string): Promise<void> {
  await db.delete(savedDayCovers).where(eq(savedDayCovers.savedDayId, savedDayId));
}
