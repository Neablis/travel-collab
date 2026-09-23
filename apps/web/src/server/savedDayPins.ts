import { Location, type SavedStop } from "@tc/contracts";
import { placeNameVerdict } from "@/server/ai/geocodeNameMatch";
import type { GeocodeCharge } from "@/server/ai/geocodeEnrichment";
import { MIN_INTERVAL_MS } from "@/server/ai/rateLimit";
import type { Geocoder } from "@/server/geocoding";
import {
  boundingBoxAround,
  plausibleCoords,
  withinBox,
  type BoundingBox,
  type LatLng,
} from "@/server/geocoding/region";

// Putting a Playbook's stops on its map, on read (M27 link 10).
//
// **Why this exists.** Mitchell, on the preview, on a three-day Playbook of 14
// stops: *"Shouldnt there be a map here?"* Every stop carried
// `{ name, city }` and no coordinate — content is imported without them
// (content-bundles.md, "Coordinates") and `scripts/geocode-content.py` had not
// been run over it — so the map had nothing to place. His rule, which
// supersedes SPEC §16's list-only degrade: *a Playbook has a map whenever there
// is anything to place.*
//
// **Why on read, and why a Community write is allowed here.** Saved days are
// Community CRUD, not event-sourced (AGENTS.md module map; ADR-029), so writing
// `saved_days.stops` touches no planning projection. And a coordinate the
// server looked up is not an authored change: the author's name, city, notes
// and order are untouched, and the same lookup would give any reader the same
// answer. So any reader who can see the day may trigger the backfill, not only
// its owner. The public v1 API's owner-only read (`/api/v1/library/:id`)
// deliberately does not: it is a programmatic read that promises to return what
// is stored, and nobody is looking at a map there.
//
// **Once per stop.** Every stop this attempts leaves with a coordinate: its
// venue when the vendor corroborates it, else its city's centre marked
// `precision: "city"`. So a stop is looked up at most once, and a second read
// finds nothing to do. The two exceptions are a vendor failure (transient, so
// retried next read) and a city the vendor cannot find at all (whose stops are
// never looked up — see `pinStops`).
//
// **What it will not do**, borrowed from `geocodeEnrichment.ts`'s rule that
// enrichment may refine a location and never relocate it:
//   * a stop with any coordinate of its own is never looked up;
//   * a venue answer outside the city's box, or whose own name disagrees with
//     the stop's (`placeNameVerdict`, KI-39), is refused and the stop is pinned
//     at city level instead — "somewhere in Kyoto" is true, a wrong temple is
//     not;
//   * the author's `name` and `city` are never replaced by the vendor's.
//
// Pure over its ports, so every rule here is tested without a database or a
// vendor (`savedDayPins.test.ts`). The half that reads, writes and schedules is
// `savedDayPinBackfill.ts`.
//
// A new composition rather than a call to `enrichCommandLocations`: that
// function is shaped around a batch of trip COMMANDS and a model's coordinate
// hints, and its city fallback needs a `countryCode` these stops do not carry.
// What it is built from — the name verdict, the region arithmetic, the pace and
// the quota — is the same code.

/**
 * **Lookups one read may spend** — city centres and venues together.
 *
 * Paced at `MIN_INTERVAL_MS`, twelve lookups are about eight seconds of
 * background work, which is inside a serverless function's budget with room to
 * spare and bounds what one page view can cost the operator's key. A Playbook
 * with more is finished by the next read: the client re-reads while the
 * response says `pinning`, and each read picks up where the last stopped.
 */
export const MAX_PIN_LOOKUPS_PER_READ = 12;

/**
 * How far a venue may sit from its city's centre and still be in that city.
 * The same 50km `geocodeEnrichment.ts` allows around a single known point —
 * generous for a sprawling metro, nowhere near enough to reach the next city
 * of the same name.
 */
const CITY_MARGIN_KM = 50;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** A stop this can do something for: it names a city and has no coordinate. */
function wantsPin(stop: SavedStop): stop is SavedStop & { location: Location & { city: string } } {
  return stop.location != null && stop.location.city !== undefined && plausibleCoords(stop.location) === null;
}

/** Whether any stop could still be put on the map by a lookup. */
export function hasUnpinnedStops(stops: readonly SavedStop[]): boolean {
  return stops.some(wantsPin);
}

/** A location, with a coordinate added and nothing the author wrote replaced. */
function withPin(location: Location, pin: Partial<Location> & LatLng): Location | null {
  const parsed = Location.safeParse({ ...location, ...pin });
  // The stored parse is strict and drops the whole ROW on failure (KI-71), so a
  // location this cannot make valid is left exactly as it was.
  return parsed.success ? parsed.data : null;
}

