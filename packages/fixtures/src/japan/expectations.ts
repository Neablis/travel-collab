// What a correct Japan fixture looks like, stated as numbers.
//
// This is the file you edit when a feature lands. `verify.ts` measures; this
// declares. A mismatch between them is either a fixture that stopped covering
// something, or a deliberate content change that has not been recorded here —
// and `pnpm seed:verify` makes you decide which.
//
// See docs/guidelines/fixtures-and-seed-data.md for the procedure.

import type { ActivityKind, ActivityTag } from "@tc/contracts";
import type { JapanTripReport, SavedDayOwnerReport } from "./verify.ts";

export type JapanTripExpectations = {
  dayCount: number;
  scheduledCount: number;
  backlogCount: number;
  activityCount: number;
  kinds: Record<ActivityKind, number>;
  tags: Record<ActivityTag, number>;
  untaggedCount: number;
  withCoordinates: number;
  withCost: number;
  cities: string[];
  budgetMinor: number;
  plannedTotalMinor: number;
  currencies: string[];
  conflictsByKind: Record<string, number>;
  conflictTotal: number;
  daysNeedingBooking: number;
  savedDayCount: number;
  savedDayCities: string[];
  savedDaysByOwner: Record<string, SavedDayOwnerReport>;
};

export const JAPAN_TRIP_EXPECTATIONS: JapanTripExpectations = {
  dayCount: 14,
  scheduledCount: 68,
  backlogCount: 4,
  activityCount: 72,

  // EVERY ActivityKind and EVERY ActivityTag appears here, and every count is
  // > 0. That is the point of listing them exhaustively rather than spot-
  // checking a few: add a value to either enum and this object no longer
  // typechecks until the fixture covers it, so a new kind of stop cannot ship
  // with nothing on screen that exercises it.
  kinds: { booked: 18, hold: 2, idea: 6, planned: 37, transit: 9 },
  tags: { lodging: 4, meal: 33, outdoors: 11, ticketed: 8 },
  untaggedCount: 18,

  // All 72, including the 21 the geocoder could not pin to the right venue
  // (KI-39) and which carry hand-authored coordinates instead. The Map and
  // Timeline lenses have nothing to draw for an activity without them.
  withCoordinates: 72,
  // The 4 backlog ideas carry no cost, and two scheduled "idea" stops have no
  // estimate yet in the upstream export (`trip.budget.unpricedStops: 2`).
  withCost: 66,

  // Eight, not the six the trip SLEEPS in. Odawara and Tamano are where two
  // travel mornings physically start — Odawara Station on day 7, Uno Port on
  // day 13 — and KI-59's fix stopped tagging those stops with the city their
  // day ends in (./cityOverrides.ts). This list is the distinct set of
  // `location.city` over all 72 activities, so a stop the trip passes through
  // counts exactly as much as one it stays in; that is the honest reading and
  // it is the point of the change.
  //
  // If this drops back to six, suspect the override list went stale before you
  // suspect the content: the drift test will say which entry.
  cities: ["Hakone", "Kyoto", "Naoshima", "Nikkō", "Odawara", "Osaka", "Tamano", "Tokyo"],
  budgetMinor: 1_640_000,
  plannedTotalMinor: 908_500,
  currencies: ["USD"],

  // Two, and both are wanted: "Nezu Museum" against "Lunch at Kagari", and
  // "Kiyomizu-dera and Sannenzaka" against "Lunch at Omen Kodaiji". Realistic,
  // one per city, and exactly the "show me what a conflict looks like" the
  // fixture exists to demonstrate.
  //
  // This was 12 until KI-60. The other ten were `impossible-geography` and all
  // FALSE — 4 on the Odawara -> Kyoto day and 6 on the Osaka -> Tokyo day,
  // every pair spanning a relocation the day's own shinkansen accounts for.
  // `detectConflicts` compared same-day located pairs against a flat 150km and
  // never read `kind`; it now excuses a distance a `transit` stop crosses in
  // time. The fixture never changed — the rule did.
  //
  // If this number climbs back toward twelve, suspect the rule before the
  // content: a travel day flagging its own travel is the shape of that bug.
  conflictsByKind: { "time-overlap": 2 },
  conflictTotal: 2,

  // KI-86, Mitchell's call 2026-08-29: `needsBooking`'s narrower reading of
  // SPEC §12, tuned so the Calendar's `N to book` flag is the one actionable
  // thing at that zoom rather than wallpaper on all 14 days. Pinned here so a
  // change to a creation-time `kind` default (M18's PR 2+ follow-up) cannot
  // silently push this back toward 14 — the fixture always states `kind`
  // explicitly per stop (commands.ts) and never rides a command's default.
  daysNeedingBooking: 3,

  // The demo library (M11b). Five days across TWO owners, because the exit
  // gate wants "a profile's day count and adds agree with Discover — checked
  // against a seed where they could disagree", and one owner cannot disagree
  // with itself.
  //
  // **No two numbers a bug could swap are equal**, and that is the property to
  // preserve when editing `savedDays.ts`: days 3 vs 2, published 2 vs 1, adds
  // 3 vs 4. Make any pair equal and this stops catching the bug it is here for
  // — a profile that reads the wrong person's rows would still add up.
  //
  // The two owners share Kyoto and share nothing else, so a Kyoto query has to
  // return both people's days while a Hakone or a Naoshima query returns one.
  // `cities` is DERIVED by `citiesOfStops` in verify.ts, never authored beside
  // the stops — so a change to a stop's city, or to the rule, lands here as a
  // mismatch rather than in two places that quietly agree.
  savedDayCount: 5,
  savedDayCities: ["Hakone", "Kyoto", "Naoshima", "Osaka", "Tokyo"],
  savedDaysByOwner: {
    // "Tokyo to Hakone, slowly" is the two-city day. Without one, Discover's
    // per-card line ("Kyoto matched · also Uji") and its sibling chips have
    // nothing in the demo data to render — M18's tag chips against a
    // zero-tag preview, again.
    "dev-alice": { days: 3, published: 2, adds: 3, cities: ["Hakone", "Kyoto", "Tokyo"] },
    "dev-bob": { days: 2, published: 1, adds: 4, cities: ["Kyoto", "Naoshima", "Osaka"] },
  },
};

