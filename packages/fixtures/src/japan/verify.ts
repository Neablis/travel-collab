// Does the canonical Japan trip still describe a valid, rich trip?
//
// The fixture is load-bearing in three places at once: it is what the homepage
// hero renders, what the preview branch's reset button produces, and what any
// test opting into real richness gets. When a feature lands and the fixture
// does not grow with it, all three quietly go thin — the tag chips have nothing
// to chip, the map has nothing to plot — and nothing fails. This module is what
// fails instead.
//
// It runs the REAL domain: every command goes through `decideTripCommand` and
// `evolveTrip`, and the resulting state through `rollupCosts` and
// `detectConflicts`. No database, no HTTP, no clock — so it is fast enough to
// live in `pnpm check` and deterministic enough to assert exact numbers.
// A command the domain would reject shows up here as a rejection, which is the
// same thing `db:seed` would hit at runtime, found earlier.

import type { ActivityKind, ActivityTag, TripEvent } from "@tc/contracts";
import { ActivityKind as ActivityKindEnum, ActivityTag as ActivityTagEnum } from "@tc/contracts";
import {
  decideCreateTrip,
  decideTripCommand,
  detectConflicts,
  evolveTrip,
  rollupCosts,
  type TripState,
} from "@tc/domain";
import { japanTripCommands } from "./commands.ts";
import { COORDINATE_OVERRIDES } from "./coordinateOverrides.ts";
import coordinatesOverlay from "./coordinates.json" with { type: "json" };
import { JAPAN_BACKLOG, JAPAN_STOPS, JAPAN_TRIP_NAME, REFERENCE_START_DATE } from "./trip.ts";

export { REFERENCE_START_DATE };

const REFERENCE_TRIP_ID = "00000000-0000-4000-8000-00000000f000";

