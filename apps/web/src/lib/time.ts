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

// The design's copy renders clock times in 12-hour form with the minutes
// dropped on the hour ("10:30 am", "1 pm"), while the timeline's own time
// column still shows the raw "HH:MM" the contract stores. There was no
// existing 12-hour formatter anywhere in the app (grep for `formatTime`,
// `toLocaleTimeString`, `hour12` — 2026-08-23, M10 Phase 5), so this is the
// first and only one: put new prose-facing time copy through it rather than
// hand-assembling a second variant. Not Intl.DateTimeFormat, which needs a
// Date (and therefore a date and a zone) to render a bare wall-clock time
// and would emit "1:00 PM" rather than the design's "1 pm".
export function toClockLabel(time: string): string {
  const minutes = toMinutes(time);
  const hours24 = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return mins === 0 ? `${hours12} ${suffix}` : `${hours12}:${mins.toString().padStart(2, "0")} ${suffix}`;
}

// Hoisted verbatim out of components/lenses/TimelineLens.tsx (where it was
// file-local) for the same reason toMinutes moved here: the overlap warning's
// "30m on top of each other." copy is the same "Xh Ym <suffix>" shape as the
// day header's "out" total and a leg's "gap", and a second copy would be free
// to drift from the first.
export function formatDuration(minutes: number, suffix: string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m ${suffix}`;
  if (m === 0) return `${h}h ${suffix}`;
  return `${h}h ${m}m ${suffix}`;
}
