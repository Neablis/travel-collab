import { TripGlobals } from "@tc/contracts";
import { buildTripGlobals } from "@/server/tripGlobals";
import { route } from "@/server/public-api/route";

// The trip's addressable collections. Derived entirely from `TripDetail`, so
// anyone who may read the trip may read this — which is why the declaration is
// the same `viewer` the detail endpoint asks for.
export const { GET } = route({
  GET: {
    summary: "Summarise a trip: its days, the cities and tags it uses, and how many stops are booked",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripGlobals,
    handle: ({ trip }) => buildTripGlobals(trip!),
  },
});