export type PinDeps = {
  geocoder: Geocoder;
  /** One unit of the geocode quota per lookup; false stops the pass. */
  charge: GeocodeCharge;
  sleep?: (ms: number) => Promise<void>;
  cap?: number;
};

/**
 * The stops, with whatever this pass could place. Pure over its ports: the
 * geocoder, the quota and the clock are all injected.
 *
 * One city at a time, centre first: the centre is both the box a venue answer
 * must land in and the fallback pin when it does not. A city whose centre
 * cannot be found has its stops left alone, because a venue lookup with nothing
 * to check it against is how a Niagara dinner ended up in Shropshire (KI-15).
 *
 * Charged per lookup, just before it is made, and stopped at the first refusal
 * — `consumeQuota` counts before it compares, so asking again would inflate the
 * reader's count with lookups that never happened.
 */
export async function pinStops(
  stops: readonly SavedStop[],
  { geocoder, charge, sleep = defaultSleep, cap = MAX_PIN_LOOKUPS_PER_READ }: PinDeps,
): Promise<{ stops: SavedStop[]; lookups: number }> {
  const next = [...stops];
  let lookups = 0;
  let stopped = false;

  // Every lookup goes through here, so the pace and the budget cannot be
  // skipped by one of the two kinds of question.
  const lookUp = async (query: string, viewbox: BoundingBox | null) => {
    if (stopped || lookups >= cap) return "unaffordable" as const;
    if (!(await charge())) {
      stopped = true;
      return "unaffordable" as const;
    }
    if (lookups > 0) await sleep(MIN_INTERVAL_MS);
    lookups += 1;
    try {
      const [match] = await geocoder.forward(query, { limit: 1, ...(viewbox ? { viewbox } : {}) });
      return match ?? null;
    } catch {
      return "failed" as const;
    }
  };

  // **A city centre is looked up with no viewbox.** Biasing it toward the
  // Playbook's existing pins would be wrong for exactly the Playbooks that have
  // any: their cities are the author's and may be far apart (Tokyo, then Kyoto),
  // and a bias toward Tokyo is how "Kyoto" comes back as a restaurant of that
  // name in Shinjuku. A bare city name's top answer is the city.
  // A centre already stored on a city-level stop is reused, not bought again.
  const centres = new Map<string, LatLng>();
  for (const stop of stops) {
    const coords = stop.location ? plausibleCoords(stop.location) : null;
    if (coords && stop.location?.precision === "city" && stop.location.city) {
      centres.set(normalize(stop.location.city), coords);
    }
  }

  const byCity = new Map<string, { city: string; indices: number[] }>();
  stops.forEach((stop, i) => {
    if (!wantsPin(stop)) return;
    const key = normalize(stop.location.city);
    const group = byCity.get(key) ?? { city: stop.location.city, indices: [] };
    group.indices.push(i);
    byCity.set(key, group);
  });

  for (const [key, { city, indices }] of byCity) {
    let centre = centres.get(key) ?? null;
    if (centre === null) {
      const match = await lookUp(city, null);
      if (match === "unaffordable") break;
      const point = match !== null && match !== "failed" ? plausibleCoords(match) : null;
      if (point === null) continue;
      centre = point;
      centres.set(key, centre);
    }
    const box = boundingBoxAround([centre], CITY_MARGIN_KM)!;

    for (const i of indices) {
      const location = next[i]!.location!;
      const match = await lookUp(`${location.name}, ${city}`, box);
      if (match === "unaffordable") break;
      // A vendor failure is transient: leave the stop for the next read rather
      // than spend its one lookup on a city pin it may not need.
      if (match === "failed") continue;
      const point = match !== null ? plausibleCoords(match) : null;
      const accepted =
        match !== null &&
        point !== null &&
        withinBox(box, point) &&
        placeNameVerdict(location.name, match.canonicalName, [city]) !== "mismatch";
      const pinned = accepted
        ? withPin(location, {
            ...point,
            precision: "venue",
            // Filled only where the author left them empty — and never a
            // country that could disagree with an authored address.
            ...(match.countryCode && !location.countryCode && !location.address
              ? { countryCode: match.countryCode }
              : {}),
            ...(match.area && !location.area ? { area: match.area } : {}),
          })
        : withPin(location, { ...centre, precision: "city" });
      if (pinned !== null) next[i] = { ...next[i]!, location: pinned };
    }
    if (stopped || lookups >= cap) break;
  }

  return { stops: next, lookups };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
