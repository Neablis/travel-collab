"use client";

import type { Conflict } from "@tc/contracts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

// Conflicts are data, never blocking modals (AGENTS.md invariant 3).
// Dismissal is a real command since M2 — it persists, appears in history,
// and is undoable like any other change.
export function ConflictBanner({
  conflicts,
  dismissedConflictIds,
  onDismiss,
}: {
  conflicts: Conflict[];
  dismissedConflictIds: string[];
  onDismiss: (conflictId: string) => void;
}) {
  const visible = conflicts.filter((c) => !dismissedConflictIds.includes(c.id));
  if (visible.length === 0) return null;
  // my-3 (not just mb-3) so the alert isn't flush against the tab strip above
  // it (#21).
  return (
    <div className="my-3 grid gap-1.5">
      {visible.map((c) => (
        <Banner
          key={c.id}
          variant="warning"
          actions={
            <Button variant="ghost" onClick={() => onDismiss(c.id)} aria-label={`Dismiss: ${c.description}`}>
              Dismiss
            </Button>
          }
        >
          <Text as="span">
            {c.description} <Text as="span" variant="muted">({c.resolutions.join(" · ")})</Text>
          </Text>
        </Banner>
      ))}
    </div>
  );
}
