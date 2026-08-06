// Pure geometry for deciding whether a geocode result is believable (KI-15).
// No I/O and no vendor knowledge — `geocoding/` stays the vendor seam, this is
// AI-pipeline policy. Everything here is plain arithmetic so it can be tested
// exhaustively without mocks.

// The geo vocabulary lives on the geocoder seam (it appears in
// `Geocoder.forward`'s options), and is re-exported here so callers of these
// predicates need only one import.
import type { BoundingBox, LatLng } from "@/server/geocoding";
export type { BoundingBox, LatLng };

// Half a degree around 0,0 — roughly 55 km of open water in the Gulf of Guinea.
// Nothing we plan a trip to is in there, and "lat 0, lng 0" is precisely what
// the model emits when it does not know a coordinate. Treating that band as
// "no answer" is what lets a real model-supplied coordinate be trusted as a
// hint further down.
const NULL_ISLAND_DEGREES = 0.5;

// Returns the pair only if BOTH halves are present, finite, and not the
// model's "I don't know" sentinel. Narrowing to `LatLng | null` (rather than a
// boolean predicate) means callers cannot forget to check.
export function plausibleCoords(value: { lat?: number | null; lng?: number | null }): LatLng | null {
  const { lat, lng } = value;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) < NULL_ISLAND_DEGREES && Math.abs(lng) < NULL_ISLAND_DEGREES) return null;
  return { lat, lng };
}

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 111;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Great-circle distance. Precision well beyond what an acceptance threshold
// measured in tens of km needs — the point is only ever "same place or not".
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Smallest lat/lng box containing every point, padded by `marginKm`.
//
// KNOWN LIMITATION: this does not handle the antimeridian — a trip spanning
// ±180° longitude (Fiji, NZ-to-Hawaii) produces a box covering the whole globe
// the long way round. That degrades to "no useful bias", which is the current
// behavior for every trip anyway, so it fails safe rather than wrong. Left
// unfixed deliberately; revisit with M9's grounding work.
export function boundingBoxAround(points: readonly LatLng[], marginKm: number): BoundingBox | null {
  if (points.length === 0) return null;

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const latMargin = marginKm / KM_PER_DEGREE_LAT;
  // A degree of longitude shrinks toward the poles; the floor keeps the
  // division from exploding at very high latitudes.
  const midLat = (minLat + maxLat) / 2;
  const kmPerDegreeLng = Math.max(1, KM_PER_DEGREE_LAT * Math.cos(toRadians(midLat)));
  const lngMargin = marginKm / kmPerDegreeLng;

  return {
    minLat: clamp(minLat - latMargin, -90, 90),
    maxLat: clamp(maxLat + latMargin, -90, 90),
    minLng: clamp(minLng - lngMargin, -180, 180),
    maxLng: clamp(maxLng + lngMargin, -180, 180),
  };
}

export function withinBox(box: BoundingBox, point: LatLng): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}
