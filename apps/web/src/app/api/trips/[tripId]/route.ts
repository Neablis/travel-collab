import { TripDetail } from "@tc/contracts";
import { auth } from "@/server/auth";
import { getTripDetail } from "@/server/projections";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const detail = await getTripDetail(tripId);
  // A DELETED trip is NOT a 404: it returns 200 with status:"deleted" so the UI
  // can offer a restore instead of a dead end. Only a genuinely unknown id 404s.
  if (detail === null) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const userId = session.user.id;
  if (!detail.members.some((m) => m.userId === userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  // Contract-honest response: validate against the schema before returning.
  return Response.json({ trip: TripDetail.parse(detail) });
}
