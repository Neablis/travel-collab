import tzLookup from "@photostructure/tz-lookup";
import { AIRPORT_CODES_BY_ZONE } from "./airportTimeZones.generated";

// Coordinates and airport codes → IANA time zone, for `TripGlobals` (M14 link
// 11). **Server-only, and that is the decision rather than where it happened to
// land**: M14's "Decided 2026-09-24" defaults compute zones here and ship the
// browser a string, so no boundary dataset reaches a client bundle. The
// widgets do their arithmetic on that string with `Intl`, which every browser
// already carries.
//
// Two datasets, each named where it is loaded and in the contracts CHANGELOG:
//
// - `@photostructure/tz-lookup` (CC0-1.0; its data is derived from
//   timezone-boundary-builder, ODbL-1.0) for a stop's coordinates. ~73 kB,
//   ~29 kB gzipped, in memory, no I/O. It is lossy near borders — a day's zone
//   comes from a stop in a city, where it is right, not from a point in the
//   sea. geo-tz would be exact and is ~70 MB, which a serverless function pays
//   on every cold start.
// - `airportTimeZones.generated.ts` for the account's home airport, computed
//   offline with geo-tz from OurAirports (public domain). Its generator says
//   why the accurate lookup is affordable there and not here.
//
// Neither reads a clock, a file or the network, so both are pure functions of
// their arguments and `buildTripGlobals` stays one.

/**
 * The IANA zone at a point, or `null` for coordinates that are not a point.
 *
 * `null` rather than a throw: the contract already bounds `lat`/`lng`, so the
 * only way here with a bad pair is stored data no parse ran over, and one bad
 * stop must cost that day its zone rather than the whole projection its 500.
 */
export function timeZoneAt(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return tzLookup(lat, lng);
}

let zoneByAirport: Map<string, string> | undefined;

/**
 * The IANA zone of an IATA airport, or `null` when the code is not in the table.
 *
 * The account field is regex-validated and never looked up (`identity.ts`), so
 * a well-formed code that names no airport is ordinary input — it reports
 * "no home zone", the same as an unset field.
 */
export function timeZoneOfAirport(code: string | null): string | null {
  if (code === null) return null;
  if (zoneByAirport === undefined) {
    zoneByAirport = new Map();
    for (const [zone, codes] of Object.entries(AIRPORT_CODES_BY_ZONE)) {
      for (let i = 0; i < codes.length; i += 3) zoneByAirport.set(codes.slice(i, i + 3), zone);
    }
  }
  return zoneByAirport.get(code) ?? null;
}
