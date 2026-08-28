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
//
// Callers must pass a COMPLETE ISO date. A partial one (a half-typed
// `<input type="date">` value) parses to an Invalid Date and `toISOString()`
// throws a RangeError on it rather than returning garbage — deliberate, but it
// means the caller gates first (NewTripWizard's `ISO_DATE.test`).
export function addDaysIso(startIso: string, days: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
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
