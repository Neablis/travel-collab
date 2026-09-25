import type { Anchor, Conflict, TimeWindow } from "@tc/contracts";
import type { TripState } from "./state";
import { deriveDayDates } from "./dates";
import { anchorKey } from "./equality";
import { rollupCosts } from "./costs";

// 2-decimal display formatter (ADR-008 M4 simplification); pure and deterministic
// so the stored conflict description reproduces under the golden rebuild.
// Thousands-grouped to match the UI's `formatAmount`/`formatMoney`
// (apps/web/src/components/lenses/formatMoney.ts, #22) — KI-2 fix: the
// over-budget conflict description and lens totals now render the same
// string for the same amount instead of silently disagreeing on grouping.
function fmt(minor: number, currency: string): string {
  const sign = minor < 0 ? "-" : "";
  const grouped = (Math.abs(minor) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${grouped} ${currency}`;
}

// Same-day activities further apart than this are flagged as impossible
// geography. Deliberately crude in M1 — travel-time/gap math belongs with
// real dates in M3.
export const GEO_INFEASIBLE_KM = 150;

// Facts the pure engine cannot compute itself, injected by the caller (ADR-006).
export type ConflictContext = {
  isPublicHoliday: (countryCode: string, isoDate: string) => boolean;
};

// M3 default = the inert stub. `isPublicHoliday: () => true` means a
// publicHoliday anchor is ALWAYS satisfied (never a conflict). The rule really
// calls the oracle, so wiring `date-holidays` later is a one-line swap.
export const DEFAULT_CONFLICT_CONTEXT: ConflictContext = {
  isPublicHoliday: () => true,
};

// DORMANT BY DECISION (Mitchell, 2026-07-28) — docs/known-issues/dormant/,
// entry D-1. No UI reaches anchors: AnchorEditor and its entry points were
// removed in M8 because anchors were never made legible (and `publicHoliday`
// had a permissive stub oracle, so it could never fire at all).
//
// These rules and their tests stay ON PURPOSE. If a change of yours breaks
// them, the build fails — that is the tripwire working. DECIDE: revive anchors
// with a real UI, or delete the feature. Do not reflexively repair code no user
// can reach.
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Weekday of a YYYY-MM-DD as a pure calendar fact (explicit UTC components — not
// a wall-clock read; timezone-independent for a plain date).
function weekdayOf(iso: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

function anchorViolated(anchor: Anchor, date: string | null, tw: TimeWindow | null, ctx: ConflictContext): boolean {
  switch (anchor.kind) {
    case "dayOfWeek":
      return date !== null && !anchor.days.includes(weekdayOf(date));
    case "dateRange":
      return date !== null && (date < anchor.from || date > anchor.to);
    case "timeOfDay":
      return tw !== null && !(anchor.window.start <= tw.start && tw.end <= anchor.window.end);
    case "publicHoliday":
      return date !== null && !ctx.isPublicHoliday(anchor.country, date);
  }
}

export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  // HH:mm strings compare correctly as strings
  return a.start < b.end && b.start < a.end;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Rule = (state: TripState, ctx: ConflictContext) => Conflict[];

const timeOverlapRule: Rule = (state, _ctx) => {
  const conflicts: Conflict[] = [];
  for (const day of state.days) {
    const timed: { id: string; title: string; window: TimeWindow }[] = [];
    for (const id of day.activityIds) {
      const activity = state.activities[id];
      if (activity && activity.timeWindow !== null) {
        timed.push({ id, title: activity.title, window: activity.timeWindow });
      }
    }
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const a = timed[i]!;
        const b = timed[j]!;
        if (!windowsOverlap(a.window, b.window)) continue;
        const s1 = a.id < b.id ? a.id : b.id;
        const s2 = a.id < b.id ? b.id : a.id;
        conflicts.push({
          id: `time-overlap:${day.dayId}:${s1}:${s2}`,
          kind: "time-overlap",
          severity: "warn",
          subjects: [s1, s2],
          description: `"${a.title}" and "${b.title}" overlap in time on the same day.`,
          resolutions: [
            "Change one activity's time window",
            "Move one activity to another day or the backlog",
          ],
        });
      }
    }
  }
  return conflicts;
};

// KI-60. A distance is only a problem if nothing on the day accounts for
// crossing it.
//
// Before this, `geographyRule` compared every same-day located pair against a
// flat GEO_INFEASIBLE_KM and never looked at `kind`, so a day where the trip
// legitimately relocates flagged every before/after pair. On the Japan demo
// that was 10 false conflicts across the two travel days — 4 on the
// Odawara -> Kyoto day and 6 on the Osaka -> Tokyo day — burying the two real
// (time-overlap) ones. Any user's travel day got the same treatment.
//
// M18 added `ActivityKind: "transit"` precisely so a surface could tell that a
// stop IS travel rather than a place you sit in; this rule predated it. A pair
// is now excused when a transit stop sits at or between the two stops IN TIME:
// the shinkansen that makes 400km on one day perfectly ordinary.
//
// Deliberately conservative in two ways, because a false negative here hides a
// real problem while a false positive is only noise:
//
//   1. TIME order, not stored order. `day.activityIds` is display order, which
//      a user can reorder without changing when anything happens.
//   2. A stop with NO time window cannot be placed in time, so it is never
//      excused — it still flags. "We don't know when this is" is not evidence
//      that travel covered it.
//
// As written in 2026-08 it could not check that the transit stop goes to the
// right place: nothing in the contract modelled a from/to (KI-59), so "some
// travel is scheduled in this interval" was the strongest available signal.
// That is still the whole rule for a transit stop with no destination; M24's
// addendum below covers one that has one.
//
// Both properties above are still exactly true OF THIS FUNCTION, but they no
// longer describe the whole rule: since 2026-09-21 a transit stop is excluded
// from the pairing altogether, so it is never a pair member whether or not it
// is timed. See the comment at that exclusion in `geographyRule` — it is a
// superset of this rule, not a replacement for it.
//
// M24 link 4 — the from/to KI-59 said nothing modelled. A
// transit stop with a located `endLocation` now also has to go to the right
// place: it excuses the pair only if its destination is within
// GEO_INFEASIBLE_KM of the pair's LATER stop (the one the travel is getting
// you to). The same constant that decides "far apart" decides "near", so no
// second distance is invented here. Strictly narrower than KI-60, never wider:
//
//   - A transit stop with NO `endLocation` (most of them) is KI-60's rule
//     exactly. A rule that got stricter for them would be a regression.
//   - An `endLocation` without coordinates is treated as no destination.
//     A name the geocoder never placed is absence of evidence, not a
//     disagreement.
//   - "Later" is by start time, like everything else here. When the two start
//     together neither is later, and a destination near either one agrees.
//   - The three conservative properties are untouched: the interval test
//     runs first and is unchanged.
type TransitLeg = { start: string; destination: { lat: number; lng: number } | null };

function transitExcusesDistance(
  a: { start: string | null; lat: number; lng: number },
  b: { start: string | null; lat: number; lng: number },
  transits: readonly TransitLeg[],
): boolean {
  if (a.start === null || b.start === null) return false;
  const lo = a.start <= b.start ? a.start : b.start;
  const hi = a.start <= b.start ? b.start : a.start;
  const later = a.start < b.start ? [b] : b.start < a.start ? [a] : [a, b];
  return transits.some(
    ({ start, destination }) =>
      // `>= lo` rather than `> lo` so a transit stop that IS one of the pair
      // excuses it — that stop is the thing doing the moving.
      start >= lo &&
      start <= hi &&
      (destination === null || later.some((stop) => haversineKm(destination, stop) <= GEO_INFEASIBLE_KM)),
  );
}

const geographyRule: Rule = (state, _ctx) => {
  const conflicts: Conflict[] = [];
  for (const day of state.days) {
    const located: {
      id: string;
      title: string;
      place: string;
      lat: number;
      lng: number;
      start: string | null;
    }[] = [];
    const transits: TransitLeg[] = [];
    for (const id of day.activityIds) {
      const activity = state.activities[id];
      if (activity?.kind === "transit" && activity.timeWindow) {
        const end = activity.endLocation;
        transits.push({
          start: activity.timeWindow.start,
          destination:
            end && end.lat !== undefined && end.lng !== undefined ? { lat: end.lat, lng: end.lng } : null,
        });
      }
      // A transit stop is never a MEMBER of a distance pair. Its coordinate is
      // where the movement STARTS, not a place the day has to be internally
      // consistent with, so the distance from it to anything else on the day
      // carries no information about feasibility — that distance IS the
      // journey. Mitchell, 2026-09-21: "Train: Lisbon to Porto" (Santa
      // Apolónia) flagged against "Ribeira and the Dom Luís I bridge" at
      // ~273 km — "This is a train route, and its spose to be really far apart".
      //
      // **This is KI-60's explicitly rejected weaker variant, added ALONGSIDE
      // the rule that replaced it rather than instead of it.** That rejection
      // stands on its own terms and is not being relitigated: *skip a pair if
      // either stop is transit* clears the Japan demo's day 7 but only 3 of
      // day 14's 6 pairs, leaving "Breakfast at the hotel" against the three
      // Tokyo stops. `transitExcusesDistance` still covers those. What it
      // could not cover is the stop itself, because it returns false unless
      // BOTH stops carry a `start` — so a transit stop with no time window, or
      // one paired with an untimed stop, still flagged. Superset, not swap.
      //
      // It narrows exactly one of KI-60's three conservative properties, and
      // only for the transit stop itself: an untimed transit stop still
      // excuses nothing for OTHER pairs — `transits` above is collected
      // unchanged, so "we don't know when this is" is still not evidence that
      // travel covered someone else's distance.
      //
      // The cost, stated plainly rather than left to be discovered: a mistyped
      // coordinate on a transit stop can no longer be caught by this rule, and
      // no other rule checks one.
      if (
        activity?.kind !== "transit" &&
        activity?.location &&
        activity.location.lat !== undefined &&
        activity.location.lng !== undefined
      ) {
        located.push({
          id,
          title: activity.title,
          place: activity.location.name,
          lat: activity.location.lat,
          lng: activity.location.lng,
          start: activity.timeWindow?.start ?? null,
        });
      }
    }
    for (let i = 0; i < located.length; i++) {
      for (let j = i + 1; j < located.length; j++) {
        const a = located[i]!;
        const b = located[j]!;
        const km = haversineKm(a, b);
        if (km <= GEO_INFEASIBLE_KM) continue;
        if (transitExcusesDistance(a, b, transits)) continue;
        const s1 = a.id < b.id ? a.id : b.id;
        const s2 = a.id < b.id ? b.id : a.id;
        conflicts.push({
          id: `impossible-geography:${day.dayId}:${s1}:${s2}`,
          kind: "impossible-geography",
          severity: "warn",
          subjects: [s1, s2],
          description: `"${a.title}" (${a.place}) and "${b.title}" (${b.place}) are ~${Math.round(km)} km apart on the same day.`,
          resolutions: ["Move one activity to another day", "Fix a mistyped coordinate"],
        });
      }
    }
  }
  return conflicts;
};

const anchorRule: Rule = (state, ctx) => {
  const conflicts: Conflict[] = [];
  const dayDates = deriveDayDates(state.startDate, state.days.length);
  const dateOf = new Map<string, string | null>();       // activityId → derived date (null = backlog/undated)
  state.days.forEach((day, i) => day.activityIds.forEach((id) => dateOf.set(id, dayDates[i]!)));
  for (const [id, activity] of Object.entries(state.activities)) {
    const date = dateOf.get(id) ?? null;
    for (const anchor of activity.anchors) {
      if (!anchorViolated(anchor, date, activity.timeWindow, ctx)) continue;
      const where = date ? `${date}` : "an unscheduled slot";
      conflicts.push({
        id: `anchor-violation:${id}:${anchorKey(anchor)}`,
        kind: "anchor-violation",
        severity: "warn",
        subjects: [id],
        description: `"${activity.title}" has an anchor its current placement (${where}) does not satisfy.`,
        resolutions: ["Shift the trip's dates", "Move the activity to a different day", "Edit or remove the anchor"],
      });
    }
  }
  return conflicts;
};

const budgetRule: Rule = (state, _ctx) => {
  if (state.budget === null) return [];
  const { tripCostTotal } = rollupCosts(state);
  if (tripCostTotal <= state.budget.amountMinor) return [];
  return [{
    id: `over-budget:${state.tripId}`,
    kind: "over-budget",
    severity: "warn",
    subjects: [state.tripId],
    description: `Trip total (${fmt(tripCostTotal, state.currency)}) exceeds the budget (${fmt(state.budget.amountMinor, state.currency)}) by ${fmt(tripCostTotal - state.budget.amountMinor, state.currency)}.`,
    resolutions: ["Raise the budget", "Remove or reduce a cost"],
  }];
};

// Rules are registered here; each is pure and individually testable
// (docs/guidelines/building-the-parts.md). Sorted output keeps the
// projection deterministic for the golden rebuild test.
const rules: Rule[] = [timeOverlapRule, geographyRule, anchorRule, budgetRule];

export function detectConflicts(state: TripState, ctx: ConflictContext = DEFAULT_CONFLICT_CONTEXT): Conflict[] {
  return rules.flatMap((rule) => rule(state, ctx)).sort((a, b) => a.id.localeCompare(b.id));
}
