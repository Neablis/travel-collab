import type { ActivityView, Conflict, TimeWindow, TripDetail } from "@tc/contracts";
import { DAY_END_MIN, toMinutes, toTimeString } from "@/lib/time";

// The warning model behind the design's inline overlap treatment. Nothing
// here is a new rule: `time-overlap` conflicts are emitted by the domain
// (packages/domain/src/trip/conflicts.ts) and arrive on TripDetail already —
// this only decides which of the pair the warning hangs off and what the copy
// needs to say about the other one.
export type Overlap = {
  conflictId: string;
  laterActivityId: string; // the stop the warning attaches to
  otherActivityId: string;
  otherTitle: string;
  otherStart: string; // raw "HH:MM"
  otherEnd: string; // raw "HH:MM"
  overlapMinutes: number;
  suggestedStart: string; // raw "HH:MM" — the other stop's end
  // Where the later stop would end after the duration-preserving move, raw
  // "HH:MM" — or null when that move does not fit inside the day. The fix is
  // defined as "move the later stop, keeping its duration"; a stop whose kept
  // duration would run past 23:59 has no such move, because a timeWindow lives
  // within one day and crossing days is MoveActivity, not UpdateActivity. The
  // rule lives here rather than at each call site so the timeline and the
  // board cannot disagree on which warnings are fixable — and so nobody
  // re-derives the end through toTimeString, whose clamp would silently
  // shorten the stop (a 30m stop moved to 23:45 would become 14m).
  suggestedEnd: string | null;
};

// The kind, and also the first segment of the id: conflicts.ts builds it as
// `time-overlap:${dayId}:${s1}:${s2}`. That id is the only place a conflict
// names the day it belongs to, and the pair it encodes is what already makes
// DismissConflict per-pair rather than per-stop.
const OVERLAP_KIND = "time-overlap";
const ID_DAY_SEGMENT = 1;

type Timed = { activity: ActivityView; window: TimeWindow };

// `subjects` is sorted by activityId, never by time, so which stop the design
// hangs the warning off ("the one that starts later") has to be worked out
// here. Ties break on the later end and then on activityId so a day's
// warnings are stable across renders rather than depending on object order.
function startsLater(a: Timed, b: Timed): boolean {
  const aStart = toMinutes(a.window.start);
  const bStart = toMinutes(b.window.start);
  if (aStart !== bStart) return aStart > bStart;
  const aEnd = toMinutes(a.window.end);
  const bEnd = toMinutes(b.window.end);
  if (aEnd !== bEnd) return aEnd > bEnd;
  return a.activity.activityId > b.activity.activityId;
}

// The generic conflict `Badge` (a bare triangle) fires for any conflict naming
// an activity, but a `time-overlap` that a lens actually renders as an
// OverlapWarning / compact chip already says the same thing about the same
// pair, far more richly — a triangle on top of that is a double-up. So both
// lenses badge only what nothing else surfaces, and they share this one rule
// rather than each spelling out the exclusion.
//
// The exclusion is per *rendered* overlap, not per kind (KI-29): a column card
// has room for exactly one chip, so a stop that is the later half of two
// crossing pairs drops one — and the dropped pair, badged here, is the only
// day-column trace it has left. `renderedOverlapIds` is whatever the calling
// lens will really put on screen; the timeline passes every overlap it lays
// out, the board passes the one-chip-per-stop subset that survived its own
// keying. Anything else a lens cannot render (a conflict naming a removed
// activity, or a stop whose times are gone) falls through to the triangle for
// the same reason, rather than being silently invisible.
//
// Dismissal is deliberately still not a triangle: a dismissed conflict hides
// its warning without resurrecting one — so it is excluded here even though no
// lens renders it, for *every* kind and not just overlaps. That last part used
// to be a bug: the two exclusions were folded into one `kind !== OVERLAP_KIND
// || !surfaced(c)` test, whose dismissal half was therefore only ever reached
// for overlaps. Dismissing a distance conflict took its ConflictBanner row
// away (that list filters dismissed ids) and left the triangle on the card,
// with nothing on screen to explain it or offer to dismiss it again. The two
// conditions are independent and are now written that way.
//
// What makes dropping the triangle safe rather than lossy: the activity editor
// lists every conflict naming the stop, dismissed ones included (KI-43). The
// board is where dismissal buys quiet; the editor is where the full picture
// always lives.
export function badgeableConflictSubjects(
  detail: Pick<TripDetail, "conflicts" | "dismissedConflictIds">,
  renderedOverlapIds: ReadonlySet<string>,
): Set<string> {
  const dismissed = new Set(detail.dismissedConflictIds);
  const renderedInline = (c: Conflict) => c.kind === OVERLAP_KIND && renderedOverlapIds.has(c.id);
  return new Set(
    detail.conflicts
      .filter((c) => !dismissed.has(c.id) && !renderedInline(c))
      .flatMap((c) => c.subjects),
  );
}

