import { serverConfig } from "../../config";
import { offlineCoverPhotos } from "./offline";
import { createUnsplash } from "./unsplash";
import type { CoverPhotos } from "./ports";

export type { CoverPhotos } from "./ports";
export { UpstreamError } from "./ports";

// One place picks the cover source (ADR-007's seam, as `getGeocoder()` and
// `getForecast()` are). **Only the cover routes may import this module**
// (`eslint.config.mjs`, the Unsplash wall): that, and the int test that spies
// on it across `GET /api/trips` and `GET /api/trips/:id`, is what holds "no
// page view calls Unsplash" (M37 D2).

// Read per call, as `server/external/weather` reads it, so a test can flip it.
const offline = () => process.env.EXTERNAL_DATA_OFFLINE === "true";

/**
 * The cover source: the offline fake when `EXTERNAL_DATA_OFFLINE=true`, else
 * Unsplash with `UNSPLASH_ACCESS_KEY`, else `null` — covers are not set up on
 * this deployment, and the routes say so rather than failing.
 */
export function getCoverPhotos(): CoverPhotos | null {
  if (offline()) return offlineCoverPhotos;
  const key = serverConfig.unsplashAccessKey;
  return key ? createUnsplash(key) : null;
}
