import { serverConfig } from "../config";
import { createLocationIQGeocoder } from "./locationiq";
import type { Geocoder } from "./geocoder";

export type { Geocoder, GeocodeResult, GeocodeOptions, LatLng, BoundingBox } from "./geocoder";

// One place picks the provider (ADR-007 seam). Swapping vendors is one line here.
export function getGeocoder(): Geocoder {
  const key = serverConfig.locationIqApiKey;
  if (!key) throw new Error("LOCATIONIQ_API_KEY is not set");
  return createLocationIQGeocoder(key);
}
