"use client";

import { useState } from "react";
import type { ActivityView, Location, TimeWindow } from "@tc/contracts";

export type ActivityFormValue = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
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
  const [place, setPlace] = useState(initial?.location?.name ?? "");
  const [lat, setLat] = useState(initial?.location?.lat?.toString() ?? "");
  const [lng, setLng] = useState(initial?.location?.lng?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") return setError("Title is required");
    if ((start === "") !== (end === "")) return setError("Provide both start and end times");
    if (start !== "" && start >= end) return setError("End time must be after start time");
    if ((lat.trim() === "") !== (lng.trim() === "")) return setError("Provide both latitude and longitude");
    if (lat.trim() !== "" && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)))) {
      return setError("Coordinates must be numbers");
    }
    const trimmedPlace = place.trim();
    if (trimmedPlace === "" && lat.trim() !== "") return setError("Coordinates need a place name");
    onSave({
      title: trimmedTitle,
      timeWindow: start !== "" ? { start, end } : null,
      location:
        trimmedPlace !== ""
          ? { name: trimmedPlace, ...(lat.trim() !== "" ? { lat: Number(lat), lng: Number(lng) } : {}) }
          : null,
      notes: notes.trim() !== "" ? notes.trim() : null,
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 6, padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
      <input aria-label="Activity title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <input aria-label="Start time" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <input aria-label="End time" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <input aria-label="Place name" placeholder="Place (optional)" value={place} onChange={(e) => setPlace(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <input aria-label="Latitude" placeholder="Lat (optional)" value={lat} onChange={(e) => setLat(e.target.value)} />
        <input aria-label="Longitude" placeholder="Lng (optional)" value={lng} onChange={(e) => setLng(e.target.value)} />
      </div>
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
