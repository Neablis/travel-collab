// What leaves the building about a place (ADR-052 decision 6): a point rounded
// to two decimals — about 1.1 km north–south — and nothing finer.
//
// Coarser than MET Norway's four-decimal ceiling, which is a building and says
// which hotel; finer than "city level", which on a coast or in the mountains
// moves the point into the sea or up a valley. At two decimals a hotel and the
// museum next door share a cache row and a call.
//
// **`RoundedPoint` is branded, and `roundForExport` is its only constructor**,
// so an adapter's signature cannot be handed a raw stop coordinate: the type
// checker refuses it, which is a stronger promise than a comment asking.

declare const rounded: unique symbol;

/** A coordinate pair that has been through `roundForExport`, and so may be sent to an outside service. */
export type RoundedPoint = { readonly lat: number; readonly lng: number } & { readonly [rounded]: true };

const EXPORT_DECIMALS = 2;
const SCALE = 10 ** EXPORT_DECIMALS;

// `+ 0` turns -0 into 0, so a point just south of the equator and one just
// north of it round to the same key rather than "-0" and "0".
const round = (n: number) => Math.round(n * SCALE) / SCALE + 0;

/**
 * The only way to make a `RoundedPoint`. Longitude wraps into [-180, 180) so
 * that 180 and -180 — the same meridian — are one row.
 */
export function roundForExport(lat: number, lng: number): RoundedPoint {
  // Rounded before AND after the wrap: 179.996 rounds up onto the meridian
  // that the wrap then has to fold, and the fold's float arithmetic needs
  // rounding back to two places.
  const wrapped = ((((round(lng) + 180) % 360) + 360) % 360) - 180;
  return { lat: round(Math.max(-90, Math.min(90, lat))), lng: round(wrapped) } as RoundedPoint;
}

/** The point as the cache key and the query string both print it: fixed two decimals. */
export function pointText(point: RoundedPoint): { lat: string; lng: string } {
  return { lat: point.lat.toFixed(EXPORT_DECIMALS), lng: point.lng.toFixed(EXPORT_DECIMALS) };
}
