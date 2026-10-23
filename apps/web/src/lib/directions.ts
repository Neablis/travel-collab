import type { ActivityMode, Location } from "@tc/contracts";

// Google Maps' `travelmode` for each of ours. A flight has none: nobody flies
// to dinner, and the app picks a sensible way when it is left out.
const TRAVEL_MODE: Record<ActivityMode, string | null> = {
  walk: "walking",
  bike: "bicycling",
  car: "driving",
  bus: "transit",
  train: "transit",
  ferry: "transit",
  flight: null,
};

/**
 * A link that opens directions to `location` in Google Maps (M52 decision 16):
 * the universal URL, which hands over to the app on Android and iOS where it is
 * installed. `mode` is the leg leading in, when a transit stop does.
 *
 * Coordinates are the destination unless they are only the city's
 * (`precision: "city"`, a geocoder that found the town and not the venue):
 * those point at the middle of town, so the name and address go instead and
 * Maps finds the place itself.
 */
export function directionsUrl(location: Location, mode?: ActivityMode | null): string {
  const params = new URLSearchParams({ api: "1", destination: destinationOf(location) });
  const travel = mode == null ? null : TRAVEL_MODE[mode];
  if (travel !== null) params.set("travelmode", travel);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function destinationOf(location: Location): string {
  if (location.lat !== undefined && location.lng !== undefined && location.precision !== "city") {
    return `${location.lat},${location.lng}`;
  }
  const { address } = location;
  const parts = address
    ? [location.name, ...address.lines, address.locality, address.postalCode]
    : [location.name, location.city];
  return parts.filter((part) => part !== undefined && part !== "").join(", ");
}
