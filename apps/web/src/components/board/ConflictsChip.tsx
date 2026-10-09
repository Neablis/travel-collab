"use client";

import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ActivityView, Conflict } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ConflictRow, visibleConflicts } from "./ConflictBanner";

/**
 * The phone's conflict state (M39 D9): a count in the pinned row that opens a
 * sheet of the trip's conflicts. The phone shows one day at a time, so a
 * banner above that day could not show a conflict on any other; the header is
 * on every tab, and so is this. Nothing renders while nothing is left to look
 * at.
 *
 * The rows are the banner's own (`ConflictRow`): the same words, the same
 * Dismiss, the same jump. Conflicts stay data (AGENTS.md invariant 3): the
 * sheet opens only when the reader taps the count.
 */
export function ConflictsChip({
  conflicts,
  dismissedConflictIds,
  activities,
  onDismiss,
  onJump,
  readOnly = false,
  neighbour,
}: {
  conflicts: Conflict[];
  dismissedConflictIds: string[];
  activities: Record<string, ActivityView>;
  onDismiss: (conflictId: string) => void;
  /** Takes the reader to the stop a row names. The sheet has closed by the time it runs. */
  onJump: (activityId: string) => void;
  /** Drops Dismiss, as on the banner: dismissing is a command. */
  readOnly?: boolean;
  /**
   * Where focus goes when dismissing the last conflict takes the chip away
   * with its sheet. The row's owner holds it; absent, focus is left to Radix.
   */
  neighbour?: React.RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const visible = visibleConflicts(conflicts, dismissedConflictIds);
  // Dismissing the last one unmounts the sheet with it. Without the reset, the
  // next conflict to arrive would bring the chip back with its sheet open.
  if (visible.length === 0 && open) setOpen(false);
  if (visible.length === 0) return null;

  const count = visible.length;
  const label = count === 1 ? "1 thing to look at" : `${count} things to look at`;
  return (
    <>
      <Button
        variant="ghost"
        size="touch"
        aria-label={label}
        ref={chip}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        // The Ask pill's shape in the banner's colours: a pill that sits in
        // the same row as Ask, tinted as the warning it opens.
        className="shrink-0 gap-1 rounded-full bg-warning-tint px-3 font-semibold text-warning-ink hover:bg-warning-tint hover:text-warning-ink"
      >
        <AlertTriangle className="size-4" aria-hidden />
        {count}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Things to look at"
        size="bottom"
        // The sheet is state-controlled, so Radix has no trigger to return
        // focus to and a keyboard reader closing it landed on <body>. Only
        // focus that was lost is rescued: a jump has opened the stop's editor
        // by now, and focus belongs in that.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (document.activeElement !== null && document.activeElement !== document.body) return;
          (chip.current ?? neighbour?.current)?.focus();
        }}
      >
        <div className="grid gap-1.5">
          {visible.map((c) => (
            <ConflictRow
              key={c.id}
              conflict={c}
              activities={activities}
              onDismiss={onDismiss}
              onSelectActivity={(activityId) => {
                setOpen(false);
                onJump(activityId);
              }}
              readOnly={readOnly}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}
