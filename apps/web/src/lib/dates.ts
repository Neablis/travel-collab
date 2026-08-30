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

// THE ISO-date parse for apps/web. Callers must pass a COMPLETE, REAL ISO
// date. A partial one (a half-typed `<input type="date">` value) parses to an
// Invalid Date and is rejected rather than returning garbage — deliberate, but
// it means the caller gates first (NewTripWizard's `ISO_DATE.test`).
//
// Shape is not calendar validity, and that gate only checks shape. Parsing
// `${iso}T00:00:00Z` rejects an out-of-range month or day-of-month
// ("2026-13-45", "2026-01-32") on its own, but would silently ROLL OVER a day
// the month does not have: "2026-02-30" becomes March 2, so
// `addDaysIso("2026-02-30", 1)` returned a date three days from the one it was
// handed. Comparing the parsed UTC components back against the input's own
// digits is what tells the two apart.
//
// KI-73: `calendarData.ts` used to carry a SECOND mechanism — `Date.UTC(y,
// m - 1, d)` — which disagreed with this one on contract-valid input: it rolls
// every impossible date over to some other real date, and remaps a
// two-digit-looking year ("0026-01-01" -> 1926-01-01, because `Date.UTC(26,
// ...)` means 1926). That copy is gone; `calendarData` imports this function.
// `packages/domain/src/trip/dates.ts` runs the same two steps, duplicated
// because AGENTS.md's module map forbids UI code importing `@tc/domain` and
// there is no shared home for this math yet. Both sides pin the same corpus
// (`dates.equivalence.test.ts`, one per side) — change one, change the other.
//
// Still open, and the only reason such a string can reach here at all:
// `TripDate` (packages/contracts/src/trip.ts) validates shape and not the
// calendar. Closing that is a contract change with its own changelog and
// consumer sweep (AGENTS.md invariant 5).
export function parseIsoDateUtc(iso: string): Date {
  const parts = ISO_DATE_PARTS.exec(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  if (
    parts === null ||
    d.getUTCFullYear() !== Number(parts[1]) ||
    d.getUTCMonth() + 1 !== Number(parts[2]) ||
    d.getUTCDate() !== Number(parts[3])
  ) {
    // RangeError, not a custom class: it is what the incomplete-input path
    // already threw, and every caller's contract is "gate first".
    throw new RangeError(`Not a calendar date: "${iso}"`);
  }
  return d;
}

export function addDaysIso(startIso: string, days: number): string {
  const d = parseIsoDateUtc(startIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Display-only labels (M1 decision): the domain never reads dates.
export function dayLabel(startDate: string | null, index: number): string {
  const base = `Day ${index + 1}`;
  if (startDate === null) return base;
  const d = parseIsoDateUtc(addDaysIso(startDate, index));
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${base} — ${formatted}`;
}
