"use client";

import type { Conflict } from "@tc/contracts";

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
  return (
    <aside
      role="status"
      style={{ border: "1px solid #e0a800", background: "#fff8e1", borderRadius: 6, padding: 8, marginBottom: 12 }}
    >
      {visible.map((c) => (
        <p key={c.id} style={{ margin: "4px 0" }}>
          ⚠️ {c.description} <em>({c.resolutions.join(" · ")})</em>{" "}
          <button onClick={() => onDismiss(c.id)} aria-label={`Dismiss: ${c.description}`}>
            Dismiss
          </button>
        </p>
      ))}
    </aside>
  );
}
