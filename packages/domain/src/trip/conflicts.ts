import { travellerIds, type Anchor, type Conflict, type TimeWindow } from "@tc/contracts";
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

// A pending stop (`kind: "pending"` — a Maybe, or one still To book, ADR-055)
// takes no part in an overlap: it is not a commitment yet, so another stop on
// top of it is not a clash. Mitchell, 2026-10-10 (feedback #8): "Pending events
// shouldn't be an overlap till they are no longer pending." Confirming the stop
// brings the conflict back under the same id; a dismissal made before it went
// pending lapses like any other undetected conflict's (KI-14), so it shows again.
const timeOverlapRule: Rule = (state, _ctx) => {
  const conflicts: Conflict[] = [];
  for (const day of state.days) {
    const timed: { id: string; title: string; window: TimeWindow }[] = [];
    for (const id of day.activityIds) {
      const activity = state.activities[id];
      if (activity && activity.timeWindow !== null && activity.kind !== "pending") {
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

// A distance is only a problem on a day where nothing accounts for crossing it.
// The rule: **if a day contains any `kind: "transit"` stop — timed or not,
// located or not, going anywhere — no pair on that day is checked.** A day with
// no transit stop compares every located pair against GEO_INFEASIBLE_KM, as it
// always has.
//
// Mitchell, 2026-09-30, option "B", chosen knowingly over a list-order
// heuristic. An external API user reported that every day with a transit leg
// still flagged: API-created stops often carry no times, and the rule this
// replaces could not use an untimed stop. That rule grew in three steps — KI-60
// (2026-08-28: excuse a pair only when a TIMED transit stop starts between two
// TIMED stops), M24 link 4 (its `endLocation`, when geocoded, must be near the
// later stop), and 2026-09-21 (a transit stop is never itself a pair member) —
// each removing some travel-day false positives, and none able to excuse a
// pair of untimed non-transit stops. The resolved entries KI-059 and KI-060 in
// docs/known-issues/resolved/ hold that history and the measurements.
//
// The trade-off, stated rather than left to be discovered: this can hide a
// genuinely wrong geocode on any day that also has a transit leg — a Kyoto
// temple mistyped into Osaka Bay on a shinkansen day no longer flags. The
// narrower rules caught some of those; this one catches none, and no other
// rule checks a coordinate.
const geographyRule: Rule = (state, _ctx) => {
  const conflicts: Conflict[] = [];
  for (const day of state.days) {
    const activities = day.activityIds.flatMap((id) => {
      const activity = state.activities[id];
      return activity ? [{ id, activity }] : [];
    });
    if (activities.some(({ activity }) => activity.kind === "transit")) continue;
    const located = activities.flatMap(({ id, activity }) =>
      activity.location && activity.location.lat !== undefined && activity.location.lng !== undefined
        ? [{ id, title: activity.title, place: activity.location.name, lat: activity.location.lat, lng: activity.location.lng }]
        : [],
    );
    for (let i = 0; i < located.length; i++) {
      for (let j = i + 1; j < located.length; j++) {
        const a = located[i]!;
        const b = located[j]!;
        const km = haversineKm(a, b);
        if (km <= GEO_INFEASIBLE_KM) continue;
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

/**
 * The over-budget conflict for a trip whose stops total `tripCostTotal`, or
 * none. Exported, not just a rule, because the total depends on who is on the
 * trip (ADR-060): `recostDetail` calls it again at read time for the effective
 * members, so the conflict, the banner and `budgetRemaining` read one number.
 * The id is the trip's alone, so a dismissal survives the total moving.
 */
export function overBudgetConflicts(
  trip: { tripId: string; currency: string; budget: { amountMinor: number } | null },
  tripCostTotal: number,
): Conflict[] {
  const { tripId, currency, budget } = trip;
  if (budget === null || tripCostTotal <= budget.amountMinor) return [];
  return [{
    id: `over-budget:${tripId}`,
    kind: "over-budget",
    severity: "warn",
    subjects: [tripId],
    description: `Trip total (${fmt(tripCostTotal, currency)}) exceeds the budget (${fmt(budget.amountMinor, currency)}) by ${fmt(tripCostTotal - budget.amountMinor, currency)}.`,
    resolutions: ["Raise the budget", "Remove or reduce a cost"],
  }];
}

// The log's members carry no `travelling` (it is Access data, travellers spec
// D1), so this counts every one of them and a rebuild matches what was stored.
// Through `travellerIds` all the same, so a state that does say who is
// travelling is costed by the one rule that reads it.
const budgetRule: Rule = (state, _ctx) =>
  overBudgetConflicts(state, rollupCosts(state, travellerIds(state.members).length).tripCostTotal);

// Rules are registered here; each is pure and individually testable
// (docs/guidelines/building-the-parts.md). Sorted output keeps the
// projection deterministic for the golden rebuild test.
const rules: Rule[] = [timeOverlapRule, geographyRule, anchorRule, budgetRule];

export function detectConflicts(state: TripState, ctx: ConflictContext = DEFAULT_CONFLICT_CONTEXT): Conflict[] {
  return sortConflicts(rules.flatMap((rule) => rule(state, ctx)));
}

/**
 * `conflicts` in the one order a detail stores them, by id, sorted in place.
 * Shared with `recostDetail`, which swaps the over-budget conflict at read
 * time and must leave the list exactly as the projection would have.
 */
export function sortConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.sort((a, b) => a.id.localeCompare(b.id));
}
