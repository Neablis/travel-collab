import { kmLabel } from "@/lib/units";
import { haversineKm } from "@/lib/geo";
import type { DayGeometry, MapLeg } from "./sharedDayGeometry";
import { allPoints } from "./sharedDayGeometry";

/** `MapHoverCard`'s idiom: take the unit off `kmLabel` rather than widening
 *  `lib/units`'s exports for one more caller. */
type DistanceUnit = Parameters<typeof kmLabel>[1];

// **The map panel's words** — M26 link 4b, `dc.html:7495-7527`.
//
// §16's panel is a canvas plus three derived things: a title, up to three
// key/value facts, and one sentence about the day's SHAPE. Only the canvas was
// built; this module is the rest, and it is pure for the same reason
// `sharedDayGeometry` is — none of it needs MapLibre to be right.
//
// **Every threshold below is a DECISION lifted from the artboard, not
// arithmetic.** They are named so that changing one is a deliberate act rather
// than a tweak to a magic number in an expression.

/** Above this, a leg is a ride rather than a walk (`dc.html:7497`). */
const RIDE_ABOVE_KM = 1.6;
/** Walking pace, km per minute — 4.5 km/h. */
const WALK_KM_PER_MIN = 0.075;
/** A ride's pace rises with its length: a metro hop is not an intercity train. */
const RIDE_KM_PER_MIN_LONG = 2.2;
const RIDE_KM_PER_MIN_MID = 1.0;
const RIDE_KM_PER_MIN_SHORT = 0.62;
const LONG_RIDE_KM = 60;
const MID_RIDE_KM = 12;
/** No leg is reported as instant; the floors are the artboard's. */
const MIN_RIDE_MINS = 8;
const MIN_WALK_MINS = 3;
/** Below this the day is a point, and "wander" would divide by ~nothing. */
const SPAN_FLOOR_KM = 0.4;
/** total/span: under this it is a line, under the next it is a loop. */
const WANDER_LINE = 1.5;
const WANDER_LOOP = 2.6;
/** A day is "mostly transit" only if it is BOTH lopsided and long. */
const TRANSIT_SHARE = 0.8;
const TRANSIT_MINS = 90;
/** Distances below this contribute no fact row — 50m of walking is noise. */
const FACT_FLOOR_KM = 0.05;

