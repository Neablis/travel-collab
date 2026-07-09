import { TripHistory } from "@tc/contracts";
import { auth } from "@/server/auth";
import { getTripHistory } from "@/server/history";
import { getTripDetail } from "@/server/projections";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const detail = await getTripDetail(tripId);
  if (detail === null) return Response.json({ error: "not-found" }, { status: 404 });
  const userId = session.user.id;
  if (!detail.members.some((m) => m.userId === userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const history = await getTripHistory(tripId);
  if (history === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ history: TripHistory.parse(history) });
}
