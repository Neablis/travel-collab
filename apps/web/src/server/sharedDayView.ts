import type { SharedDayView } from "@/lib/sharedDayView";
import { publicAuthor } from "./playbooks";
import { schedulePinBackfill } from "./savedDayPinBackfill";
import { moderationOf, publishedAtOf, readableSavedDay } from "./savedDays";

/**
 * One shared day as `readerId` may see it, or null. `GET /api/saved-days/:id`
 * and the day page both read through here, so the page's first paint and the
 * screen's later re-read cannot disagree.
 *
 * Null is the one answer for a private, moderated, deleted or unknown day
 * (`access/saved-day-access.ts`): the caller turns it into a 404 and can say
 * nothing more. `readerId` null is a reader with no account (ADR-061), who
 * never starts a pin backfill — it spends a geocode quota they do not have.
 */
export async function sharedDayView(savedDayId: string, readerId: string | null): Promise<SharedDayView | null> {
  const day = await readableSavedDay(savedDayId, readerId);
  if (day === null) return null;
  const isAuthor = readerId !== null && day.ownerId === readerId;
  const [author, publishedAt, moderation] = await Promise.all([
    publicAuthor(day.ownerId),
    publishedAtOf(savedDayId),
    isAuthor ? moderationOf(savedDayId) : null,
  ]);
  return {
    day,
    isAuthor,
    author,
    pinning: readerId === null ? false : schedulePinBackfill(day, readerId),
    publishedAt,
    moderation,
  };
}
