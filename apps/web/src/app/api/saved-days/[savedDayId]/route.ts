import { auth } from "@/server/auth";
import { deleteSavedDay } from "@/server/savedDays";

// Owner-only, and scoped in the query rather than checked after the read: a
// saved day belonging to someone else is indistinguishable from one that does
// not exist, which is the right answer to both.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ savedDayId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { savedDayId } = await params;
  const removed = await deleteSavedDay(savedDayId, session.user.id);
  if (!removed) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ ok: true });
}
