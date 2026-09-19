import { bundleKeyFor, TripExportBundle, tripToBundle } from "@tc/fixtures";
import { route } from "@/server/public-api/route";

// **A trip, as a file you can take with you** (M25 link 1).
//
// **This endpoint is M22's headline claim under its second, harder test.** M22
// measured *"endpoint N+1 costs a declaration and nothing else"* on
// `GET /v1/trips/{tripId}/members` — eighteen lines that slice an array already
// sitting on the context. This one has a body to BUILD, which is where the
// claim might not hold. It holds: the conversion lives in a pure converter
// beside `toCommands.ts` (`@tc/fixtures`'s `tripToBundle`), and what is left
// here is the declaration plus one header. If this file ever grows a second
// responsibility, that is the finding and M25's gate box says so.
//
// **`trips:read` and `viewer`, matching ADR-028 decision 3.** A viewer may
// already clone a trip, so refusing them a copy in a file protects nothing and
// only makes the product feel arbitrary. No new scope: `trips:read` already
// says this.
//
// **Not a collection.** A bundle is one document, not a page of items, so there
// is no cursor and no `?limit=`. That also means `route()` returns the payload
// RAW rather than in the `{ items, nextCursor }` envelope — which is what makes
// the response body *be* the file. An enveloped export would have passed every
// test in this milestone while the thing a person actually downloaded was
// un-importable.
//
// **Free to every plan, and that is a property of this file rather than a
// claim about it.** There is no `accountCan` here and there is none in
// `route()`: `api.tokens` gates minting and verifying a *token*, and a session
// actor satisfies every scope (`public-api/actor.ts`). So the browser calls
// this same endpoint with the cookie it already has, and a `free` account
// meets no entitlement anywhere on the path. That is why link 2 needs no
// second route, no `apiClient` helper and no MSW handler.
//
// The asymmetry a support conversation will eventually hit, written down:
// exporting THROUGH THE API still needs a token, and a token still needs
// `api.tokens` on `premium@v2`. That is the API being gated, exactly as it
// already is for `GET /v1/trips` — not export being gated. The free path is
// the UI one.
export const { GET } = route({
  GET: {
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripExportBundle,
    responseHeaders: {
      "Content-Disposition": "Names the download. The filename is the trip's name, slugified.",
    },
    handle: ({ trip, responseHeaders }) => {
      // `bundleKeyFor` falls back to the trip's uuid, so this is always a safe
      // ASCII filename — a trip named `京都` would otherwise put raw UTF-8 in a
      // header field, which needs RFC 5987 encoding to be read correctly and
      // gets mangled without it.
      responseHeaders.set(
        "Content-Disposition",
        `attachment; filename="${bundleKeyFor(trip!)}.json"`,
      );
      return tripToBundle(trip!, { generatedAt: new Date().toISOString() });
    },
  },
});