/**
 * Human-readable mismatches, or an empty array. Returns findings rather than
 * throwing so both callers — the vitest suite and `pnpm seed:verify` — can
 * present all of them at once instead of only the first.
 */
export function diffAgainstExpectations(
  report: JapanTripReport,
  expected: JapanTripExpectations = JAPAN_TRIP_EXPECTATIONS,
): string[] {
  const findings: string[] = [];

  /**
   * JSON with object keys sorted, so key ORDER cannot register as a difference.
   * `kinds` and `tags` are built in enum order by verify.ts and written by hand
   * here; comparing raw `JSON.stringify` output made this diff fail on ordering
   * alone, which is noise, not a finding.
   */
  const canonical = (v: unknown): string =>
    JSON.stringify(v, (_k, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    );

  /** Records a finding when one expected value does not match. */
  const scalar = (label: string, actual: unknown, want: unknown) => {
    if (canonical(actual) !== canonical(want)) {
      findings.push(`${label}: expected ${canonical(want)}, got ${canonical(actual)}`);
    }
  };

  scalar("dayCount", report.dayCount, expected.dayCount);
  scalar("scheduledCount", report.scheduledCount, expected.scheduledCount);
  scalar("backlogCount", report.backlogCount, expected.backlogCount);
  scalar("activityCount", report.activityCount, expected.activityCount);
  scalar("kinds", report.kinds, expected.kinds);
  scalar("tags", report.tags, expected.tags);
  scalar("untaggedCount", report.untaggedCount, expected.untaggedCount);
  scalar("withCoordinates", report.withCoordinates, expected.withCoordinates);
  scalar("withCost", report.withCost, expected.withCost);
  scalar("cities", report.cities, expected.cities);
  scalar("budgetMinor", report.budgetMinor, expected.budgetMinor);
  scalar("plannedTotalMinor", report.plannedTotalMinor, expected.plannedTotalMinor);
  scalar("currencies", report.currencies, expected.currencies);
  scalar("conflictsByKind", report.conflictsByKind, expected.conflictsByKind);
  scalar("conflictTotal", report.conflictTotal, expected.conflictTotal);
  scalar("daysNeedingBooking", report.daysNeedingBooking, expected.daysNeedingBooking);
  scalar("savedDayCount", report.savedDayCount, expected.savedDayCount);
  scalar("savedDayCities", report.savedDayCities, expected.savedDayCities);
  scalar("savedDaysByOwner", report.savedDaysByOwner, expected.savedDaysByOwner);

  // Coverage, stated separately from the counts above so the failure message
  // says WHY a zero matters rather than just that a number moved.
  for (const [kind, n] of Object.entries(report.kinds)) {
    if (n === 0) findings.push(`no activity has kind "${kind}" — every ActivityKind must be exercised by the fixture`);
  }
  for (const [tag, n] of Object.entries(report.tags)) {
    if (n === 0) findings.push(`no activity has tag "${tag}" — every ActivityTag must be exercised by the fixture`);
  }

  // The library's coverage, stated for the same reason the histograms' zeroes
  // are: a count that drifted says a number moved, and these say WHY it
  // matters. Each is a property M11b's gate rests on, not a preference.
  const owners = Object.keys(report.savedDaysByOwner);
  if (owners.length < 2) {
    findings.push(
      `the demo library has ${owners.length} owner(s) — a profile agreeing with Discover proves nothing unless two people's days could be confused`,
    );
  }
  if (!Object.values(report.savedDaysByOwner).some((o) => o.published > 0)) {
    findings.push("no saved day is public — Discover would be empty in the demo");
  }
  if (!Object.values(report.savedDaysByOwner).some((o) => o.adds > 0)) {
    findings.push("no saved day has ever been added — the leaderboard would rank an all-zero column");
  }

  // Lists that must be empty. Each one is a defect, not a count that drifted.
  const mustBeEmpty: [string, readonly (string | number)[]][] = [
    ["commands the domain rejected", report.rejections],
    ["days with no activities", report.emptyDays],
    ["days whose stops are stored out of chronological order", report.daysOutOfChronologicalOrder],
    ['notes still carrying a folded "(status)"', report.notesWithFoldedStatus],
    ["activities with no coordinates", report.activitiesWithoutCoordinates],
    ['days that would render "N stops have no place yet" in the Map lens', report.daysWithUnlocatedStops],
    ["canonical coordinates disagreeing with the geocode overlay", report.coordinateDisagreements],
    ["COORDINATE_OVERRIDES entries that no longer explain anything", report.staleOverrides],
    ["saved days no city search could return", report.savedDaysWithNoCities],
    ["published saved days that state no budget each", report.publishedSavedDaysWithNoPrice],
    ["adds the ledger rule forbids", report.savedDayLedgerViolations],
  ];
  for (const [label, list] of mustBeEmpty) {
    if (list.length > 0) findings.push(`${label}: ${list.join("; ")}`);
  }

  return findings;
}
