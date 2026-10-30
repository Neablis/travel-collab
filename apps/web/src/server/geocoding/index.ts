import { serverConfig } from "../config";
import { createLocationIQGeocoder } from "./locationiq";
import type { Geocoder } from "./geocoder";

export type { Geocoder, GeocodeResult, GeocodeOptions, LatLng, BoundingBox, PlaceSuggestion } from "./geocoder";

/** Whether a vendor key is set, for a caller that answers without the geocoder rather than failing. */
export function geocoderConfigured(): boolean {
  return serverConfig.locationIqApiKey !== "";
}

// One place picks the provider (ADR-007 seam). Swapping vendors is one line here.
export function getGeocoder(): Geocoder {
  const key = serverConfig.locationIqApiKey;
  if (!key) throw new Error("LOCATIONIQ_API_KEY is not set");
  return createLocationIQGeocoder(key);
}
