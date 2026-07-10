"use client";

import { useState } from "react";
import type { ActivityView, Anchor, Location, TimeWindow } from "@tc/contracts";
import { AnchorEditor } from "./AnchorEditor";
import { LocationInput } from "./LocationInput";

export type ActivityFormValue = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
};

export function ActivityEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ActivityView | null;
  onSave: (value: ActivityFormValue) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [start, setStart] = useState(initial?.timeWindow?.start ?? "");
  const [end, setEnd] = useState(initial?.timeWindow?.end ?? "");
  const [location, setLocation] = useState<Location | null>(initial?.location ?? null);
  const [anchors, setAnchors] = useState<Anchor[]>(initial?.anchors ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") return setError("Title is required");
    if ((start === "") !== (end === "")) return setError("Provide both start and end times");
    if (start !== "" && start >= end) return setError("End time must be after start time");
    onSave({
      title: trimmedTitle,
      timeWindow: start !== "" ? { start, end } : null,
      location,
      notes: notes.trim() !== "" ? notes.trim() : null,
      anchors,
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 6, padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
      <input aria-label="Activity title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <input aria-label="Start time" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <input aria-label="End time" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <LocationInput value={location} onChange={setLocation} />
      <AnchorEditor value={anchors} onChange={setAnchors} />
      <textarea aria-label="Notes" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error !== null && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
