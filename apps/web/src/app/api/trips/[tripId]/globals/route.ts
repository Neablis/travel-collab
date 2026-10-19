import { requireTripAccess } from "@/server/access/trip-access";
import { auth } from "@/server/auth";
import { tripGlobalsView } from "@/server/tripViews";

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
  // The home zone is the READER's (M14 link 11), so it comes from the session,
  // not from `access.userId`: a signed-in person looking at the demo is
  // `demo-visitor` there, and still has a home.
  // Nobody signed in has none, and costs no query.
  const session = await auth();
  return Response.json(await tripGlobalsView(access, session?.user?.id));
}
