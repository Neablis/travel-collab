import { auth } from "@/server/auth";
import { cloneDemoTrip } from "@/server/cloneTrip";

// "Make this my trip", from the demo trip at `/s/featured`.
//
// Its own static route rather than the `[token]/clone` one next door: Next.js
// matches `featured` to the static segment, so a request for
// `/api/shares/featured/clone` never reaches the dynamic sibling. That is the
// right shape anyway — the demo has no share row to resolve, so the two paths
// have nothing in common past `cloneFrom`, which is where they do meet.
//
// This is the conversion the demo exists for, and it is the only write anywhere
// near it: the read is databaseless, and this is a signed-in person deliberately
// asking for a trip of their own. A signed-out visitor gets the 401 that
// `SharedTripScreen` turns into `/signin?callbackUrl=/s/featured`, and lands
// back here with the button still under their cursor.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const result = await cloneDemoTrip(session.user.id);
  if (!result.ok) {
    return Response.json({ error: result.error.message, code: result.error.code }, { status: 400 });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