/** `95 min` -> `1h 35m`. Minutes below an hour stay minutes. */
export function minutesLabel(mins: number): string {
  const whole = Math.round(mins);
  if (whole < 60) return `${whole} min`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export type MapFact = { key: string; value: string };
export type MapPanel = {
  facts: readonly MapFact[];
  note: string;
  /** Keyed by the stop NUMBER the list shows, for the line under that stop. */
  gaps: ReadonlyMap<number, string>;
  /**
   * Whether any leg in view is a ride — what decides if the legend says "By
   * train or taxi" at all (`dc.html` `hasRides`). A legend entry for a line
   * style the map is not drawing would be a key to nothing.
   */
  hasRides: boolean;
};

/**
 * A leg is a ride when it is longer than a walk anybody would take — the one
 * rule both the panel's numbers and the map's dotted line read, so the legend
 * and the facts beside it cannot disagree about which legs were ridden.
 */
export function isRideLeg(leg: Pick<MapLeg, "from" | "to">): boolean {
  return haversineKm(leg.from, leg.to) > RIDE_ABOVE_KM;
}

/** A ride's minutes, at a pace that rises with its length. */
function rideMinutes(km: number): number {
  const perMin = km > LONG_RIDE_KM ? RIDE_KM_PER_MIN_LONG : km > MID_RIDE_KM ? RIDE_KM_PER_MIN_MID : RIDE_KM_PER_MIN_SHORT;
  return Math.max(MIN_RIDE_MINS, Math.round(km / perMin));
}

/**
 * The panel's derived text for one scope's geometry.
 *
 * **Walk vs ride is decided by DISTANCE alone**, and that is link 5c's answer
 * rather than an omission: the artboard's `ride` also consults a `transit` flag
 * per stop (`pts[j].transit`), and no saved stop carries one. Distance is the
 * half we can honestly compute, and `km > 1.6` is the artboard's own number.
 */
export function mapPanel(geometry: readonly DayGeometry[], unit: DistanceUnit): MapPanel {
  const gaps = new Map<number, string>();
  let walkKm = 0;
  let rideKm = 0;
  let walkMins = 0;
  let rideMins = 0;

  for (const day of geometry) {
    for (const leg of day.legs) {
      // **A non-contiguous leg is not a journey.** `sharedDayGeometry` marks a
      // leg `contiguous: false` when one or more stops WITHOUT a location sit
      // between its two ends, so its straight line skips everything the
      // traveller actually did in between. Its distance understates the real
      // one and its minutes are derived from that understatement, so totalling
      // it would put a figure nobody walked or rode into `On foot` and `By
      // train or taxi`, and shorten `wander` — which reads `total / span`.
      //
      // No gap label either, for the same reason: `12 min walk · 0.9 km`
      // printed between stop 1 and stop 3 describes a walk that skipped stop 2.
      // Saying nothing there claims nothing. (CodeRabbit, PR #197, which asked
      // for the aggregates; the label follows from the same argument.)
      if (!leg.contiguous) continue;

      const km = haversineKm(leg.from, leg.to);
      const ride = isRideLeg(leg);
      const mins = ride ? rideMinutes(km) : Math.max(MIN_WALK_MINS, Math.round(km / WALK_KM_PER_MIN));
      if (ride) {
        rideKm += km;
        rideMins += mins;
      } else {
        walkKm += km;
        walkMins += mins;
      }
      gaps.set(leg.from.number, `${minutesLabel(mins)}${ride ? " by train or taxi" : " walk"} · ${kmLabel(km, unit)}`);
    }
  }

  // The widest separation of any two points, which is not the longest LEG: a
  // day that ends where it started has a long route and a small span, and that
  // difference is exactly what `wander` reads.
  const points = allPoints(geometry);
  let span = 0;
  for (const a of points) {
    for (const b of points) {
      const v = haversineKm(a, b);
      if (v > span) span = v;
    }
  }

  const total = walkKm + rideKm;
  const wander = span > SPAN_FLOOR_KM ? total / span : 1;
  const transitShare = total > 0 ? rideKm / total : 0;

  // Several days at once (`All days` on a multi-day Playbook) get the
  // artboard's own sentence (`dc.html:7840`): "a loop" or "one clean line"
  // describes ONE day's walk, and said of three days it would describe a route
  // nobody took, since no line is drawn across a night.
  const note =
    geometry.length > 1
      ? `All ${geometry.length} days at once. Each day is its own line — nothing is drawn across a night.`
      : transitShare > TRANSIT_SHARE && rideMins > TRANSIT_MINS
      ? `Mostly transit — about ${minutesLabel(rideMins)} of the day is spent moving.`
      : wander < WANDER_LINE
        ? "One clean line. It never doubles back on itself."
        : wander < WANDER_LOOP
          ? "A loop — it ends near where it started."
          : "It criss-crosses. Expect to cover the same ground twice.";

  const facts: MapFact[] = [];
  if (walkKm > FACT_FLOOR_KM) facts.push({ key: "On foot", value: `${kmLabel(walkKm, unit)} · ${minutesLabel(walkMins)}` });
  if (rideKm > FACT_FLOOR_KM) {
    facts.push({ key: "By train or taxi", value: `${kmLabel(rideKm, unit)} · ${minutesLabel(rideMins)}` });
  }
  facts.push({ key: "Widest point to point", value: kmLabel(span, unit) });

  return { facts, note, gaps, hasRides: rideKm > FACT_FLOOR_KM };
}

/** `Kyoto → Osaka`, or the single city. Empty when no stop names one. */
export function mapTitle(cities: readonly string[]): string {
  const seen: string[] = [];
  for (const c of cities) if (c !== "" && !seen.includes(c)) seen.push(c);
  return seen.join(" → ");
}

/**
 * The focus card's note when the map shows places but no route (M27 link 10).
 * Says why there is no line, rather than leaving a reader to wonder whether the
 * map failed to draw one.
 */
export function placesNote(pins: number): string {
  return pins === 0
    ? "The stops aren't pinned on the map yet — here's where the day happens."
    : "Only one stop is pinned so far, so there's no route to draw yet.";
}
