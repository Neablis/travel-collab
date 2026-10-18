// `/` is the static landing page and the signed-in Home lives here (ADR-078).
// Every link, redirect and fallback that means "back to your trips" names this
// constant rather than spelling the path, so the next move is one edit.
/** Where a signed-in person's Home is served: the trips list. */
export const HOME_PATH = "/home";
