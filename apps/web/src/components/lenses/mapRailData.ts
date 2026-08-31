import type { ActivityKind, TripDetail } from "@tc/contracts";
import { chipModel } from "@/components/trip/DayChips";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { haversineKm } from "@/lib/geo";

// `kind` rides along so the map can draw travel legs differently from the
// rest of the day (Mitchell, 2026-08-30 design pass: "Travel activity kinds
// should be dotted line, not solid"). MapLens is the only consumer; the rail
// and focus card ignore it.
export type MapStop = { activityId: string; title: string; lat: number; lng: number; kind: ActivityKind };

export type MapDay = {
  index: number;
  dayId: string;
  label: string; // "Day 1"
  date: string | null; // raw ISO date, formatted by the component
  city: string | null;
  accent: AccentFamily;
  stops: MapStop[]; // located stops, in the day's activity order
  unlocatedCount: number;
  totalKm: number | null; // summed straight-line legs; null with fewer than 2 located stops
  bars: { grow: number; color: AccentFamily }[]; // one per located stop, grow proportional to that leg's share
  // A day with no stops at all. Deliberately NOT folded into `flagText`: the
  // Phase 6 copy table gives the map's two surfaces *different* strings for
  // this one state — the rail says "Nothing planned yet" (it is a list of
  // days, and that row's job is to say what the day holds), the focus card
  // says "No stops yet" (it is a card about one already-chosen day, where the
  // subject is the stops). One shared pre-rendered string cannot serve both,
  // so this model carries the fact and each surface renders its own copy.
  isEmpty: boolean;
  // The *unlocated-stops* flag only — a day that has stops but can't draw all
  // of them: "1 stop has no place yet" | "N stops have no place yet" | null.
  // An empty day sets `isEmpty` instead and leaves this null; the two are
  // mutually exclusive by construction (no stops means nothing unlocated).
  flagText: string | null;
};

function locatedStops(day: TripDetail["days"][number], activities: TripDetail["activities"]): MapStop[] {
  const stops: MapStop[] = [];
  for (const activityId of day.activityIds) {
    const activity = activities[activityId];
    const location = activity?.location;
    if (location?.lat !== undefined && location.lng !== undefined) {
      stops.push({ activityId, title: activity!.title, lat: location.lat, lng: location.lng, kind: activity!.kind });
    }
  }
  return stops;
}

// Legs are consecutive located-stop pairs, in stop order — the same
// straight-line honesty TimelineLens.tsx's Leg component uses for a single
// gap, summed across a whole day here.
function legKms(stops: MapStop[]): number[] {
  const kms: number[] = [];
  for (let i = 1; i < stops.length; i++) {
    kms.push(haversineKm(stops[i - 1]!, stops[i]!));
  }
  return kms;
}

export function mapDays(detail: TripDetail): MapDay[] {
  const cities = chipModel(detail);
  // One dayAccents() call over the whole trip's cities, so collisions
  // between two days of this trip get probed against each other rather than
  // each day resolving blind to every other one.
  const accents = dayAccents(cities.map((c) => c.city));

  return detail.days.map((day, index) => {
    const stops = locatedStops(day, detail.activities);
    const unlocatedCount = day.activityIds.length - stops.length;
    const legs = legKms(stops);
    const totalKm = stops.length >= 2 ? legs.reduce((sum, km) => sum + km, 0) : null;
    const accent = accents[index]?.solid ?? "neutral";

    // One bar per located stop: legs share proportionally by distance when we
    // have a real total, else split evenly (a single located stop, or a day
    // whose stops happen to share one coordinate, still renders a bar row).
    const bars =
      stops.length === 0
        ? []
        : stops.map((_, i) => {
            const grow =
              totalKm !== null && totalKm > 0 && i > 0 ? legs[i - 1]! / totalKm : 1 / stops.length;
            return { grow, color: accent };
          });

    const flagText =
      unlocatedCount > 0
        ? unlocatedCount === 1
          ? "1 stop has no place yet"
          : `${unlocatedCount} stops have no place yet`
        : null;

    return {
      index,
      dayId: day.dayId,
      label: `Day ${index + 1}`,
      date: day.date,
      city: cities[index]?.city ?? null,
      accent,
      stops,
      unlocatedCount,
      totalKm,
      bars,
      isEmpty: day.activityIds.length === 0,
      flagText,
    };
  });
}

// GeoJSON order: [lng, lat], the opposite of maplibre's Marker#setLngLat
// argument order in some call sites. Getting this backwards puts every route
// in the ocean off West Africa.
/**
 * The day's route split into two sets of legs — the ones that touch a
 * `transit` stop, and the ones that don't — so MapLens can draw the first
 * dashed and the second solid (Mitchell, 2026-08-30 design pass: "Travel
 * activity kinds should be dotted line, not solid"). Two sets rather than a
 * per-leg flag because `line-dasharray` is a plain paint property in
 * MapLibre: it takes no data-driven expression, so a dashed leg and a solid
 * one cannot share a layer however the feature is tagged.
 *
 * A leg counts as travel when **either** end of it is a transit stop, not
 * just the one it arrives at. A "Train to Kyoto" stop is the movement itself,
 * so the hop that reaches it and the hop that leaves it are both part of
 * that movement; dashing only one side left a solid half-leg hanging off
 * every train.
 *
 * Legs are consecutive pairs in stop order, the same pairing `legKms()` uses.
 * A day with fewer than two located stops has no legs and yields two empty
 * lists.
 */
export function routeLegs(day: MapDay): { travel: [number, number][][]; rest: [number, number][][] } {
  const travel: [number, number][][] = [];
  const rest: [number, number][][] = [];
  for (let i = 1; i < day.stops.length; i++) {
    const from = day.stops[i - 1]!;
    const to = day.stops[i]!;
    const leg: [number, number][] = [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ];
    (from.kind === "transit" || to.kind === "transit" ? travel : rest).push(leg);
  }
  return { travel, rest };
}
