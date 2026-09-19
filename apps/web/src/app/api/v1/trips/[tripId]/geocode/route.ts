import { z } from "zod";
import { GeocodeCandidates, type Location } from "@tc/contracts";
import { tripRegionOf } from "@/server/ai/geocodeRegion";
import { getGeocoder } from "@/server/geocoding";
import { PublicApiError } from "@/server/public-api/commands";
import { defaultResolveDeps } from "@/server/public-api/locations";
import { route } from "@/server/public-api/route";

// **Name or address text in, coordinates out** — so a caller can check a place
// before writing it, or pick between candidates. Each result is a `Location`, so
// it can be sent back as a stop's `location` unchanged, and then costs no second
// lookup: it already carries lat/lng.
//
// **Trip-scoped on purpose** (plan decision 7). `route()` refuses a trip-scoped
// token on an endpoint with no trip, and that is the credential an agent
// building one trip holds; the trip also gives the lookup a region to prefer.
// `trips:write` + editor because its only use is writing stops, and every call
// spends the operator's LocationIQ allowance (charged to `geocodeQuota`, the
// same ceilings as the in-app search) — a read-only token has no business
// spending it.
//
// Not a collection: vendor results are not pageable, so there is no cursor. The
// top 5 is the whole answer.
const Query = z.object({
  q: z.string().trim().min(1).max(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
});

const UNAVAILABLE = "Geocoding is unavailable. Try again shortly.";

export const { GET } = route({
  GET: {
    summary: "Search for a real place by name near this trip's stops, returning up to five locations ready to use on a stop (spends geocode quota)",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    query: Query,
    response: GeocodeCandidates,
    responseHeaders: {
      "Retry-After": "On a 429: seconds until the daily geocode allowance resets.",
    },
    handle: async ({ actor, query, trip, responseHeaders }) => {
      const { q, countryCode } = query as z.infer<typeof Query>;

      // Charged BEFORE the vendor is called, like every other v1 lookup path.
      const decision = await defaultResolveDeps.charge(actor.userId);
      if (!decision.allowed) {
        if (decision.reason === "unavailable") {
          throw new PublicApiError(503, UNAVAILABLE, "service-unavailable");
        }
        responseHeaders.set("Retry-After", String(decision.retryAfterSeconds));
        throw new PublicApiError(
          429,
          "The daily geocoding allowance for this account is used up.",
          "rate-limited",
        );
      }

      let results;
      try {
        const region = tripRegionOf(trip!);
        results = await getGeocoder().forward(q, {
          limit: 5,
          ...(region ? { viewbox: region } : {}),
          ...(countryCode ? { countryCode } : {}),
        });
      } catch {
        // Unconfigured key or a vendor that failed. Either way it is ours, not
        // the caller's, and it is temporary.
        throw new PublicApiError(503, UNAVAILABLE, "service-unavailable");
      }

      return {
        results: results.map<Location>((r) => ({
          // A vendor's full label routinely runs past `Location.name`'s 200,
          // and an over-long name fails the response schema on the way out —
          // i.e. a 500 for a lookup that actually worked.
          name: r.canonicalName.slice(0, 200),
          lat: r.lat,
          lng: r.lng,
          ...(r.countryCode ? { countryCode: r.countryCode } : {}),
          ...(r.city ? { city: r.city } : {}),
          ...(r.area ? { area: r.area } : {}),
        })),
      };
    },
  },
});
