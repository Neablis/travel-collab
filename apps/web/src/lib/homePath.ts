// `/` is the static landing page and the signed-in Home lives here (ADR-078).
// Every link, redirect and fallback that means "back to your trips" names this
// constant rather than spelling the path, so the next move is one edit.
/** Where a signed-in person's Home is served: the trips list. */
export const HOME_PATH = "/home";

/** The query Home reads to open New trip on arrival. */
export const NEW_TRIP_PARAM = "new";

/**
 * Home with New trip opened on arrival: where an assistant hand-off's "Start a
 * new trip" goes from a page that has no New trip of its own (ADR-084 §2).
 */
export const NEW_TRIP_PATH = `${HOME_PATH}?${NEW_TRIP_PARAM}=trip`;
