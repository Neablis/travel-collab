import { TripGlobals } from "@tc/contracts";
import { inviteTokenOf, requireTripAccess } from "@/server/access/trip-access";
import { auth } from "@/server/auth";
import { buildTripGlobals } from "@/server/tripGlobals";
import { readPreferences } from "@/server/users";

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
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true, inviteToken: inviteTokenOf(request) });
  if ("error" in access) return access.error;
  // The home zone is the READER's (M14 link 11), so it comes from the session,
  // not from `access.userId`: a signed-in person looking at the demo or an
  // invite is `demo-visitor` / `invite-visitor` there, and still has a home.
  // Nobody signed in has none, and costs no query.
  const session = await auth();
  const reader = session?.user?.id ? await readPreferences(session.user.id) : undefined;
  // Contract-honest response, matching the detail route next door: validate
  // against the schema before returning rather than trusting the builder.
  return Response.json({ globals: TripGlobals.parse(buildTripGlobals(access.detail, reader)) });
}
