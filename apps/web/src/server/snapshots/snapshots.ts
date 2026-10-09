import { and, desc, eq } from "drizzle-orm";
import {
  TripSnapshot,
  type CreateSnapshotInput,
  type RenameSnapshotInput,
  type TripDetail,
  type TripHistory,
} from "@tc/contracts";
import { roleAtLeast } from "../accessPolicy";
import { tripAccessFor } from "../access/trip-access";
import { executeTripCommand } from "../commands";
import { db } from "../db/client";
import { tripSnapshots } from "../db/schema";
import { readStreamHeadSeq } from "../eventStore";
import { isUuid } from "../ids";

// Named snapshots (M40 D4, D5): ordinary CRUD on `trip_snapshots`, never an
// event. The one path from a snapshot to the trip is `restoreSnapshot`, which
// is `RevertToState` through the command pipeline like the History panel's
// *Revert to here* — so the log records a restore as one revert batch, and one
// undo takes it back. Refusals are returned rather than thrown, on
// `server/suggestions/`'s terms; `http.ts` turns a code into a status.

export type SnapshotErrorCode =
  | "not-found"
  | "forbidden"
  | "trip-deleted"
  // The trip already has `SNAPSHOT_TRIP_MAX` (D5).
  | "too-many-snapshots"
  // Restoring a snapshot the trip already matches: nothing to append.
  | "no-op"
  // The pipeline refused the revert for any other reason; its message is kept.
  | "restore-refused"
  // The trip's stored document does not parse: the access seam's own denial.
  | "malformed-trip";

export type SnapshotError = { code: SnapshotErrorCode; message: string };
export type SnapshotResult<T> = { ok: true; value: T } | { ok: false; error: SnapshotError };

/** How many snapshots one trip may keep (Mitchell, 2026-10-09, D5). */
export const SNAPSHOT_TRIP_MAX = 20;

function refuse(code: SnapshotErrorCode, message: string): { ok: false; error: SnapshotError } {
  return { ok: false, error: { code, message } };
}

const NOT_FOUND = refuse("not-found", "This trip does not exist.");
const NO_SNAPSHOT = refuse("not-found", "That snapshot does not exist.");

// D5: anyone who may read the trip's history may read its snapshots; only an
// editor or the owner may change them, since a suggester cannot edit the plan
// and so cannot restore it either. Asked through `tripAccessFor` at `viewer`,
// so a stranger is `not-found` here, as on the suggestion routes (W26).
async function access(
  tripId: string,
  userId: string,
  write: boolean,
): Promise<SnapshotResult<null>> {
  const outcome = await tripAccessFor(userId, tripId, "viewer");
  if (!outcome.ok) {
    return outcome.denial === "malformed-trip" ? refuse("malformed-trip", "This trip could not be read.") : NOT_FOUND;
  }
  if (!write) return { ok: true, value: null };
  if (!roleAtLeast(outcome.role, "editor")) {
    return refuse("forbidden", "Only an editor or the owner can change snapshots.");
  }
  if (outcome.detail.status === "deleted") return refuse("trip-deleted", "This trip has been deleted.");
  return { ok: true, value: null };
}

type Row = typeof tripSnapshots.$inferSelect;

function toSnapshot(row: Row): TripSnapshot {
  return TripSnapshot.parse({ ...row, createdAt: row.createdAt.toISOString() });
}

async function findRow(tripId: string, snapshotId: string): Promise<Row | null> {
  // A path segment that could never be an id has an honest answer, and it is
  // not a `22P02` from the driver.
  if (!isUuid(snapshotId)) return null;
  const [row] = await db
    .select()
    .from(tripSnapshots)
    .where(and(eq(tripSnapshots.id, snapshotId), eq(tripSnapshots.tripId, tripId)));
  return row ?? null;
}

