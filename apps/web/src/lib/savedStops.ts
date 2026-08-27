import type { SavedStop, TripDetail } from "@tc/contracts";

/**
 * The stops on one day of a trip, in order, as a reusable fragment (M11 link 6).
 *
 * In `src/lib` rather than in `src/server/savedDays.ts` because BOTH sides
 * need it and the lint wall forbids UI importing `@/server/*`: the server
 * builds the row it stores, and the Keep-this-day dialog describes what it is
 * about to save. Two copies of "what's included" would be two chances to
 * disagree with each other, in the one place a user is being asked to trust a
 * summary.
 *
 * `activityId` is dropped: an id would tie the fragment to the activity it was
 * copied from, and inserting the same saved day into two trips would then put
 * the same id in two streams — the KI-1 hazard, and the same reason
 * `cloneTrip` remaps ids. Fresh ids are minted at insert time instead.
 *
 * The day's calendar DATE is dropped too, and that is the feature: a date is
 * derived from the trip's start (`deriveDayDates`), so it belongs to the trip
 * the day sat in, not to the day. Keeping it would make a saved day only
 * reusable in June.
 *
 * Returns null when the day is not in this trip — a caller asking about a day
 * that does not exist is a different situation from a day with no stops, and
 * both have a caller that cares.
 */
export function stopsForDay(detail: TripDetail, dayId: string): SavedStop[] | null {
  const day = detail.days.find((d) => d.dayId === dayId);
  if (day === undefined) return null;
  return day.activityIds.flatMap((activityId) => {
    const activity = detail.activities[activityId];
    if (activity === undefined) return [];
    return [
      {
        title: activity.title,
        timeWindow: activity.timeWindow,
        location: activity.location,
        notes: activity.notes,
        anchors: activity.anchors,
        kind: activity.kind,
        tags: activity.tags,
        cost: activity.cost,
      },
    ];
  });
}
