import { eq, sql } from "drizzle-orm";
import { SavedDayVisibility, type CoverCandidate, type CoverPosition, type TripCover } from "@tc/contracts";
import { coverProxySrcFits } from "./coverProxy";
import { coverJson, coverOf, coverValues, storedCover, urlCoverValues, type UrlCoverInput } from "./coverRows";
import { db } from "./db/client";
import { savedDayCovers, savedDays } from "./db/schema";
import { fetchRemoteImage } from "./external/remoteImage/fetchImage";
import { RemoteImageRefused } from "./external/remoteImage/guard";
import { invalidatePublicDay } from "./libraryCache";

// A playbook day's cover photo (M37 part 5): ordinary Community CRUD on
// `saved_day_covers`, `trip_covers`' shape (`coverRows.ts`). The routes under
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

/** The day's cover, or `null` when it has none (or its row no longer parses). Its caller has passed the read seam. */
export async function getSavedDayCover(savedDayId: string): Promise<TripCover | null> {
  const [row] = await db.select().from(savedDayCovers).where(eq(savedDayCovers.savedDayId, savedDayId));
  return row ? coverOf(row) : null;
}

/**
 * Make `candidate` the day's cover, replacing any it had, and clear the
 * library's cache of the day if it is public. The caller has checked the
 * author and that the candidate came from the cover source.
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
  await invalidateIfPublic(savedDayId);
  return storedCover(row);
}

/**
 * Make the image at `input.url` the day's cover, replacing any it had, and
 * clear the library's cache of the day if it is public. The URL is fetched
 * once through the guarded fetcher first, and a refusal throws its
 * `RemoteImageRefused` (with the reason) having saved nothing, so a day
 * never holds a cover that was not an image when it was set. A URL whose
 * signed path would not fit the contract is refused `url-too-long` before
 * that. The image itself is not kept: the cover is the URL (ADR-081 item 2).
 */
export async function setSavedDayCoverFromUrl(
  savedDayId: string,
  input: UrlCoverInput,
  userId: string,
  { fetchImage = fetchRemoteImage, now = new Date() }: { fetchImage?: (url: string) => Promise<unknown>; now?: Date } = {},
): Promise<TripCover> {
  if (!coverProxySrcFits(input.url)) throw new RemoteImageRefused("url-too-long");
  await fetchImage(input.url);
  const values = urlCoverValues(input, userId, now);
  const [row] = await db
    .insert(savedDayCovers)
    .values({ savedDayId, ...values })
    .onConflictDoUpdate({ target: savedDayCovers.savedDayId, set: values })
    .returning();
  await invalidateIfPublic(savedDayId);
  return storedCover(row);
}

/**
 * Move the day's cover to `position` (0–100, checked by the caller's
 * contract), leaving the photo as it is, and clear the library's cache of
 * the day if it is public. Answers the moved cover, or `null` when the day
 * has none to move.
 */
export async function setSavedDayCoverPosition(savedDayId: string, position: CoverPosition): Promise<TripCover | null> {
  const [row] = await db
    .update(savedDayCovers)
    .set({ position })
    .where(eq(savedDayCovers.savedDayId, savedDayId))
    .returning();
  if (row === undefined) return null;
  await invalidateIfPublic(savedDayId);
  return coverOf(row);
}

/** Remove the day's cover, and clear the library's cache of it if public. Clearing a day with none is not an error. */
export async function clearSavedDayCover(savedDayId: string): Promise<void> {
  await db.delete(savedDayCovers).where(eq(savedDayCovers.savedDayId, savedDayId));
  await invalidateIfPublic(savedDayId);
}

// A public day's page and every list that shows its card are cached for a
// day (ADR-063), so a cover write clears them, as a publish does. Decided
// from the day as it is AFTER the write, not from the route's check before
// it (PR #354 review): a publish in another tab between the two would
// otherwise leave the old card cached for a day. Either order is then
// covered — the publish clears after its own commit, and this after ours.
/** Clears the cached day and its lists when the day is public now. */
async function invalidateIfPublic(savedDayId: string): Promise<void> {
  const [day] = await db
    .select({ ownerId: savedDays.ownerId, visibility: savedDays.visibility })
    .from(savedDays)
    .where(eq(savedDays.id, savedDayId));
  if (day?.visibility === SavedDayVisibility.enum.public) await invalidatePublicDay(savedDayId, day.ownerId);
}
