import type { SharedDayView } from "@/lib/sharedDayView";
import { publicAuthor } from "./playbooks";
import { schedulePinBackfill } from "./savedDayPinBackfill";
import { moderationOf, publishedAtOf, readableSavedDay } from "./savedDays";

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
  const day = await readableSavedDay(savedDayId, readerId);
  if (day === null) return null;
  const isAuthor = readerId !== null && day.ownerId === readerId;
  const [publishedAt, moderation] = await Promise.all([
    publishedAtOf(savedDayId),
    isAuthor ? moderationOf(savedDayId) : null,
  ]);
  return {
    day,
    isAuthor,
    pinning: readerId === null ? false : schedulePinBackfill(day, readerId),
    publishedAt,
    moderation,
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
