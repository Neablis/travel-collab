// What a correct Japan fixture looks like, stated as numbers.
//
// This is the file you edit when a feature lands. `verify.ts` measures; this
// declares. A mismatch between them is either a fixture that stopped covering
// something, or a deliberate content change that has not been recorded here —
// and `pnpm seed:verify` makes you decide which.
//
// See docs/guidelines/fixtures-and-seed-data.md for the procedure.

import type { ActivityKind, ActivityTag } from "@tc/contracts";
import type { JapanTripReport } from "./verify.ts";

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
  kinds: { booked: 13, hold: 5, idea: 6, planned: 39, transit: 9 },
  tags: { lodging: 4, meal: 33, outdoors: 11, ticketed: 8 },
  untaggedCount: 18,

  // All 72, including the 21 the geocoder could not pin to the right venue
  // (KI-39) and which carry hand-authored coordinates instead. The Map and
  // Timeline lenses have nothing to draw for an activity without them.
  withCoordinates: 72,
  // The 4 backlog ideas carry no cost, and two scheduled "idea" stops have no
  // estimate yet in the upstream export (`trip.budget.unpricedStops: 2`).
  withCost: 66,

  cities: ["Hakone", "Kyoto", "Naoshima", "Nikkō", "Osaka", "Tokyo"],
  budgetMinor: 1_640_000,
  plannedTotalMinor: 908_500,
  currencies: ["USD"],

  // Deliberately planted, not incidental. The Gora Kadan check-in at 16:40
  // ("Check-in closes at 16:00 — this is the conflict the assistant flagged")
  // is the one the demo narrative is built around; the rest are the same-day
  // distance warnings a real six-city trip produces. If this number moves, a
  // rule changed or the content did.
  conflictsByKind: { "impossible-geography": 10, "time-overlap": 2 },
  conflictTotal: 12,
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

  // Coverage, stated separately from the counts above so the failure message
  // says WHY a zero matters rather than just that a number moved.
  for (const [kind, n] of Object.entries(report.kinds)) {
    if (n === 0) findings.push(`no activity has kind "${kind}" — every ActivityKind must be exercised by the fixture`);
  }
  for (const [tag, n] of Object.entries(report.tags)) {
    if (n === 0) findings.push(`no activity has tag "${tag}" — every ActivityTag must be exercised by the fixture`);
  }

  // Lists that must be empty. Each one is a defect, not a count that drifted.
  const mustBeEmpty: [string, readonly (string | number)[]][] = [
    ["commands the domain rejected", report.rejections],
    ["days with no activities", report.emptyDays],
    ["days whose stops are stored out of chronological order", report.daysOutOfChronologicalOrder],
    ['notes still carrying a folded "(status)"', report.notesWithFoldedStatus],
    ["activities with no coordinates", report.activitiesWithoutCoordinates],
    ["canonical coordinates disagreeing with the geocode overlay", report.coordinateDisagreements],
    ["COORDINATE_OVERRIDES entries that no longer explain anything", report.staleOverrides],
  ];
  for (const [label, list] of mustBeEmpty) {
    if (list.length > 0) findings.push(`${label}: ${list.join("; ")}`);
  }

  return findings;
}
