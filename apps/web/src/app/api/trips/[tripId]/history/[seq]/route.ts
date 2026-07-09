import { TripDetail } from "@tc/contracts";
import { auth } from "@/server/auth";
import { getTripDetailAt } from "@/server/history";
import { getTripDetail } from "@/server/projections";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; seq: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId, seq } = await params;
  const detail = await getTripDetail(tripId);
  if (detail === null) return Response.json({ error: "not-found" }, { status: 404 });
  const userId = session.user.id;
  if (!detail.members.some((m) => m.userId === userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const at = await getTripDetailAt(tripId, Number(seq));
  if (at === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ trip: TripDetail.parse(at) });
}
