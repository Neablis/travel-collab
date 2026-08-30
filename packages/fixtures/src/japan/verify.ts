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
  citiesOfStops,
  decideCreateTrip,
  decideTripCommand,
  detectConflicts,
  evolveTrip,
  rollupCosts,
  type TripState,
} from "@tc/domain";
import { deterministicMintId, japanTripCommands } from "./commands.ts";
import { COORDINATE_OVERRIDES } from "./coordinateOverrides.ts";
import { COORDINATE_GAPS } from "./coordinateGaps.ts";
import coordinatesOverlay from "./coordinates.json" with { type: "json" };
import { JAPAN_SAVED_DAYS } from "./savedDays.ts";
import { JAPAN_BACKLOG, JAPAN_STOPS, JAPAN_TRIP_NAME, REFERENCE_START_DATE } from "./trip.ts";

export { REFERENCE_START_DATE };

const REFERENCE_TRIP_ID = "00000000-0000-4000-8000-00000000f000";

// Moved to ./commands.ts, which the demo trip in apps/web also folds (ADR-031).
// Re-exported so `verify.test.ts` and `pnpm seed:verify` keep importing the
// harness from one place.
export { deterministicMintId };

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
  /**
   * Days carrying at least one stop the Calendar's `N to book` flag would
   * count (`apps/web/src/lib/needsBooking.ts`) — KI-86's guard against this
   * fixture drifting back toward 14 of 14 flagged. Mirrored rather than
   * imported for the same reason `daysWithUnlocatedStops` mirrors
   * mapRailData.ts below: apps/web imports this package, not the reverse.
   */
  daysNeedingBooking: number;
  /**
   * The demo library (M11b), measured per owner.
   *
   * Per OWNER rather than in total because the gate box is an agreement
   * between two surfaces about one person — "a profile's day count and adds
   * agree with the same person's numbers in Discover" — and a total cannot
   * catch a build that credits one person's days to the other.
   *
   * `cities` here is derived by the domain's `citiesOfStops`, the same rule
   * `saveDay` stores with. That is the point of measuring it rather than
   * reading it off the fixture: if the rule changes, this moves and the
   * expectations say so.
   */
  savedDaysByOwner: Record<string, SavedDayOwnerReport>;
  savedDayCount: number;
  /** Every city the library touches, sorted. Discover searches this set. */
  savedDayCities: string[];
  /** Findings. Every one of these is expected to be empty; a non-empty list is a failure. */
  rejections: string[];
  emptyDays: number[];
  daysOutOfChronologicalOrder: number[];
  notesWithFoldedStatus: string[];
  activitiesWithoutCoordinates: string[];
  daysWithUnlocatedStops: string[];
  coordinateDisagreements: string[];
  staleOverrides: string[];
  /**
   * Saved days no city search could ever return. A day with no located,
   * city-bearing stop is invisible in Discover, which is the only surface
   * M11b gives a saved day — so one in the demo library is the same defect as
   * a stop with no coordinates on the Map lens, and is listed the same way.
   */
  savedDaysWithNoCities: string[];
  /**
   * PUBLISHED days where no stop carries a price.
   *
   * A presence check, deliberately not a re-implementation of the budget rule:
   * the sum itself is `savedDayFacts` in `apps/web/src/lib`, and a second copy
   * of it here would be exactly the drift `cities` is derived rather than
   * authored to avoid. What this catches is the M18 tag-chip failure — Discover
   * filters on "budget each" and the shared-day rail states it, so a demo where
   * every published day is unpriced ships a control with nothing to act on and
   * a fact that reads "—" in every screenshot.
   */
  publishedSavedDaysWithNoPrice: string[];
  /**
   * Ledger rows the add rule says cannot exist: *an add only counts once per
   * trip, and copying your own day into your own trip does not count.* The
   * database enforces the first half — `saved_day_adds`' primary key is
   * (day, trip) — so a fixture that broke it would fail at seed time rather
   * than here. Both are listed because the fixture is what a build reads to
   * learn what a correct ledger looks like.
   */
  savedDayLedgerViolations: string[];
};

export type SavedDayOwnerReport = {
  days: number;
  /** Days this person has published. Private is the default, so this is a subset. */
  published: number;
  /** Ledger rows across all of this person's days — what the leaderboard ranks on. */
  adds: number;
  cities: string[];
};

const KM_TOLERANCE = 1;

