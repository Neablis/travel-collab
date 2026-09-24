import { serverConfig } from "../../config";
import { createMetNorwayForecast } from "./met-norway";
import { createNasaPowerClimate } from "./nasa-power";
import { UpstreamError, type Climate, type Forecast } from "./ports";

export type { Climate, Forecast } from "./ports";

// One place picks each provider (ADR-052 decision 1, ADR-007's seam). Swapping
// one — Open-Meteo's paid plan for "typical", if NASA POWER fails verification
// — is one line here.

// Production's public host: MET asks for the app's site in the User-Agent, and
// a preview's host is not the app anyone would contact.
const APP_SITE = "https://caesura.today";
const APP_VERSION = "0.0.1";

/**
 * **No automated test may call a real third party** (Mitchell's policy), and
 * `EXTERNAL_DATA_OFFLINE=true` is how the e2e server keeps to it —
 * `playwright.config.ts` sets it beside `AI_LIVE: "false"`, which is the same
 * rule for the model. Without it MET was off only because the contact happens
 * to be unset there, and NASA POWER needs no key at all, so the first spec to
 * render weather would have called power.larc.nasa.gov for real.
 *
 * Read per call, as `AI_LIVE` is, so a test can flip it. The real-service walk
 * is manual: `docs/guidelines/external-data-manual-check.md`.
 */
const offline = () => process.env.EXTERNAL_DATA_OFFLINE === "true";

/** `travel-collab/<version> +<site> <contact>` — MET's "identify yourself" (decision 6). */
function userAgent(contact: string): string {
  return `travel-collab/${APP_VERSION} +${APP_SITE} ${contact}`;
}

/**
 * The forecast source, MET Norway. Throws when `EXTERNAL_DATA_CONTACT` is
 * unset, as `getGeocoder()` does without its key — and when offline, the same
 * way, so the route treats it as unconfigured and charges no quota for it.
 */
export function getForecast(): Forecast {
  if (offline()) throw new Error("EXTERNAL_DATA_OFFLINE is set");
  const contact = serverConfig.externalDataContact;
  if (!contact) throw new Error("EXTERNAL_DATA_CONTACT is not set");
  return createMetNorwayForecast({ userAgent: userAgent(contact) });
}

// Offline, the normals are a port that refuses before any request: the route
// has no "unconfigured" for them, and a refusal is what a source that is down
// looks like to it, so the reader gets exactly the down state.
const OFFLINE_CLIMATE: Climate = {
  normals: () => Promise.reject(new UpstreamError("NASA POWER: EXTERNAL_DATA_OFFLINE is set")),
};

// Keyless, and the contact is a courtesy here rather than a condition, so it
// is sent when there is one and its absence does not stop "typical".
/** The monthly-normals source, NASA POWER. Never throws; offline, its calls reject. */
export function getClimate(): Climate {
  if (offline()) return OFFLINE_CLIMATE;
  const contact = serverConfig.externalDataContact;
  return createNasaPowerClimate({ userAgent: contact ? userAgent(contact) : null });
}
