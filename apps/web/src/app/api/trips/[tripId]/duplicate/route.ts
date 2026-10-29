import { auth } from "@/server/auth";
import { duplicateTrip } from "@/server/cloneTrip";

// `malformed-trip` is a 500, as at the access seam: the row this server wrote
// is broken, and only a member is told so (KI-2026-10-28-c).
const STATUS_BY_CODE: Record<string, number> = { "not-found": 404, forbidden: 403, "malformed-trip": 500 };

export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const result = await duplicateTrip(tripId, session.user.id);
  if (!result.ok) {
    const status = STATUS_BY_CODE[result.error.code] ?? 400;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
