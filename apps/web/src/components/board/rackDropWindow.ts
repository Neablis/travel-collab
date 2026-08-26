import type { TripDetail } from "@tc/contracts";
import { DEFAULT_DAY_START, fitIntoDay } from "@/components/trip/fitIntoDay";

export type Slot = { start: string; end: string };

/**
 * The time window a drop should give the stop it just moved, or `null` when the
 * drop must not touch times at all.
 *
 * Extracted as a pure function for the reason `resolveDrop` and
 * `rackDisclosure` already are, and stated in m10-unscheduled-rack.spec.ts's
 * own header: the drag itself is native HTML5 DnD and cannot be driven in
 * jsdom, so the *decision* a drop resolves to is tested here and the drag that
 * delivers it is tested in a real browser.
 *
 * Two things decide it:
 *
 * **Where the stop came from.** Only a stop coming off the rack gets a time.
 * The first version of this asked "does it have a time yet?" instead, reasoning
 * that an untimed stop must have come off the rack because unscheduling strips
 * the window. That is false in one direction — a stop can sit on a day with no
 * time at all (`timelineData.ts` sorts exactly those into `row.untimed`) — and
 * `Board` routes a same-day reorder through the same callback, so dragging an
 * untimed stop one place up its own day would have silently given it a start
 * time it never asked for. A stop already on a day is never in `backlog`, so
 * reading `backlog` answers the question the other test was only approximating.
 * (Caught by CodeRabbit on PR #55.)
 *
 * **Where in the day it landed.** The stop above the drop point hands over its
 * end time as the preferred start; `fitIntoDay` searches forward from there for
 * a gap that actually fits, so dropping into a packed stretch still yields a
 * real window rather than one overlapping its neighbours. Dropped at the top
 * there is no stop above it, so the day's own default applies.
 *
 * `trip` must be the state as it was BEFORE the move is applied — `backlog` is
 * emptied optimistically, so reading it afterwards would answer "no" every time.
 */
export function rackDropWindow(
  trip: TripDetail,
  activityId: string,
  toDayId: string | null,
  position: number,
): Slot | null {
  if (toDayId === null) return null;
  if (!trip.backlog.includes(activityId)) return null;

  const day = trip.days.find((d) => d.dayId === toDayId);
  if (day === undefined) return null;

  // Excluding the dragged stop is belt-and-braces: it is in the backlog, so it
  // is not in any day's activityIds. It costs nothing and keeps this correct if
  // a caller ever passes post-move state by mistake.
  const neighbourIds = day.activityIds.filter((id) => id !== activityId);
  const existing = neighbourIds
    .map((id) => trip.activities[id]?.timeWindow)
    .filter((w): w is Slot => w !== null && w !== undefined);

  const above = position > 0 ? neighbourIds[position - 1] : undefined;
  // Dropped at the top, the preference is the START of the day, not "no
  // preference". They are not the same: with no preference fitIntoDay searches
  // forward from the day's LAST window, so a stop dropped above a lone 15:00
  // booking came back 16:30 — a time later than the stop it was dropped above,
  // which is the opposite of what the drop said. Asking for 09:00 puts it in
  // the free morning instead, and on a day that genuinely has no room before
  // its first stop (one starting at 09:00) the search moves forward and lands
  // in the same place it always did.
  const preferredStart =
    above !== undefined ? (trip.activities[above]?.timeWindow?.end ?? DEFAULT_DAY_START) : DEFAULT_DAY_START;

  return fitIntoDay(existing, preferredStart);
}
