import type { Anchor, Conflict, TimeWindow } from "@tc/contracts";
import type { TripState } from "./state";
import { deriveDayDates } from "./dates";
import { anchorKey } from "./equality";
import { rollupCosts } from "./costs";

// 2-decimal display formatter (ADR-008 M4 simplification); pure and deterministic
// so the stored conflict description reproduces under the golden rebuild.
function fmt(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

// Same-day activities further apart than this are flagged as impossible
// geography. Deliberately crude in M1 — travel-time/gap math belongs with
// real dates in M3.
export const GEO_INFEASIBLE_KM = 150;

// Facts the pure engine cannot compute itself, injected by the caller (ADR-006).
export type ConflictContext = {
  isPublicHoliday: (countryCode: string, isoDate: string) => boolean;
  timezone: string;
};

// M3 default = the inert stub. `isPublicHoliday: () => true` means a
// publicHoliday anchor is ALWAYS satisfied (never a conflict). The rule really
// calls the oracle, so wiring `date-holidays` later is a one-line swap.
export const DEFAULT_CONFLICT_CONTEXT: ConflictContext = {
  isPublicHoliday: () => true,
  timezone: "America/Los_Angeles",
};

// DORMANT BY DECISION (Mitchell, 2026-07-28) — known-issues.md § "Dormant by
// decision", D-1. No UI reaches anchors: AnchorEditor and its entry points were
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

const geographyRule: Rule = (state, _ctx) => {
  const conflicts: Conflict[] = [];
  for (const day of state.days) {
    const located: { id: string; title: string; place: string; lat: number; lng: number }[] = [];
    for (const id of day.activityIds) {
      const activity = state.activities[id];
      if (
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
        });
      }
    }
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
