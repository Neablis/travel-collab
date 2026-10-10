import { z } from "zod";

// Named snapshots (M40 D4, D5): a label on a position in a trip's log, so a
// person can get back to it without scrolling History.
//
// **Not an event.** A snapshot lives in its own CRUD table (`trip_snapshots`)
// and never occupies a `seq`; ADR-005 rejected marker events and a movable
// head, and this is neither. Restoring one is the ordinary `RevertToState
// { toSeq: seq }`, so the log records the restore and nothing else, and one
// undo takes it back.

/** The longest name a snapshot may carry, after trimming. The table's CHECK holds the same bound. */
export const SNAPSHOT_NAME_MAX = 80;

const SnapshotName = z.string().trim().min(1).max(SNAPSHOT_NAME_MAX);

/** One saved position in a trip's log, as the snapshot routes serve it. */
export const TripSnapshot = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  /** The head of the trip's stream when it was saved: what a restore reverts to. */
  seq: z.number().int().positive(),
  name: z.string(),
  createdBy: z.string().min(1),
  createdAt: z.string(), // ISO 8601
});
export type TripSnapshot = z.infer<typeof TripSnapshot>;

/** `GET /api/trips/:tripId/snapshots` — newest first. */
export const TripSnapshotsResponse = z.object({
  snapshots: z.array(TripSnapshot),
});
export type TripSnapshotsResponse = z.infer<typeof TripSnapshotsResponse>;

/** `POST /api/trips/:tripId/snapshots` — save the trip as it stands now. */
export const CreateSnapshotInput = z.object({ name: SnapshotName });
export type CreateSnapshotInput = z.infer<typeof CreateSnapshotInput>;

/** `PATCH /api/trips/:tripId/snapshots/:snapshotId`. Only the name changes; the position never does. */
export const RenameSnapshotInput = z.object({ name: SnapshotName });
export type RenameSnapshotInput = z.infer<typeof RenameSnapshotInput>;
