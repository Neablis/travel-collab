import { TripHistory } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { getTripHistory } from "@/server/history";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true });
  if ("error" in access) return access.error;
  const history = await getTripHistory(tripId);
  if (history === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ history: TripHistory.parse(history) });
}
