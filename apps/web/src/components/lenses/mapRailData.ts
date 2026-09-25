import type { ActivityKind, ActivityMode, Location, TripDetail } from "@tc/contracts";
import { chipModel } from "@/lib/dayChips";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { haversineKm } from "@/lib/geo";

// `kind` rides along so the map can draw travel legs differently from the
// rest of the day (Mitchell, 2026-08-30 design pass: "Travel activity kinds
// should be dotted line, not solid"). MapLens is the only consumer; the rail
// and focus card ignore it.
// `precision` says what the coordinate DESCRIBES (contracts/src/activity.ts):
// `city` is a city centroid, so several stops of one day legitimately share it
// to the digit. Optional because absent means UNKNOWN — every location written
// before the field existed carries none, and that is not a claim of `venue`.
// MapLens groups on it (markerGroups below); the rail, the strip and the focus
// card ignore it.
// `end` is where a transit stop's leg arrives (M24's `endLocation`), set only
// when the stop is `transit` and both ends are located, so routeLegs can draw
// the leg itself. `mode` rides with it to style that leg. Neither gets a marker
// of its own: the line ending there is what shows the destination, and the stop
// that happens there next has its own pin.
export type MapStop = {
  activityId: string;
  title: string;
  lat: number;
  lng: number;
  kind: ActivityKind;
  precision?: Location["precision"];
  mode?: ActivityMode | null;
  end?: { lat: number; lng: number };
};

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
  /**
   * The day's longest hop, or null when there is nothing to travel between
   * (fewer than two located stops). Feeds the hover card's third note — the one
   * fact about a day's shape that "5 stops · 40 km" cannot carry.
   */
  longest: LongestLeg | null;
};

function locatedStops(day: TripDetail["days"][number], activities: TripDetail["activities"]): MapStop[] {
  const stops: MapStop[] = [];
  for (const activityId of day.activityIds) {
    const activity = activities[activityId];
    const location = activity?.location;
    if (location?.lat !== undefined && location.lng !== undefined) {
      // `kind` is checked, not trusted: the contract refuses an endLocation off
      // a transit stop on commands, but a read model never refuses a stored row.
      const end = activity!.kind === "transit" ? activity!.endLocation : null;
      stops.push({
        activityId,
        title: activity!.title,
        lat: location.lat,
        lng: location.lng,
        kind: activity!.kind,
        precision: location.precision,
        mode: activity!.mode ?? null,
        ...(end?.lat !== undefined && end.lng !== undefined ? { end: { lat: end.lat, lng: end.lng } } : {}),
      });
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

/**
 * Which rows should print the month alongside the date (M26 link 5b).
 *
 * The rail repeats "Sep" down every row of a September trip, which is noise:
 * the month only carries information where it CHANGES. So it prints on the
 * first dated row and at each month boundary, and nowhere else.
 *
 * **The milestone said to reuse `DayChips`'s `monthEdge`. There is no such
 * thing** — checked 2026-09-20: `DayChips` renders `dow` and `dateNum` (a
 * weekday and a day number) and shows no month at all, so the two surfaces were
 * never in the disagreement the milestone describes. This is a fresh
 * implementation, and the milestone has been corrected rather than left to send
 * the next reader looking for a function that does not exist.
 *
 * Undated days are skipped rather than breaking the run: a null date is not a
 * month boundary, and the next dated row still compares against the last month
 * actually seen.
 */
export function monthEdges(days: readonly { date: string | null }[]): boolean[] {
  let lastMonth: string | null = null;
  return days.map((day) => {
    if (day.date === null) return false;
    // The ISO date's own `YYYY-MM` prefix, so this never constructs a `Date`
    // and cannot drift across a timezone the way a parsed local date can.
    const month = day.date.slice(0, 7);
    const edge = month !== lastMonth;
    lastMonth = month;
    return edge;
  });
}

/** The longest single hop of a day, and the two stops it runs between. */
export type LongestLeg = { km: number; from: string; to: string };

/**
 * The longest leg of a day, or `null` when there is nothing to travel between.
 *
 * M26 link 5c: *"`longest` — the longest leg and its endpoints — is pure
 * derivation from coordinates and titles already on `MapStop`"*. It is the
 * hover card's third note, and it is the one fact about a day's shape that the
 * rail's own row cannot show: a day of five close stops and a day with one
 * two-hour hop read identically as "5 stops · 40 km".
 *
 * **Ties go to the EARLIEST leg**, not the last. `>` rather than `>=` keeps the
 * note stable as a reader hovers back and forth over the same day — two legs of
 * equal length would otherwise pick whichever the loop saw last, which is an
 * implementation detail leaking into copy.
 *
 * Fewer than two located stops is `null`, which is the caller's cue for the
 * *"A single anchor. Nothing to travel between."* note rather than an error.
 */
export function longestLeg(stops: readonly MapStop[]): LongestLeg | null {
  if (stops.length < 2) return null;
  let best: LongestLeg | null = null;
  for (let i = 1; i < stops.length; i++) {
    const km = haversineKm(stops[i - 1]!, stops[i]!);
    if (best === null || km > best.km) {
      best = { km, from: stops[i - 1]!.title, to: stops[i]!.title };
    }
  }
  return best;
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

    // **One bar per LEG, not per stop** (M26 link 5b). The bar row is a picture
    // of the day's travel, and travel happens between stops — so N stops make
    // N-1 bars. It used to make N, giving the first stop a bar of its own with
    // no leg under it: a phantom that took `1 / stops.length` of the width and
    // made every day's shape read a little wrong, worst on a two-stop day where
    // a single real leg was drawn as two bars of 50% each.
    //
    // A day with fewer than two located stops now renders NO bars, which is
    // correct: nothing was travelled. The even split remains only for the real
    // degenerate case — legs that exist but sum to zero, i.e. stops sharing one
    // coordinate — where proportion is undefined but the legs are real.
    const bars =
      legs.length === 0
        ? []
        : legs.map((km) => ({
            grow: totalKm !== null && totalKm > 0 ? km / totalKm : 1 / legs.length,
            color: accent,
          }));

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
      longest: longestLeg(stops),
    };
  });
}