// The later stop's own duration, replayed from the suggested start: null as
// soon as it would end past the last minute the day has.
function repairedEnd(later: Timed, suggestedStart: string): string | null {
  const duration = toMinutes(later.window.end) - toMinutes(later.window.start);
  const end = toMinutes(suggestedStart) + duration;
  return end > DAY_END_MIN ? null : toTimeString(end);
}

export function overlapsForDay(detail: TripDetail, dayId: string): Overlap[] {
  const dismissed = new Set(detail.dismissedConflictIds);
  const members = new Set(detail.days.find((d) => d.dayId === dayId)?.activityIds ?? []);
  const overlaps: Overlap[] = [];

  for (const conflict of detail.conflicts) {
    if (conflict.kind !== OVERLAP_KIND) continue;
    if (dismissed.has(conflict.id)) continue;
    if (conflict.id.split(":")[ID_DAY_SEGMENT] !== dayId) continue;
    if (conflict.subjects.length !== 2) continue;
    // The conflict id encodes the day it was computed for, which is not
    // necessarily where its stops are now — a move reschedules the activity
    // long before the recomputed conflict set catches up (and under the
    // optimistic overlay, the client can sit in that gap). Trusting the
    // encoded day alone let a stale overlap be reported for a day that no
    // longer holds both stops: the caller counted it as rendered and dropped
    // the generic triangle, while the lens rendered no warning for it,
    // because a warning only renders beside a stop the day actually lists.
    // Requiring current membership keeps "returned by overlapsForDay" and
    // "rendered by the lens" the same set, which is the whole premise of
    // badgeableConflictSubjects. Found by CodeRabbit on PR #44.
    if (!conflict.subjects.every((id) => members.has(id))) continue;

    // A conflict can outlive the activity it names (a removal the client
    // hasn't reconciled yet), and an activity can lose its times without the
    // conflict going with it — neither is a reason to blow up a whole day's
    // timeline, so both are simply skipped.
    const timed = conflict.subjects.flatMap((activityId) => {
      const activity = detail.activities[activityId];
      return activity && activity.timeWindow ? [{ activity, window: activity.timeWindow }] : [];
    });
    if (timed.length !== 2) continue;

    const [first, second] = timed as [Timed, Timed];
    const later = startsLater(first, second) ? first : second;
    const earlier = later === first ? second : first;

    overlaps.push({
      conflictId: conflict.id,
      laterActivityId: later.activity.activityId,
      otherActivityId: earlier.activity.activityId,
      otherTitle: earlier.activity.title,
      otherStart: earlier.window.start,
      otherEnd: earlier.window.end,
      // The true intersection, not the span the two cover together: two stops
      // 10:30–13:00 and 12:30–14:00 sit 30 minutes on top of each other, not
      // 210.
      overlapMinutes:
        Math.min(toMinutes(later.window.end), toMinutes(earlier.window.end)) -
        Math.max(toMinutes(later.window.start), toMinutes(earlier.window.start)),
      suggestedStart: earlier.window.end,
      suggestedEnd: repairedEnd(later, earlier.window.end),
    });
  }

  return overlaps;
}
