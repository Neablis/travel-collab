// Clock-time <-> minutes-since-midnight conversion for the "HH:MM" strings
// that ActivityView.start/end carry. Hoisted verbatim out of
// components/lenses/TimelineLens.tsx (where they were file-local) because the
// unscheduled rack's fitIntoDay, the timeline and the editor all need the same
// arithmetic — one copy, not three. Same reason as lib/geo.ts: generic,
// domain-free math the UI is allowed to own (no @tc/domain import — AGENTS.md
// architecture boundary, CI-enforced).
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// Clamped to a real wall-clock time: a computed minute count can overrun the
// day, and "24:30" is not a time anyone can render or store.
export function toTimeString(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const h = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const m = (clamped % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
