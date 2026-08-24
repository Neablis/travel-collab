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

// The last renderable wall-clock minute of a day, and therefore the last
// minute any timeWindow may end on: toTimeString clamps here, and
// contracts' TimeWindow regex tops out at "23:59". Exported because two
// callers already have to know where the day ends — the unscheduled rack,
// which places into it, and overlapData, which refuses to suggest a move
// that would run past it — and a second copy of the number would be free to
// drift from the clamp it is derived from.
export const DAY_END_MIN = 23 * 60 + 59;

// Clamped to a real wall-clock time: a computed minute count can overrun the
// day, and "24:30" is not a time anyone can render or store. Callers that
// must not silently lose minutes to this clamp check DAY_END_MIN first.
export function toTimeString(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_END_MIN, minutes));
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
// "30 m on top of each other." copy is the same "X h Y m <suffix>" shape as
// the day header's "out" total and a leg's "until next stop", and a second
// copy would be free to drift from the first.
//
// Phase 8 Task 8.1: the design's duration copy is space-separated ("1 h 15 m
// until next stop", not "1h 15m until next stop") — adjusted here rather
// than adding a second formatter, so every caller (day-header "out", the
// overlap warning, and the leg line) moves together.
export function formatDuration(minutes: number, suffix: string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m ${suffix}`;
  if (m === 0) return `${h} h ${suffix}`;
  return `${h} h ${m} m ${suffix}`;
}
