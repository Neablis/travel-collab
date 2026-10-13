import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { tripPresence } from "../db/schema";

/**
 * Who has a trip open (M46 D7, ADR-073 §6), riding the events poll.
 *
 * Coarse on purpose: a member's last-seen is written at most once per
 * heartbeat, so a 2s poll costs one write per member per 5 minutes rather than
 * one per poll. The window is a little over one heartbeat, so a member whose
 * page stays open never drops out between two writes.
 *
 * Every comparison is the database's `now()`, never this process's clock, so
 * the write and the read agree whatever either side's time zone is.
 */
export const PRESENCE_HEARTBEAT_MS = 5 * 60_000;
export const PRESENCE_WINDOW_MS = 6 * 60_000;

const ago = (ms: number) => sql`now() - make_interval(secs => ${ms / 1000})`;

/** Record that `userId` has the trip open. One upsert that writes only when the last write is a heartbeat old. */
export async function touchPresence(tripId: string, userId: string): Promise<void> {
  await db
    .insert(tripPresence)
    .values({ tripId, userId, seenAt: sql`now()` })
    .onConflictDoUpdate({
      target: [tripPresence.tripId, tripPresence.userId],
      set: { seenAt: sql`now()` },
      setWhere: sql`${tripPresence.seenAt} <= ${ago(PRESENCE_HEARTBEAT_MS)}`,
    });
}

/** The ids among `memberIds` seen within the window. A removed member's leftover row is never served. */
export async function onlineMembers(tripId: string, memberIds: readonly string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db
    .select({ userId: tripPresence.userId })
    .from(tripPresence)
    .where(
      and(
        eq(tripPresence.tripId, tripId),
        inArray(tripPresence.userId, [...memberIds]),
        gt(tripPresence.seenAt, ago(PRESENCE_WINDOW_MS)),
      ),
    );
  return rows.map((r) => r.userId);
}
