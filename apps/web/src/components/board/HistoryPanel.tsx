"use client";

import { useState } from "react";
import type { TripHistory } from "@tc/contracts";

export function HistoryPanel({
  history,
  previewSeq,
  onPreview,
  onExitPreview,
  onRevert,
}: {
  history: TripHistory | null;
  previewSeq: number | null;
  onPreview: (seq: number) => void;
  onExitPreview: () => void;
  onRevert: (toSeq: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside>
      <button aria-label="History" onClick={() => setOpen((o) => !o)}>
        🕘 History
      </button>
      {open && history !== null && (
        <ol reversed style={{ border: "1px solid #ccc", borderRadius: 6, padding: 12, marginTop: 8 }}>
          {history.entries.map((entry) => (
            <li key={entry.batchId} data-testid="history-entry" style={{ margin: "4px 0" }}>
              <button
                onClick={() => (previewSeq === entry.toSeq ? onExitPreview() : onPreview(entry.toSeq))}
                style={{
                  opacity: entry.undone ? 0.5 : 1,
                  textDecoration: entry.undone ? "line-through" : "none",
                  fontWeight: previewSeq === entry.toSeq ? "bold" : "normal",
                }}
              >
                {entry.description}
              </button>{" "}
              <small>{new Date(entry.occurredAt).toLocaleString()}</small>
            </li>
          ))}
        </ol>
      )}
      {previewSeq !== null && (
        <p role="status" style={{ border: "1px solid #6699cc", background: "#eef5ff", borderRadius: 6, padding: 8 }}>
          Viewing version {previewSeq} (read-only){" "}
          <button onClick={() => onRevert(previewSeq)}>Revert to here</button>{" "}
          <button onClick={onExitPreview}>Back to now</button>
        </p>
      )}
    </aside>
  );
}
