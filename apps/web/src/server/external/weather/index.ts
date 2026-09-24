import { serverConfig } from "../../config";
import { createMetNorwayForecast } from "./met-norway";
import { createNasaPowerClimate } from "./nasa-power";
import type { Climate, Forecast } from "./ports";

export type { Climate, Forecast } from "./ports";

// One place picks each provider (ADR-052 decision 1, ADR-007's seam). Swapping
// one — Open-Meteo's paid plan for "typical", if NASA POWER fails verification
// — is one line here.

// Production's public host: MET asks for the app's site in the User-Agent, and
// a preview's host is not the app anyone would contact.
const APP_SITE = "https://caesura.today";
const APP_VERSION = "0.0.1";

/** `travel-collab/<version> +<site> <contact>` — MET's "identify yourself" (decision 6). */
function userAgent(contact: string): string {
  return `travel-collab/${APP_VERSION} +${APP_SITE} ${contact}`;
}

/** The forecast source, MET Norway. Throws when `EXTERNAL_DATA_CONTACT` is unset, as `getGeocoder()` does without its key. */
export function getForecast(): Forecast {
  const contact = serverConfig.externalDataContact;
  if (!contact) throw new Error("EXTERNAL_DATA_CONTACT is not set");
  return createMetNorwayForecast({ userAgent: userAgent(contact) });
}

// Keyless, and the contact is a courtesy here rather than a condition, so it
// is sent when there is one and its absence does not stop "typical".
/** The monthly-normals source, NASA POWER. Never throws. */
export function getClimate(): Climate {
  const contact = serverConfig.externalDataContact;
  return createNasaPowerClimate({ userAgent: contact ? userAgent(contact) : null });
}
