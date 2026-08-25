"use client";

import type { ActivityView, Conflict } from "@tc/contracts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

// Conflicts are data, never blocking modals (AGENTS.md invariant 3).
// Dismissal is a real command since M2 — it persists, appears in history,
// and is undoable like any other change.
export function ConflictBanner({
  conflicts,
  dismissedConflictIds,
  activities,
  onDismiss,
  onSelectActivity,
}: {
  conflicts: Conflict[];
  dismissedConflictIds: string[];
  activities: Record<string, ActivityView>;
  onDismiss: (conflictId: string) => void;
  // Same openEdit path Board already wires as onSelectActivity for every
  // other surface (TimelineLens, MapLens) — not a second navigation
  // mechanism. Optional so a caller with no jump target (none today) still
  // renders a plain, non-interactive banner.
  onSelectActivity?: (activityId: string) => void;
}) {
  const visible = conflicts.filter((c) => !dismissedConflictIds.includes(c.id));
  if (visible.length === 0) return null;
  // my-3 (not just mb-3) so the alert isn't flush against the tab strip above
  // it (#21).
  return (
    <div className="my-3 grid gap-1.5">
      {visible.map((c) => {
        // Mitchell (preview review): "clicking a alert should jump to the
        // activity." A conflict can name two subjects (an overlap always
        // does); jump to the first — there's no room in this one-line banner
        // to pick a side, and the editor sheet it opens shows the full
        // activity either way. A subject id the trip no longer has (deleted
        // since this conflict was computed) does nothing rather than
        // openEdit-ing a blank sheet.
        const subject = c.subjects.map((id) => activities[id]).find((a): a is ActivityView => a !== undefined);
        const jump = subject !== undefined && onSelectActivity !== undefined ? () => onSelectActivity(subject.activityId) : undefined;
        const description = (
          <Text as="span">
            {c.description}
          </Text>
        );
        return (
          <Banner
            key={c.id}
            variant="warning"
            actions={
              <Button variant="ghost" onClick={() => onDismiss(c.id)} aria-label={`Dismiss: ${c.description}`}>
                Dismiss
              </Button>
            }
          >
            {jump !== undefined ? (
              <Button
                variant="ghost"
                onClick={jump}
                aria-label={`Jump to ${subject!.title}`}
                className="h-auto justify-start gap-0 p-0 text-left font-normal hover:bg-transparent hover:underline"
              >
                {description}
              </Button>
            ) : (
              description
            )}
          </Banner>
        );
      })}
    </div>
  );
}
