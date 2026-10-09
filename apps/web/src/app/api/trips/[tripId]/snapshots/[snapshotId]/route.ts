import { RenameSnapshotInput, TripSnapshot } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readBody } from "@/server/readBody";
import { MAX_SNAPSHOT_BODY_BYTES, refused } from "@/server/snapshots/http";
import { deleteSnapshot, renameSnapshot } from "@/server/snapshots/snapshots";

type Params = { params: Promise<{ tripId: string; snapshotId: string }> };

/** Rename a snapshot; answers it. Its position in the log never changes. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId, snapshotId } = await params;
  const body = await readBody(request, RenameSnapshotInput, "invalid-snapshot", { maxBytes: MAX_SNAPSHOT_BODY_BYTES });
  if ("error" in body) return body.error;
  const result = await renameSnapshot(tripId, snapshotId, session.user.id, body.data);
  if (!result.ok) return refused(result.error);
  return Response.json({ snapshot: TripSnapshot.parse(result.value) });
}

/** Delete a snapshot for good (D5). Answers `{ ok: true }`. */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId, snapshotId } = await params;
  const result = await deleteSnapshot(tripId, snapshotId, session.user.id);
  if (!result.ok) return refused(result.error);
  return Response.json({ ok: true });
}