/** The two route layers MapLens draws per day — see routeLegs for why two. */
export type RouteVariant = "rest" | "travel";

/**
 * How each transport mode draws (M24 link 3; Mitchell, 2026-09-25: two line
 * styles, matching the legend's two keys). Walking and cycling are the solid
 * line; everything with a vehicle is the dashed one. Two and not seven because
 * a dash pattern costs a layer (routeLegs), and nothing on the map yet needs to
 * tell a bus from a ferry. A `Record` over the whole enum, so an eighth mode is
 * a compile error here rather than a leg that silently draws one way.
 */
const MODE_VARIANT: Record<ActivityMode, RouteVariant> = {
  walk: "rest",
  bike: "rest",
  bus: "travel",
  train: "travel",
  flight: "travel",
  ferry: "travel",
  car: "travel",
};

/**
 * The style of a transit stop's own leg. No mode is dashed: the stop says it
 * is travel, only not by what, and solid is the claim "on foot or by bike".
 */
export function legVariant(mode: ActivityMode | null | undefined): RouteVariant {
  return mode == null ? "travel" : MODE_VARIANT[mode];
}

// GeoJSON order: [lng, lat], the opposite of maplibre's Marker#setLngLat
// argument order in some call sites. Getting this backwards puts every route
// in the ocean off West Africa.
/**
 * The day's route split into two sets of legs — dashed `travel` and solid
 * `rest` — for MapLens's two layers (Mitchell, 2026-08-30 design pass: "Travel
 * activity kinds should be dotted line, not solid"). Two sets rather than a
 * per-leg flag because `line-dasharray` is a plain paint property in
 * MapLibre: it takes no data-driven expression, so a dashed leg and a solid
 * one cannot share a layer however the feature is tagged.
 *
 * **A transit stop with a destination (`end`) is its own leg**, origin →
 * destination, styled by `legVariant(mode)`. The hops either side of it — the
 * previous stop to its origin, its destination to the next stop — are ordinary
 * legs, judged as if it were not transit: getting to the station is not the
 * train. The next hop leaves from the destination, not the origin, so the
 * route stays continuous and never draws the old guessed line (origin straight
 * to the next stop) beside the real one.
 *
 * **A transit stop without one keeps the adjacency rule exactly** — most have
 * none. Its point is the movement, so the hop that reaches it and the hop that
 * leaves it are both travel; dashing only one side left a solid half-leg
 * hanging off every train. Its mode is ignored, because it has no line of its
 * own for a mode to style.
 *
 * **A real leg that retraces one already drawn in the same style is drawn
 * once.** A day trip out and back by train is two legs on one path, and MapLibre
 * starts each line's dashes at its own first point: two dashed lines laid in
 * opposite directions fill each other's gaps and read as the solid line —
 * found walking the Japan fixture's day 4 (Asakusa → Nikkō and back).
 *
 * Legs come back in route order. A day with no located stops has none; a day
 * of one stop has none unless that stop is a leg itself.
 */
