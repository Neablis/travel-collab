import { iso1A2Code } from "@rapideditor/country-coder";
import type { LatLng } from "./geocoder";

/**
 * The ISO 3166-1 alpha-2 country a point is in, answered offline from the
 * borders bundled with `@rapideditor/country-coder`: no vendor call, no quota,
 * no rate limit. Null when the point is outside every border it knows (open
 * water past every coast; the borders reach out over coastal waters).
 *
 * **Territory level**, so a pin in San Juan answers PR rather than US: its own
 * ISO 3166-1 code, the standard `Location.countryCode` uses. The borders are
 * simplified, so a pin within a few hundred metres of a border can come back as the
 * neighbour; a caller that needs that settled asks the vendor (`countryAtPin`).
 */
export function countryAtPoint({ lat, lng }: LatLng): string | null {
  // A fresh options object each call: the library writes into the one it is given.
  const code = iso1A2Code([lng, lat], { level: "territory", maxLevel: "country" });
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
