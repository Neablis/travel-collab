import { TripDetail } from "@tc/contracts";
import { route } from "@/server/public-api/route";

// **Pilot endpoint 2 of 2** (M22 Phase 2) — a single resource on one trip, so it
// is the one that exercises both gates: the token's trip confinement, then the
// unchanged member role check.
//
// `trip: "path"` is what buys all of that. The handler receives a `TripDetail`
// that is already loaded, already member-overlaid and already parsed, and the
// body of this endpoint is the word `trip`.
//
// **A deleted trip is 200 with `status: "deleted"`, not 404** — the same answer
// the BFF gives, and for the same reason: a caller can tell "gone" from "never
// existed", which is what makes a restore offerable. Only a genuinely unknown id
// 404s, and `tripAccessFor` is what encodes that.
export const { GET } = route({
  GET: {
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripDetail,
    // Non-null because `trip: "path"` is declared: the wrapper refuses the
    // request before reaching a handler whose trip it could not load.
    handle: ({ trip }) => trip!,
  },
});
