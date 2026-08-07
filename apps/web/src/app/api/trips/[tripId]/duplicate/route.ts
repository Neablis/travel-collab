import { auth } from "@/server/auth";
import { duplicateTrip } from "@/server/duplicateTrip";

export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const result = await duplicateTrip(tripId, session.user.id);
  if (!result.ok) {
    const status = result.error.code === "not-found" ? 404 : result.error.code === "forbidden" ? 403 : 400;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