/** The trip's snapshots, newest first, for anyone who may read the trip. */
export async function listSnapshots(tripId: string, userId: string): Promise<SnapshotResult<TripSnapshot[]>> {
  const allowed = await access(tripId, userId, false);
  if (!allowed.ok) return allowed;
  const rows = await db
    .select()
    .from(tripSnapshots)
    .where(eq(tripSnapshots.tripId, tripId))
    .orderBy(desc(tripSnapshots.createdAt), desc(tripSnapshots.seq));
  return { ok: true, value: rows.map(toSnapshot) };
}

// The cap is a bound, not a lock, as the suggestion caps are: two saves at the
// same moment each count without the other, so a race passes 20 by one. No
// lock on the trip is taken for it.
/** Save the trip as it stands now: a label on the stream's current head. Editor or owner. */
export async function saveSnapshot(
  tripId: string,
  userId: string,
  input: CreateSnapshotInput,
  now: Date = new Date(),
): Promise<SnapshotResult<TripSnapshot>> {
  const allowed = await access(tripId, userId, true);
  if (!allowed.ok) return allowed;
  const held = await db.$count(tripSnapshots, eq(tripSnapshots.tripId, tripId));
  if (held >= SNAPSHOT_TRIP_MAX) {
    return refuse(
      "too-many-snapshots",
      `A trip keeps at most ${SNAPSHOT_TRIP_MAX} snapshots. Delete one to save another.`,
    );
  }
  const seq = await readStreamHeadSeq(db, tripId);
  const [row] = await db
    .insert(tripSnapshots)
    .values({ id: crypto.randomUUID(), tripId, seq, name: input.name, createdBy: userId, createdAt: now })
    .returning();
  return { ok: true, value: toSnapshot(row!) };
}

/** Rename a snapshot. Its position in the log never changes. Editor or owner. */
export async function renameSnapshot(
  tripId: string,
  snapshotId: string,
  userId: string,
  input: RenameSnapshotInput,
): Promise<SnapshotResult<TripSnapshot>> {
  const allowed = await access(tripId, userId, true);
  if (!allowed.ok) return allowed;
  if (!isUuid(snapshotId)) return NO_SNAPSHOT;
  const [row] = await db
    .update(tripSnapshots)
    .set({ name: input.name })
    .where(and(eq(tripSnapshots.id, snapshotId), eq(tripSnapshots.tripId, tripId)))
    .returning();
  return row ? { ok: true, value: toSnapshot(row) } : NO_SNAPSHOT;
}

/** Delete a snapshot for good (D5: a hard delete). Editor or owner. */
export async function deleteSnapshot(
  tripId: string,
  snapshotId: string,
  userId: string,
): Promise<SnapshotResult<null>> {
  const allowed = await access(tripId, userId, true);
  if (!allowed.ok) return allowed;
  if (!isUuid(snapshotId)) return NO_SNAPSHOT;
  const deleted = await db
    .delete(tripSnapshots)
    .where(and(eq(tripSnapshots.id, snapshotId), eq(tripSnapshots.tripId, tripId)))
    .returning({ id: tripSnapshots.id });
  return deleted.length === 0 ? NO_SNAPSHOT : { ok: true, value: null };
}

/**
 * Put the trip back as it was when the snapshot was saved: `RevertToState
 * { toSeq: snapshot.seq }` through the pipeline, as the acting editor. Answers
 * the trip and its history as the command routes do, or `no-op` when the trip
 * already matches.
 */
export async function restoreSnapshot(
  tripId: string,
  snapshotId: string,
  userId: string,
): Promise<SnapshotResult<{ detail: TripDetail; history: TripHistory }>> {
  const allowed = await access(tripId, userId, true);
  if (!allowed.ok) return allowed;
  const row = await findRow(tripId, snapshotId);
  if (row === null) return NO_SNAPSHOT;
  const result = await executeTripCommand({ type: "RevertToState", tripId, toSeq: row.seq }, userId);
  if (result.ok) return { ok: true, value: { detail: result.detail, history: result.history } };
  // The domain calls this `already-at-that-state`; across this module's wire it
  // is the `no-op` every other "nothing to do" answer is.
  if (result.error.code === "already-at-that-state") {
    return refuse("no-op", "The trip already matches this snapshot.");
  }
  return refuse("restore-refused", result.error.message);
}
