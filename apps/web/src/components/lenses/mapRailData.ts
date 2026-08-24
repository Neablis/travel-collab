import type { TripDetail } from "@tc/contracts";
import { chipModel } from "@/components/trip/DayChips";
import { dayAccentFor, type AccentFamily } from "@/lib/dayAccent";
import { haversineKm } from "@/lib/geo";

export type MapStop = { activityId: string; title: string; lat: number; lng: number };

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
      stops.push({ activityId, title: activity!.title, lat: location.lat, lng: location.lng });
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

  return detail.days.map((day, index) => {
    const stops = locatedStops(day, detail.activities);
    const unlocatedCount = day.activityIds.length - stops.length;
    const legs = legKms(stops);
    const totalKm = stops.length >= 2 ? legs.reduce((sum, km) => sum + km, 0) : null;
    const accent = dayAccentFor(cities[index]?.city ?? null).solid;

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
export function routeLine(day: MapDay): [number, number][] {
  return day.stops.map((s) => [s.lng, s.lat]);
}
