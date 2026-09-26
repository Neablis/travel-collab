import type { Anchor, SavedStop, TripDetail } from "@tc/contracts";

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
 *
 * `only`, when given, keeps just those activities — walked in the day's own
 * order, so what is kept runs in the order the day ran (ADR-050, Pass A). The
 * app never passes it.
 */
export function stopsForDay(
  detail: TripDetail,
  dayId: string,
  only?: ReadonlySet<string>,
): SavedStop[] | null {
  const day = detail.days.find((d) => d.dayId === dayId);
  if (day === undefined) return null;
  return day.activityIds.flatMap((activityId) => {
    if (only !== undefined && !only.has(activityId)) return [];
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
        mode: activity.mode,
        endLocation: activity.endLocation,
        pendingReason: activity.pendingReason,
        // Day ZERO: `stopsForDay` answers about ONE day, so the fragment it
        // returns is a sequence of length one. `stopsForDays` below re-stamps
        // this from the day's position in the selection — the index belongs to
        // the sequence being built, never to the day it was read from.
        dayIndex: 0,
      },
    ];
  });
}

/**
 * The stops of SEVERAL days of a trip, as one ordered sequence (M23 link 2).
 *
 * **`dayIndex` is the day's position in `dayIds`, not its position in the
 * trip.** Keeping trip days 1, 3 and 5 produces a three-day playbook indexed
 * {0, 1, 2}, not a five-day one with holes: a playbook is a new sequence, and a
 * fragment that carried its source trip's numbering would only fit where it
 * came from — the same reason ADR-029 drops the day's calendar date.
 *
 * **A selected day with no stops contributes no stops, and that IS its
 * representation.** The index it would have carried is simply absent, leaving a
 * GAP — and a gap in `dayIndex` is an empty day (ADR-048 decision 2). Keeping
 * days [A, B, C] with B empty yields indices {0, 2}, which is a three-day
 * sequence whose middle day is deliberately empty. Nothing compacts that gap,
 * here or at any read boundary; compacting it would silently deliver a two-day
 * playbook to somebody who kept three.
 *
 * Returns null when ANY requested day is not in this trip — the same answer
 * `stopsForDay` gives for one, and for the same reason: a caller asking about a
 * day that does not exist is a different situation from a day with no stops,
 * and partially honouring a multi-day request would save a playbook quietly
 * missing a day.
 *
 * `only` narrows the days it names to some of their activities (`stopsForDay`);
 * a day it does not name is kept whole.
 */
export function stopsForDays(
  detail: TripDetail,
  dayIds: readonly string[],
  only?: ReadonlyMap<string, ReadonlySet<string>>,
): SavedStop[] | null {
  const sequence: SavedStop[] = [];
  for (const [dayIndex, dayId] of dayIds.entries()) {
    const stops = stopsForDay(detail, dayId, only?.get(dayId));
    if (stops === null) return null;
    for (const stop of stops) sequence.push({ ...stop, dayIndex });
  }
  return sequence;
}

/**
 * True for an anchor a Playbook does not keep: a `dateRange`, which is a
 * calendar date by another name (ADR-050 decision 8). "Only 3–5 May" carried
 * into October is a conflict on that stop, and a Playbook has no dates.
 * Weekday, time-of-day and public-holiday anchors describe the place rather
 * than the trip, and are kept.
 *
 * Here rather than in `server/savedDays.ts` for `stopsForDay`'s reason: the
 * server's `withoutDateAnchors` applies it, and the Keep dialog warns with it
 * before the button acts (KI-2026-09-24-c). It was a hand copy in the dialog
 * until PR #234's review; one rule cannot disagree with itself.
 */
export function isDroppedFromPlaybook(anchor: Anchor): anchor is Extract<Anchor, { kind: "dateRange" }> {
  return anchor.kind === "dateRange";
}
