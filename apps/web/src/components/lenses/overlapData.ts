import type { ActivityView, Conflict, TimeWindow, TripDetail } from "@tc/contracts";
import { toMinutes } from "@/lib/time";

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
// an activity, but a `time-overlap` already gets the far richer OverlapWarning
// / compact chip — a triangle *and* a warning saying the same thing about the
// same pair is a double-up. So both lenses badge only the kinds nothing else
// surfaces (geography, anchors, budget), and they share this one rule rather
// than each spelling out the exclusion. Dismissal is deliberately not
// consulted: a dismissed overlap hides its warning without resurrecting a
// triangle, matching what the Board lens has always done for other kinds.
export function badgeableConflictSubjects(conflicts: readonly Conflict[]): Set<string> {
  return new Set(conflicts.filter((c) => c.kind !== OVERLAP_KIND).flatMap((c) => c.subjects));
}

export function overlapsForDay(detail: TripDetail, dayId: string): Overlap[] {
  const dismissed = new Set(detail.dismissedConflictIds);
  const overlaps: Overlap[] = [];

  for (const conflict of detail.conflicts) {
    if (conflict.kind !== OVERLAP_KIND) continue;
    if (dismissed.has(conflict.id)) continue;
    if (conflict.id.split(":")[ID_DAY_SEGMENT] !== dayId) continue;
    if (conflict.subjects.length !== 2) continue;

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
    });
  }

  return overlaps;
}
