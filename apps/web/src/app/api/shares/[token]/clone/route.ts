import { auth } from "@/server/auth";
import { cloneSharedTrip } from "@/server/cloneTrip";

const STATUS: Record<string, number> = { "not-found": 404, "share-unavailable": 410 };

// "Make this my trip" from a share page. Unlike the share READ, this one does
// need a session — a clone has to belong to somebody — so a signed-out visitor
// gets a 401 the screen turns into /signin?callbackUrl=/s/<token>.
//
// No membership check and none possible: the whole point is that the person
// holding the link may be no relation to the trip. What they get is a copy of
// the PINNED state, which is what the link showed them (ADR-028).
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { token } = await params;
  const result = await cloneSharedTrip(token, session.user.id);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
