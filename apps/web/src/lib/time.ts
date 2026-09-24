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

// The clock-time formatter ("10:30 am" / "1 pm" / "2:30 pm – 4 pm", or
// "10:30" / "13:00" / "14:30 – 16:00" for a reader who picked 24-hour) lives in
// `@tc/pages` (`clockLabel.ts`), so a notebook widget prints the same clock as
// the board: Mitchell, on the PR #221 preview's sunrise widget, *"All times
// should be in AM/PM not military time"*, and *"maybe a good idea to have that
// as a setting"* — which is why the format is a required argument, read from
// `useTimeFormat()`. Re-exported so every caller of `@/lib/time` imports from
// one place. Storage stays 24-hour; do not route an editor's
// `<input type="time">` through these, or it will stop accepting input.
export { toClockLabel, toClockRange } from "@tc/pages";

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
