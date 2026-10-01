import { z } from "zod";
import { GeocodeCandidates } from "@tc/contracts";
import { getGeocoder } from "@/server/geocoding";
import { PublicApiError } from "@/server/public-api/commands";
import { candidateLocation, defaultResolveDeps, GEOCODE_UNAVAILABLE, lookupRefusal } from "@/server/public-api/locations";
import { route } from "@/server/public-api/route";
import { consumeQuota, placeSearchTokenQuota } from "@/server/quota";

// **The place search, outside any trip** (Mitchell, 2026-09-30) — the tripless
// twin of `GET /v1/trips/{tripId}/geocode`, and named for it: same verb, same
// `?q=`/`countryCode`, same `GeocodeCandidates` answer, and the public face of
// the app's own `/api/geocode`. Not `/v1/places`: the internal `places` route is
// a search over the published library, a different question that may want that
// name when it is published.
//
// **`places:read`, its own scope**, because it is the one read that spends
// money: every lookup costs the operator's LocationIQ allowance. Being tripless,
// a token confined to named trips is refused by `route()` (`trip-out-of-scope`),
// as on every other tripless endpoint — such a caller has the trip-scoped
// search for its own trips.
//
// **Three ceilings, in this order**, all charged before the vendor is called:
// the wrapper's per-token request rate; this token's own place-search day
// (`placeSearchTokenQuota`, 100); then the account's and everyone's geocode day
// (`geocodeQuota`) — the same two the app's search charges, so a token can
// never spend more than its owner could in the app. A session caller has no
// token and pays only the last.
//
// **Empty `q` costs nothing**: no quota and no vendor, exactly as in the app.
// Absent `q` is still a 400 — a missing parameter is a malformed request, an
// empty one is a search for nothing.
const Query = z.object({
  q: z.string().trim().max(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
});

export const { GET } = route({
  GET: {
    summary: "Search for a real place by name, outside any trip, returning up to five locations ready to use on a stop (spends geocode quota; 100 a day per token)",
    scope: "places:read",
    query: Query,
    response: GeocodeCandidates,
    responseHeaders: {
      "Retry-After": "On a 429: seconds until the exhausted daily allowance (this token's, or the account's) resets.",
    },
    handle: async ({ actor, query, responseHeaders }) => {
      const { q, countryCode } = query as z.infer<typeof Query>;
      if (q === "") return { results: [] };

      if (actor.via === "token") {
        const refusal = lookupRefusal(
          await consumeQuota(placeSearchTokenQuota(), actor.tokenId),
          responseHeaders,
          "This token's daily place-search allowance is used up.",
        );
        if (refusal) throw refusal;
      }
      const refusal = lookupRefusal(
        await defaultResolveDeps.charge(actor.userId),
        responseHeaders,
        "The daily geocoding allowance for this account is used up.",
      );
      if (refusal) throw refusal;

      let results;
      try {
        results = await getGeocoder().forward(q, { limit: 5, ...(countryCode ? { countryCode } : {}) });
      } catch {
        throw new PublicApiError(503, GEOCODE_UNAVAILABLE, "service-unavailable");
      }
      return { results: results.map(candidateLocation) };
    },
  },
});
