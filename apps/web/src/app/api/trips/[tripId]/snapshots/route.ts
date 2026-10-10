import { CreateSnapshotInput, TripSnapshot, TripSnapshotsResponse } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readBody } from "@/server/readBody";
import { MAX_SNAPSHOT_BODY_BYTES, refused } from "@/server/snapshots/http";
import { listSnapshots, saveSnapshot } from "@/server/snapshots/snapshots";

// Named snapshots (M40 D4, D5). Not planning commands: a snapshot is a row in
// its own table, so these write it directly, the way the suggestion routes do.
// Only a restore reaches the trip, and it goes through the pipeline.

/** The trip's snapshots, newest first, for anyone who may read the trip. */
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const result = await listSnapshots(tripId, session.user.id);
  if (!result.ok) return refused(result.error);
  return Response.json(TripSnapshotsResponse.parse({ snapshots: result.value }));
}

/** Save the trip as it stands now, under a name. 201 with the snapshot; 409 at the cap. */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = await readBody(request, CreateSnapshotInput, "invalid-snapshot", { maxBytes: MAX_SNAPSHOT_BODY_BYTES });
  if ("error" in body) return body.error;
  const result = await saveSnapshot(tripId, session.user.id, body.data);
  if (!result.ok) return refused(result.error);
  return Response.json({ snapshot: TripSnapshot.parse(result.value) }, { status: 201 });
}