/** Counter-derived uuids, so two runs produce byte-identical commands. */
export function deterministicMintId(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

export type JapanTripReport = {
  dayCount: number;
  scheduledCount: number;
  backlogCount: number;
  activityCount: number;
  /** Every ActivityKind, including ones at zero — a zero is the interesting case. */
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
  /** Findings. Every one of these is expected to be empty; a non-empty list is a failure. */
  rejections: string[];
  emptyDays: number[];
  daysOutOfChronologicalOrder: number[];
  notesWithFoldedStatus: string[];
  activitiesWithoutCoordinates: string[];
  coordinateDisagreements: string[];
  staleOverrides: string[];
};

const KM_TOLERANCE = 1;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Folds the fixture's commands through the real domain and reports on the result. */
export function verifyJapanTrip(startDate: string = REFERENCE_START_DATE): JapanTripReport {
  const ctx = { actorId: "00000000-0000-4000-8000-00000000a000" };
  const rejections: string[] = [];

  const genesis = decideCreateTrip(null, { type: "CreateTrip", tripId: REFERENCE_TRIP_ID, name: JAPAN_TRIP_NAME, forkedFrom: null }, ctx);
  if (!genesis.ok) throw new Error(`CreateTrip rejected: ${genesis.rejection.message}`);
  let state: TripState = genesis.events.reduce<TripState | null>((s, e: TripEvent) => evolveTrip(s, e), null)!;

  for (const command of japanTripCommands(REFERENCE_TRIP_ID, { startDate, mintId: deterministicMintId() })) {
    const decision = decideTripCommand(state, command, ctx);
    if (!decision.ok) {
      rejections.push(`${command.type}: ${decision.rejection.code} — ${decision.rejection.message}`);
      continue;
    }
    for (const event of decision.events) state = evolveTrip(state, event);
  }

  // Start from every enum member at zero. A kind or tag the fixture stopped
  // covering must read 0, not vanish from the report — an absent key compares
  // equal to nothing and would slip past the expectations diff.
  const kinds = Object.fromEntries(ActivityKindEnum.options.map((k) => [k, 0])) as Record<ActivityKind, number>;
  const tags = Object.fromEntries(ActivityTagEnum.options.map((t) => [t, 0])) as Record<ActivityTag, number>;

  let untaggedCount = 0;
  let withCoordinates = 0;
  let withCost = 0;
  const cities = new Set<string>();
  const currencies = new Set<string>();
  const notesWithFoldedStatus: string[] = [];
  const activitiesWithoutCoordinates: string[] = [];

  // The exact shape M18 removed from notes: a whole-word workflow status in
  // parentheses, e.g. "(transit)". `who` is folded the same way — "(Jonah M)" —
  // so this matches the status vocabulary specifically, not any parenthetical.
  const foldedStatus = new RegExp(`\\((${ActivityKindEnum.options.join("|")})\\)`, "i");

  for (const [, activity] of Object.entries(state.activities)) {
    kinds[activity.kind] += 1;
    if (activity.tags.length === 0) untaggedCount += 1;
    for (const tag of activity.tags) tags[tag] += 1;
    if (activity.location?.lat !== undefined) withCoordinates += 1;
    else activitiesWithoutCoordinates.push(activity.title);
    if (activity.location?.city) cities.add(activity.location.city);
    if (activity.cost) {
      withCost += 1;
      currencies.add(activity.cost.currency);
    }
    if (activity.notes && foldedStatus.test(activity.notes)) notesWithFoldedStatus.push(activity.title);
  }

  const emptyDays: number[] = [];
  const daysOutOfChronologicalOrder: number[] = [];
  state.days.forEach((day, i) => {
    if (day.activityIds.length === 0) emptyDays.push(i + 1);
    const starts = day.activityIds.map((id) => state.activities[id]?.timeWindow?.start ?? "");
    // Rendered verbatim by the Day-columns lens and the calendar cells, so a
    // day stored out of order reads 9pm-first on screen (design audit A1).
    for (let j = 1; j < starts.length; j++) {
      if (starts[j]! < starts[j - 1]!) {
        daysOutOfChronologicalOrder.push(i + 1);
        break;
      }
    }
  });

  const conflictsByKind: Record<string, number> = {};
  const conflicts = detectConflicts(state);
  for (const c of conflicts) conflictsByKind[c.kind] = (conflictsByKind[c.kind] ?? 0) + 1;

  // Wherever geocode-japan-seed.mts resolved a stop, the canonical row must
  // still agree with it. Without this, re-running the geocoder and pasting its
  // output over the overlay would silently diverge from the coordinates the app
  // actually stores (KI-39 is what that class of bug looks like).
  const overlay = coordinatesOverlay.coordinates as Record<string, { lat: number; lng: number }>;
  const coordinateDisagreements: string[] = [];
  const staleOverrides: string[] = [];
  for (const row of [...JAPAN_STOPS, ...JAPAN_BACKLOG]) {
    const resolved = overlay[row.id];
    const overridden = row.id in COORDINATE_OVERRIDES;
    if (!resolved) {
      // An override for a stop the geocoder no longer resolves explains
      // nothing and would quietly mask a future disagreement.
      if (overridden) staleOverrides.push(`${row.id} is overridden but the overlay has no entry for it`);
      continue;
    }
    const km = haversineKm(row, resolved);
    if (km > KM_TOLERANCE) {
      if (!overridden) {
        coordinateDisagreements.push(
          `${row.id} (${row.title}): canonical is ${km.toFixed(1)}km from the geocoded value, and is not in COORDINATE_OVERRIDES`,
        );
      }
    } else if (overridden) {
      staleOverrides.push(`${row.id} is overridden but now agrees with the overlay — drop the override`);
    }
  }

  return {
    dayCount: state.days.length,
    scheduledCount: state.days.reduce((n, d) => n + d.activityIds.length, 0),
    backlogCount: state.backlog.length,
    activityCount: Object.keys(state.activities).length,
    kinds,
    tags,
    untaggedCount,
    withCoordinates,
    withCost,
    cities: [...cities].sort(),
    budgetMinor: state.budget?.amountMinor ?? 0,
    plannedTotalMinor: rollupCosts(state).tripCostTotal,
    currencies: [...currencies].sort(),
    conflictsByKind,
    conflictTotal: conflicts.length,
    rejections,
    emptyDays,
    daysOutOfChronologicalOrder,
    notesWithFoldedStatus,
    activitiesWithoutCoordinates,
    coordinateDisagreements,
    staleOverrides,
  };
}

/**
 * The report as a readable table, for `pnpm seed:verify`.
 *
 * Printing lives behind SEED_VERIFY_REPORT rather than always-on because this
 * same suite runs inside `pnpm check`, where 30 lines of fixture stats on every
 * run is noise. The assertions run either way; only the narration is optional.
 */
export function formatReport(report: JapanTripReport, findings: readonly string[]): string {
  const lines: string[] = [];
  const row = (label: string, value: unknown) => lines.push(`  ${label.padEnd(26)} ${String(value)}`);
  const histogram = (h: Record<string, number>) =>
    Object.entries(h)
      .map(([k, n]) => `${k} ${n}`)
      .join(" / ");

  lines.push("The canonical Japan trip");
  row("days", report.dayCount);
  row("stops (scheduled)", report.scheduledCount);
  row("backlog", report.backlogCount);
  row("activities", report.activityCount);
  row("kinds", histogram(report.kinds));
  row("tags", `${histogram(report.tags)} / untagged ${report.untaggedCount}`);
  row("with coordinates", `${report.withCoordinates}/${report.activityCount}`);
  row("with a cost", `${report.withCost}/${report.activityCount}`);
  row("cities", report.cities.join(", "));
  row("budget", `${report.budgetMinor / 100} ${report.currencies.join("/") || "—"}`);
  row("planned", `${report.plannedTotalMinor / 100} ${report.currencies.join("/") || "—"}`);
  row("conflicts", `${report.conflictTotal} (${histogram(report.conflictsByKind)})`);
  lines.push("");
  lines.push(findings.length === 0 ? "  OK — matches expectations." : `  ${findings.length} finding(s):`);
  for (const f of findings) lines.push(`    - ${f}`);
  return lines.join("\n");
}
