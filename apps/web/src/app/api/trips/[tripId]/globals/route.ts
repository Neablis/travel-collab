import { TripGlobals } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { buildTripGlobals } from "@/server/tripGlobals";

// The trip's addressable collections (ADR-037 open question 4).
//
// **Its own route rather than a second field on `/api/trips/:tripId`.** That
// response is read by the board, every lens, the map and the AI paths; widening
// it would make all of them pay for a projection only the Notebook reads, and
// would change `fetchTripDetail`'s shape for every caller. A separate route
// costs one request on the one surface that wants it.
//
// Same guard as the detail route, deliberately: this is derived entirely from
// `TripDetail`, so anyone who may read the trip may read this, and anyone who
// may not must not be able to count its cities either.
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true });
  if ("error" in access) return access.error;
  // Contract-honest response, matching the detail route next door: validate
  // against the schema before returning rather than trusting the builder.
  return Response.json({ globals: TripGlobals.parse(buildTripGlobals(access.detail)) });
}
