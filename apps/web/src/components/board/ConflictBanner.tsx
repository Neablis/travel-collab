"use client";

import { useState } from "react";
import type { ActivityView, Conflict } from "@tc/contracts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

// Above this many, the list collapses behind a one-line summary by default
// (KI-43). Two is the largest number that still fits above the fold with a day
// column visible under it at 1440×900, which is the whole point of the cap.
const COLLAPSE_ABOVE = 2;

// Conflicts are data, never blocking modals (AGENTS.md invariant 3).
// Dismissal is a real command since M2 — it persists, appears in history,
// and is undoable like any other change.
export function ConflictBanner({
  conflicts,
  dismissedConflictIds,
  activities,
  onDismiss,
  onSelectActivity,
  readOnly = false,
}: {
  conflicts: Conflict[];
  dismissedConflictIds: string[];
  activities: Record<string, ActivityView>;
  onDismiss: (conflictId: string) => void;
  /** A viewer reads the conflicts but cannot dismiss them — DismissConflict is
      a real command the server refuses for a viewer. The list itself stays:
      conflicts are data (AGENTS.md invariant 3), and reading them is not a
      write. Only the Dismiss action goes. */
  readOnly?: boolean;
  // Same openEdit path Board already wires as onSelectActivity for every
  // other surface (TimelineLens, MapLens) — not a second navigation
  // mechanism. Optional so a caller with no jump target (none today) still
  // renders a plain, non-interactive banner.
  onSelectActivity?: (activityId: string) => void;
}) {
  const visible = conflicts.filter((c) => !dismissedConflictIds.includes(c.id));
  const collapsible = visible.length > COLLAPSE_ABOVE;
  const [expanded, setExpanded] = useState(false);
  if (visible.length === 0) return null;

  // KI-43: this used to render one full-width Banner per conflict, unbounded.
  // The Japan seed carries twelve, which is ~700px of stacked warning between
  // the tab strip and the day columns — at 1440×900 the first column was
  // entirely below the fold and the lens read as broken on open.
  //
  // Collapsing rather than truncating: every conflict is still here, still
  // dismissable, still a jump target — they are one click away instead of
  // pushing the surface they describe off screen. This is the summary half of
  // KI-43's recorded fix path.
  //
  // The other half landed 2026-08-28, at the location Mitchell picked rather
  // than the in-card one KI-43 guessed: the activity editor
  // (`trip/editor/ActivityConflicts.tsx`) lists every conflict naming the stop
  // being edited, dismissed ones included, in this same `c.description` copy.
  // That is why this list can keep filtering dismissed ids — and why
  // `overlapData.ts` can now suppress the card triangle for a dismissed
  // conflict of *any* kind — without the words going anywhere. This list stays
  // as the whole-trip view with the Dismiss and jump actions; the editor is
  // the per-stop view that never filters.
  const summary = (
    <Banner
      variant="warning"
      actions={
        <Button
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide" : "Show"}
        </Button>
      }
    >
      <Text as="span">{visible.length} things to look at on this trip</Text>
    </Banner>
  );

  // my-3 (not just mb-3) so the alert isn't flush against the tab strip above
  // it (#21).
  return (
    <div className="my-3 grid gap-1.5">
      {collapsible ? summary : null}
      {collapsible && !expanded
        ? null
        : visible.map((c) => {
            // Mitchell (preview review): "clicking a alert should jump to the
            // activity." A conflict can name two subjects (an overlap always
            // does); jump to the first — there's no room in this one-line banner
            // to pick a side, and the editor sheet it opens shows the full
            // activity either way. A subject id the trip no longer has (deleted
            // since this conflict was computed) does nothing rather than
            // openEdit-ing a blank sheet.
            const subject = c.subjects
              .map((id) => activities[id])
              .find((a): a is ActivityView => a !== undefined);
            const jump =
              subject !== undefined && onSelectActivity !== undefined
                ? () => onSelectActivity(subject.activityId)
                : undefined;
            const description = <Text as="span">{c.description}</Text>;
            return (
              <Banner
                key={c.id}
                variant="warning"
                actions={
                  readOnly ? undefined : (
                    <Button
                      variant="ghost"
                      onClick={() => onDismiss(c.id)}
                      aria-label={`Dismiss: ${c.description}`}
                    >
                      Dismiss
                    </Button>
                  )
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
