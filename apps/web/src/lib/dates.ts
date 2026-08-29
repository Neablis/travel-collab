// Day arithmetic on the `YYYY-MM-DD` strings the contracts carry, entirely in
// UTC. One copy: this was written out three times (here, calendarData.ts's
// `addDays`, NewTripWizard.tsx's own `addDaysIso`), each re-deriving the same
// footgun in its own comment.
//
// UTC throughout, never a local-zone parse. `new Date("2026-01-01")` is UTC but
// `new Date("2026-01-01T00:00:00")` is *local*, and `setDate`/`getDate` are
// local too — mixing the two shifts a date by a day on any non-UTC host near
// midnight (the same defect §1.8 of the 2026-08-28 review found in
// `packages/factories`). The explicit `Z` and the `UTC` accessors are what
// keep this deterministic, so leave them.
//
// The domain never reads dates (M1 decision), so this stays UI-local math and
// imports nothing from @tc/domain (AGENTS.md architecture boundary).

const ISO_DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;

// Callers must pass a COMPLETE, REAL ISO date. A partial one (a half-typed
// `<input type="date">` value) parses to an Invalid Date and `toISOString()`
// throws a RangeError on it rather than returning garbage — deliberate, but it
// means the caller gates first (NewTripWizard's `ISO_DATE.test`).
//
// Shape is not calendar validity, and that gate only checks shape. The parser
// rejects an out-of-range month or day-of-month ("2026-13-45", "2026-01-32"),
// but silently ROLLS OVER a day the month does not have: "2026-02-30" becomes
// March 2, so `addDaysIso("2026-02-30", 1)` returned a date three days from
// the one it was handed. Comparing the parsed UTC components back against the
// input is what tells the two apart. This is the narrow, UI-local half of
// KI-73; the wide half (contracts accepting impossible dates, which is the
// only reason such a string can reach here at all) stays open.
export function addDaysIso(startIso: string, days: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  const parts = ISO_DATE_PARTS.exec(startIso);
  if (
    parts === null ||
    d.getUTCFullYear() !== Number(parts[1]) ||
    d.getUTCMonth() + 1 !== Number(parts[2]) ||
    d.getUTCDate() !== Number(parts[3])
  ) {
    // RangeError, not a custom class: it is what the incomplete-input path
    // already threw, and every caller's contract is "gate first".
    throw new RangeError(`addDaysIso: "${startIso}" is not a calendar date`);
  }
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Display-only labels (M1 decision): the domain never reads dates.
export function dayLabel(startDate: string | null, index: number): string {
  const base = `Day ${index + 1}`;
  if (startDate === null) return base;
  const d = new Date(`${addDaysIso(startDate, index)}T00:00:00Z`);
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${base} — ${formatted}`;
}
