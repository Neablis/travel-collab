// Pure ISO-date math. NO wall-clock reads — every Date here is built from an
// explicit YYYY-MM-DD string pinned to UTC by an explicit `Z`, never from a
// bare `new Date()` and never from a zone-less parse (`new Date("2026-01-01")`
// is UTC, but `new Date("2026-01-01T00:00:00")` is *local*). The `Z` and the
// `getUTC*` accessors are what make this deterministic on every host, so
// leave them.
//
// KI-73: this module and `apps/web/src/lib/dates.ts` are the same parser
// written twice, and they have to be. AGENTS.md's module map makes
// `apps/web/src/server/**` the only web code that may import `@tc/domain`,
// while this math is also needed inside UI components — so neither side can
// import the other, and there is no shared home for it yet (creating one is a
// module-map design call, not a cleanup). What the two copies must never do
// is *disagree*, and until 2026-08-29 they did. Measured, on input that
// `TripDate` accepts, because `TripDate` validates SHAPE only
// (`/^\d{4}-\d{2}-\d{2}$/`, packages/contracts/src/trip.ts) with no
// calendar-range check:
//
//     "2026-13-45"  Date.UTC -> 2027-02-14   template -> RangeError
//     "2026-02-30"  Date.UTC -> 2026-03-02   template -> RangeError
//     "2026-01-32"  Date.UTC -> 2026-02-01   template -> RangeError
//     "2026-00-10"  Date.UTC -> 2025-12-10   template -> RangeError
//     "0026-01-01"  Date.UTC -> 1926-01-01   template -> 0026-01-01
//
// The first four are `Date.UTC`'s silent rollover — it has no notion of a
// date the calendar does not have, so it returns a DIFFERENT real date and
// nothing downstream can tell. The fifth is its two-digit-year remapping:
// `Date.UTC(26, 0, 1)` means 1926, not year 26.
//
// Both are gone because both copies now run the SAME two steps in the same
// order:
//
//   1. parse `${iso}T00:00:00Z` — explicit `Z` so it is UTC on every host,
//      and a four-digit string year is never remapped;
//   2. compare the parsed UTC components back against the input's own digits,
//      so a date the calendar does not have is REJECTED rather than rolled
//      over silently.
//
// The corpus above is pinned on both sides — `packages/domain/test/
// dates.equivalence.test.ts` and `apps/web/src/lib/dates.equivalence.test.ts`
// assert the same table against their own implementation. If you change one
// of these two files, change the other.
const ISO_DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;

// Callers must pass a COMPLETE, REAL calendar date. Shape is not calendar
// validity; `TripDate` only checks the first, so this does the second.
// RangeError, not a custom class: it is what the incomplete-input path
// already threw on the web side, and every caller's contract is "gate first".
function parseIsoDateUtc(iso: string): Date {
  const parts = ISO_DATE_PARTS.exec(iso);
  const dt = new Date(`${iso}T00:00:00Z`);
  if (
    parts === null ||
    dt.getUTCFullYear() !== Number(parts[1]) ||
    dt.getUTCMonth() + 1 !== Number(parts[2]) ||
    dt.getUTCDate() !== Number(parts[3])
  ) {
    throw new RangeError(`Not a calendar date: "${iso}"`);
  }
  return dt;
}

function addDaysIso(iso: string, n: number): string {
  const dt = parseIsoDateUtc(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Day 1 is pinned to startDate; day i (0-indexed) = startDate + i days.
// startDate === null → every day is undated (ordinal-only).
export function deriveDayDates(startDate: string | null, dayCount: number): (string | null)[] {
  if (startDate === null) return Array.from({ length: dayCount }, () => null);
  return Array.from({ length: dayCount }, (_, i) => addDaysIso(startDate, i));
}

// Inclusive day count between two ISO dates. Pure: built from explicit
// components in UTC, never `new Date()` with no argument. Returns 0 or less
// when `end` precedes `start`; callers treat that as invalid.
export function daySpan(startIso: string, endIso: string): number {
  return Math.floor((parseIsoDateUtc(endIso).getTime() - parseIsoDateUtc(startIso).getTime()) / 86_400_000) + 1;
}
