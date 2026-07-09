"use client";

import { useState } from "react";
import type { Conflict } from "@tc/contracts";

// Conflicts are data, never blocking modals (AGENTS.md invariant 3).
// Dismissal is client-local in M1; a persistent dismissal command arrives
// with the history work in M2.
export function ConflictBanner({ conflicts }: { conflicts: Conflict[] }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const visible = conflicts.filter((c) => !dismissed.has(c.id));
  if (visible.length === 0) return null;
  return (
    <aside
      role="status"
      style={{ border: "1px solid #e0a800", background: "#fff8e1", borderRadius: 6, padding: 8, marginBottom: 12 }}
    >
      {visible.map((c) => (
        <p key={c.id} style={{ margin: "4px 0" }}>
          ⚠️ {c.description} <em>({c.resolutions.join(" · ")})</em>{" "}
          <button
            onClick={() => setDismissed(new Set([...dismissed, c.id]))}
            aria-label={`Dismiss: ${c.description}`}
          >
            Dismiss
          </button>
        </p>
      ))}
    </aside>
  );
}
