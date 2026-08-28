"use client";

import type { Conflict } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Text } from "@/components/ui/text";

// KI-43's in-card half, placed where Mitchell asked for it: the activity
// editor. Two things had no home before this.
//
// 1. Distance conflicts ("~309 km apart on the same day") were only ever
//    written out in ConflictBanner's board-level list — Timeline's inline
//    OverlapWarning covers `time-overlap` and nothing else — so on every other
//    surface they reduced to a bare warning triangle with no words attached.
// 2. A *dismissed* conflict was written out nowhere at all. ConflictBanner
//    filters dismissed ids out of its list, which is the point of dismissing
//    one; but that made dismissal the only irreversible-looking act in the
//    app, since nothing afterwards would tell you what you had silenced.
//
// So this list is deliberately unfiltered: every conflict naming the stop,
// dismissed ones included, marked as dismissed rather than dropped. That is
// what lets badgeableConflictSubjects (overlapData.ts) stop badging dismissed
// conflicts on the board without the information going anywhere — dismissal
// buys quiet on the board, and opening the stop still shows the whole picture.
//
// Copy is the conflict's own `description`, the same string ConflictBanner
// renders. It is written once, by the rule that emitted it
// (packages/domain/src/trip/conflicts.ts), so there is no per-kind wording
// here to keep in sync with anything.
//
// No Dismiss / Fix action: this surface reports, and the board's list still
// owns dismissing. Adding a second dismissal control is a separate decision
// (and an undo story) rather than a side effect of showing the copy.
export function ActivityConflicts({
  conflicts,
  dismissedConflictIds,
  activityId,
}: {
  conflicts: Conflict[];
  dismissedConflictIds: string[];
  activityId: string;
}) {
  const mine = conflicts.filter((c) => c.subjects.includes(activityId));
  if (mine.length === 0) return null;

  const dismissed = new Set(dismissedConflictIds);
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <Text variant="muted">Things to look at on this stop</Text>
      {mine.map((c) => (
        <Banner
          key={c.id}
          variant="warning"
          actions={
            dismissed.has(c.id) ? (
              // Marked, not hidden: the board stopped showing this one because
              // someone dismissed it, and that is exactly the fact the editor
              // has to carry rather than quietly reproduce.
              <Badge variant="warning">Dismissed</Badge>
            ) : undefined
          }
        >
          <Text as="span">{c.description}</Text>
        </Banner>
      ))}
    </div>
  );
}
