import { describeByTags, describedTags } from "@tc/domain";
import type { ActivityTagDescribed, SavedStop } from "@tc/contracts";
import type { SharedDayView } from "@/lib/sharedDayView";
import { globalPageTags, publicAuthor } from "./playbooks";
import { getSavedDayCover } from "./savedDayCovers";
import { schedulePinBackfill } from "./savedDayPinBackfill";
import { readableSavedDayWithStanding } from "./savedDays";

/**
 * One shared day as `readerId` may see it, without its author, or null.
 * `GET /api/saved-days/:id` reads through here: its response never carried the
 * author (the screen asks `/api/playbooks/profile` for that), so it does not
 * pay for `publicAuthor`'s aggregate on every read and every pin re-read, and
 * cannot fail on it.
 *
 * Null is the one answer for a private, moderated, deleted or unknown day
 * (`access/saved-day-access.ts`): the caller turns it into a 404 and can say
 * nothing more. `readerId` null is a reader with no account (ADR-061), who
 * never starts a pin backfill — it spends a geocode quota they do not have.
 */
export async function sharedDayRead(
  savedDayId: string,
  readerId: string | null,
): Promise<Omit<SharedDayView, "author"> | null> {
  // The day, when it was published and its moderation, off the one row the
  // read seam selects — not that row selected twice more for two fields.
  const read = await readableSavedDayWithStanding(savedDayId, readerId);
  if (read === null) return null;
  const { day, publishedAt } = read;
  const isAuthor = readerId !== null && day.ownerId === readerId;
  const moderation = isAuthor ? read.moderation : null;
  // After the read seam: a day this reader may not open never reaches here,
  // so neither does its cover.
  const cover = await getSavedDayCover(savedDayId);
  return {
    day,
    isAuthor,
    pinning: readerId === null ? false : schedulePinBackfill(day, readerId),
    publishedAt,
    moderation,
    cover,
    // On a tag page only if published and not hidden by an operator.
    ...whatKindOfDay(day.stops, day.visibility === "public" && moderation === null, await globalPageTags()),
  };
}

/**
 * What kind of day these stops make (M42 D9), the categories they carry, the
 * ones the description names, and the ones with a global tag page, for
 * `SharedDayView`. One place, so the page's cached read and the live one
 * cannot word the same day two ways.
 *
 * `listed` is whether the day is in the public library, which is all tag
 * pages list: off it, no tag is a page this day is on, so none is named —
 * and none links either, so a private day's chips stay text as they did.
 * `pageTags` is the lattice's global pages, read once per read by the
 * caller, never per chip.
 */
export function whatKindOfDay(
  stops: readonly SavedStop[],
  listed: boolean,
  pageTags: readonly ActivityTagDescribed[] = [],
): Pick<SharedDayView, "description" | "tags" | "namedTags" | "linkedTags"> {
  const described = describeByTags(stops);
  const tags = describedTags(stops);
  // Read as strings: `tags` are `ActivityTag` and the set holds described
  // ones, so a typed set would refuse the membership test.
  const pageTagSet: ReadonlySet<string> = new Set(pageTags);
  return {
    description: described?.text ?? null,
    tags,
    namedTags: listed ? [...(described?.named ?? [])] : [],
    linkedTags: listed ? tags.filter((tag): tag is ActivityTagDescribed => pageTagSet.has(tag)) : [],
  };
}

/**
 * `sharedDayRead` and the author's public numbers: the day page's first paint,
 * which the screen's own re-read rebuilds from the API's two calls, so the two
 * cannot disagree.
 */
export async function sharedDayView(savedDayId: string, readerId: string | null): Promise<SharedDayView | null> {
  const read = await sharedDayRead(savedDayId, readerId);
  if (read === null) return null;
  return { ...read, author: await publicAuthor(read.day.ownerId) };
}
