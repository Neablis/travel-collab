import { TripGlobals } from "@tc/contracts";
import { buildTripGlobals } from "@/server/tripGlobals";
import { actorHasScope, type Actor } from "@/server/public-api/actor";
import { route } from "@/server/public-api/route";
import { readPreferences } from "@/server/users";

// The trip's addressable collections. Derived entirely from `TripDetail`, so
// anyone who may read the trip may read this — which is why the declaration is
// the same `viewer` the detail endpoint asks for.
//
// **Except `homeTimeZone`, which is about the caller, not the trip**: the token
// owner's zone, from their home airport — a fact not even `GET /v1/account`
// publishes. A `trips:read` token gets `null` for it (#223 review); it takes
// the credential that could read the account — `account:read`, and not
// confined to named trips, which the wrapper refuses on `/v1/account`.
function mayReadAccount(actor: Actor): boolean {
  return actorHasScope(actor, "account:read") && (actor.via === "session" || actor.tripIds === null);
}

export const { GET } = route({
  GET: {
    summary: "Summarise a trip: its days and their time zones, and the cities and tags it uses",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripGlobals,
    handle: async ({ trip, actor }) =>
      buildTripGlobals(trip!, mayReadAccount(actor) ? await readPreferences(actor.userId) : undefined),
  },
});
