import { auth } from "@/server/auth";
import { refused } from "@/server/snapshots/http";
import { restoreSnapshot } from "@/server/snapshots/snapshots";

/**
 * Put the trip back as the snapshot saved it: one revert batch through the
 * pipeline, answered as the command routes answer (`{ detail, history }`), so
 * the board adopts it without a refetch. 409 `no-op` when it already matches.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; snapshotId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId, snapshotId } = await params;
  const result = await restoreSnapshot(tripId, snapshotId, session.user.id);
  if (!result.ok) return refused(result.error);
  return Response.json({ ok: true, tripId, ...result.value });
}