export function routeLegs(day: MapDay): Record<RouteVariant, [number, number][][]> {
  const legs: Record<RouteVariant, [number, number][][]> = { travel: [], rest: [] };
  const inferred = (stop: MapStop) => stop.kind === "transit" && stop.end === undefined;
  const drawn = new Set<string>();
  let prev: MapStop | undefined;
  for (const stop of day.stops) {
    if (prev !== undefined) {
      const from = prev.end ?? prev;
      legs[inferred(prev) || inferred(stop) ? "travel" : "rest"].push([
        [from.lng, from.lat],
        [stop.lng, stop.lat],
      ]);
    }
    if (stop.end !== undefined) {
      const variant = legVariant(stop.mode);
      const ends = [`${stop.lng}:${stop.lat}`, `${stop.end.lng}:${stop.end.lat}`].sort().join("|");
      if (!drawn.has(`${variant}|${ends}`)) {
        drawn.add(`${variant}|${ends}`);
        legs[variant].push([
          [stop.lng, stop.lat],
          [stop.end.lng, stop.end.lat],
        ]);
      }
    }
    prev = stop;
  }
  return legs;
}

/**
 * One marker per PLACE the day claims, not per stop — the grouping MapLens
 * draws its markers from.
 *
 * A `city`-precision coordinate is a city centroid, so every stop the geocoder
 * could only place at city level lands on the exact same point: a day of six
 * such stops used to stack six identical teardrops nobody could tell apart or
 * click past. Collapsing them into one marker is how the map stops saying
 * something false about the day — the same reason the offline pipeline withheld
 * city pins altogether (docs/guidelines/content-bundles.md).
 *
 * Only `city` stops group. Any other precision — including ABSENT, which means
 * unknown rather than `venue` — stays 1:1, even against an identical
 * coordinate: two stops that each claim a venue at one point are making a claim
 * this function is not entitled to merge.
 *
 * Grouping is within one day by construction, because markers are created and
 * ghosted per day (MapLens's `markersByDayRef`). Two days in the same city keep
 * their own disc, which is correct: colour means WHICH DAY.
 *
 * Groups come back in stop order, each at the position of its FIRST member —
 * the stop MapLens opens when the group is clicked.
 */
export type MarkerGroup = {
  lat: number;
  lng: number;
  /** City-level: MapLens draws a disc (an area claim), never a teardrop. */
  cityLevel: boolean;
  stops: MapStop[];
};

export function markerGroups(day: MapDay): MarkerGroup[] {
  const groups: MarkerGroup[] = [];
  const byCoordinate = new Map<string, MarkerGroup>();
  for (const stop of day.stops) {
    if (stop.precision !== "city") {
      groups.push({ lat: stop.lat, lng: stop.lng, cityLevel: false, stops: [stop] });
      continue;
    }
    // Exact equality, deliberately: this exists for stops that share ONE
    // centroid to the digit, and a distance threshold would silently merge two
    // genuinely different city centres that happen to be close.
    const key = `${stop.lat}:${stop.lng}`;
    const existing = byCoordinate.get(key);
    if (existing) {
      existing.stops.push(stop);
      continue;
    }
    const group: MarkerGroup = { lat: stop.lat, lng: stop.lng, cityLevel: true, stops: [stop] };
    byCoordinate.set(key, group);
    groups.push(group);
  }
  return groups;
}