/**
 * Great-circle distance in kilometres.
 *
 * A local copy rather than @tc/domain's: this module's whole job is to check
 * the fixture from outside, and the only place the distance is used is
 * comparing a canonical coordinate against the geocode overlay's proposal —
 * a measurement about the FIXTURE, not about a trip. Importing the domain's
 * version here would also put @tc/domain on a path the package deliberately
 * keeps off its public surface (see index.ts).
 */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Mirrors `apps/web/src/lib/needsBooking.ts`'s predicate exactly (`booked`
 * and `transit` never; `hold` and `idea` always; `planned` only when
 * `ticketed`) — a copy, not an import, for the dependency-direction reason
 * that function's own comment and `daysWithUnlocatedStops` below both give.
 * If that rule changes, this is the other half to change with it.
 */
function needsBookingMirror(kind: ActivityKind, tags: readonly ActivityTag[]): boolean {
  if (kind === "booked" || kind === "transit") return false;
  if (kind === "planned") return tags.includes("ticketed");
  return true;
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
    // BOTH components, matching what actually decides whether a stop can be
    // drawn: mapRailData.ts's `locatedStops` requires lat AND lng, and a day
    // with any unlocated stop renders "N stops have no place yet". Counting lat
    // alone would let a fixture that lost every lng report full coverage while
    // the Map lens flagged ten of fourteen days. (Same defect CodeRabbit found
    // in reset-demo-data's integration test on PR #74.)
    if (activity.location?.lat !== undefined && activity.location?.lng !== undefined) withCoordinates += 1;
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

  // The rendered property, not a proxy for it.
  //
  // `withCoordinates` above counts activities; what a reader of the Map lens
  // actually sees is a per-DAY flag. apps/web's mapRailData.ts builds
  // `locatedStops` from `day.activityIds`, requiring both lat and lng, and any
  // day with a shortfall renders "N stops have no place yet". A trip can hold
  // 72 coordinates and still flag ten of fourteen days if the missing ones
  // happen to be scheduled — which is exactly the state the preview branch was
  // in before ADR-030 (21 unlocated stops across 10 days).
  //
  // This mirrors that rule rather than importing it: mapRailData.ts is UI, and
  // apps/web imports this package, not the reverse (AGENTS.md's dependency
  // rules). The two must agree; if `locatedStops` ever changes what "located"
  // means, this is the other half to change with it.
  const daysWithUnlocatedStops: string[] = [];

  state.days.forEach((day, i) => {
    if (day.activityIds.length === 0) emptyDays.push(i + 1);

    const unlocated = day.activityIds.filter((id) => {
      const location = state.activities[id]?.location;
      return location?.lat === undefined || location?.lng === undefined;
    });
    if (unlocated.length > 0) {
      const titles = unlocated.map((id) => state.activities[id]?.title ?? id).join(", ");
      daysWithUnlocatedStops.push(
        `Day ${i + 1} would render "${unlocated.length === 1 ? "1 stop has" : `${unlocated.length} stops have`} no place yet" (${titles})`,
      );
    }
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

  // --- The demo library (M11b) --------------------------------------------
  const savedDaysByOwner: Record<string, SavedDayOwnerReport> = {};
  const savedDayCities = new Set<string>();
  const savedDaysWithNoCities: string[] = [];
  const publishedSavedDaysWithNoPrice: string[] = [];
  const savedDayLedgerViolations: string[] = [];
  const seenAdds = new Set<string>();

  for (const saved of JAPAN_SAVED_DAYS) {
    const cities = citiesOfStops(saved.stops);
    if (cities.length === 0) {
      savedDaysWithNoCities.push(`"${saved.name}" (${saved.ownerId}) would never match a city search`);
    }
    for (const city of cities) savedDayCities.add(city);

    if (saved.visibility === "public" && !saved.stops.some((stop) => stop.cost !== null)) {
      publishedSavedDaysWithNoPrice.push(
        `"${saved.name}" (${saved.ownerId}) would show no budget each in Discover`,
      );
    }

    const owner = (savedDaysByOwner[saved.ownerId] ??= { days: 0, published: 0, adds: 0, cities: [] });
    owner.days += 1;
    if (saved.visibility === "public") owner.published += 1;
    owner.adds += saved.addedBy.length;
    for (const city of cities) if (!owner.cities.includes(city)) owner.cities.push(city);

    for (const add of saved.addedBy) {
      const key = `${saved.savedDayId}:${add.tripId}`;
      if (seenAdds.has(key)) {
        savedDayLedgerViolations.push(`"${saved.name}" is added twice into trip ${add.tripId}`);
      }
      seenAdds.add(key);
      if (add.addedBy === saved.ownerId) {
        savedDayLedgerViolations.push(`"${saved.name}" is added by its own owner (${add.addedBy})`);
      }
    }
  }
  for (const owner of Object.values(savedDaysByOwner)) owner.cities.sort();

  const daysNeedingBooking = state.days.filter((day) =>
    day.activityIds.some((id) => {
      const activity = state.activities[id];
      return activity !== undefined && needsBookingMirror(activity.kind, activity.tags);
    }),
  ).length;

  // Wherever geocode-japan-seed.mts resolved a stop, the canonical row must
  // still agree with it. Without this, re-running the geocoder and pasting its
  // output over the overlay would silently diverge from the coordinates the app
  // actually stores (KI-39 is what that class of bug looks like).
  const overlay = coordinatesOverlay.coordinates as Record<string, { lat: number; lng: number }>;
  const coordinateDisagreements: string[] = [];
  const staleOverrides: string[] = [];

  // An override whose key names no row at all — a stop deleted, or its id
  // changed. Checked separately because the loop below only ever visits keys
  // that still exist as rows, so a dead key would otherwise be silently
  // unreachable and the guard would report less than it claims. (CodeRabbit,
  // PR #74.) A dead key is inert rather than dangerous, but an override list
  // that quietly stops describing reality is how the overlay got trusted in
  // the first place.
  const rowIds = new Set([...JAPAN_STOPS, ...JAPAN_BACKLOG].map((r) => r.id));
  for (const id of Object.keys(COORDINATE_OVERRIDES)) {
    if (!rowIds.has(id)) staleOverrides.push(`${id} is overridden but no stop or backlog item has that id`);
  }
  // The same dead-key check for the gap register. A gap naming no row explains
  // nothing, and an unreachable entry is how a list stops describing reality.
  for (const id of Object.keys(COORDINATE_GAPS)) {
    if (!rowIds.has(id)) staleOverrides.push(`${id} is recorded as a geocode gap but no stop or backlog item has that id`);
  }
  // A stop cannot be both "the overlay proposes something else" and "the
  // overlay has nothing". Listing it twice means one of the two is a lie.
  for (const id of Object.keys(COORDINATE_GAPS)) {
    if (id in COORDINATE_OVERRIDES) {
      staleOverrides.push(`${id} is in both COORDINATE_OVERRIDES and COORDINATE_GAPS — it cannot be both`);
    }
  }

  for (const row of [...JAPAN_STOPS, ...JAPAN_BACKLOG]) {
    const resolved = overlay[row.id];
    const overridden = row.id in COORDINATE_OVERRIDES;
    if (!resolved) {
      // An override for a stop the geocoder no longer resolves explains
      // nothing and would quietly mask a future disagreement.
      if (overridden) staleOverrides.push(`${row.id} is overridden but the overlay has no entry for it`);
      continue;
    }
    // The vendor DID resolve a stop we recorded as uncorroborable. Good news,
    // and the entry is now false: drop it rather than leave a record claiming
    // the place cannot be found. (The mirror of the "now agrees" check below.)
    if (row.id in COORDINATE_GAPS) {
      staleOverrides.push(`${row.id} is recorded in COORDINATE_GAPS but the overlay now resolves it — drop the gap`);
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
    daysNeedingBooking,
    savedDaysByOwner,
    savedDayCount: JAPAN_SAVED_DAYS.length,
    savedDayCities: [...savedDayCities].sort(),
    rejections,
    emptyDays,
    daysOutOfChronologicalOrder,
    notesWithFoldedStatus,
    activitiesWithoutCoordinates,
    daysWithUnlocatedStops,
    coordinateDisagreements,
    staleOverrides,
    savedDaysWithNoCities,
    publishedSavedDaysWithNoPrice,
    savedDayLedgerViolations,
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
  row("days needing booking", `${report.daysNeedingBooking}/${report.dayCount}`);
  row("saved days", report.savedDayCount);
  row("saved-day cities", report.savedDayCities.join(", "));
  for (const [ownerId, owner] of Object.entries(report.savedDaysByOwner).sort()) {
    row(`  ${ownerId}`, `${owner.days} days / ${owner.published} public / ${owner.adds} adds / ${owner.cities.join(", ")}`);
  }
  lines.push("");
  lines.push(findings.length === 0 ? "  OK — matches expectations." : `  ${findings.length} finding(s):`);
  for (const f of findings) lines.push(`    - ${f}`);
  return lines.join("\n");
}
