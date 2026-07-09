import type { Conflict, TimeWindow } from "@tc/contracts";
import type { TripState } from "./state";

// Same-day activities further apart than this are flagged as impossible
// geography. Deliberately crude in M1 — travel-time/gap math belongs with
// real dates in M3.
export const GEO_INFEASIBLE_KM = 150;

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

type Rule = (state: TripState) => Conflict[];

const timeOverlapRule: Rule = (state) => {
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

const geographyRule: Rule = (state) => {
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

// Rules are registered here; each is pure and individually testable
// (docs/guidelines/building-the-parts.md). Sorted output keeps the
// projection deterministic for the golden rebuild test.
const rules: Rule[] = [timeOverlapRule, geographyRule];

export function detectConflicts(state: TripState): Conflict[] {
  return rules.flatMap((rule) => rule(state)).sort((a, b) => a.id.localeCompare(b.id));
}
