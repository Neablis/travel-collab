import { and, eq, inArray, sql } from "drizzle-orm";
import { PRESENCE_WINDOW_MS } from "@tc/contracts";
import { db } from "../db/client";
import { tripPresence } from "../db/schema";

/**
 * Who has a trip open (M46 D7, ADR-073 §6), riding the events poll.
 *
 * Coarse on purpose: a member's last-seen is written at most once per
 * heartbeat, so a 2s poll costs one indexed read, and one write per member per
 * 5 minutes. The window is a little over one heartbeat, so a member whose page
 * stays open never drops out between two writes.
 *
 * Every comparison is the database's `now()`, never this process's clock, so
 * the write and the read agree whatever either side's time zone is.
 */
export const PRESENCE_HEARTBEAT_MS = 5 * 60_000;

const ago = (ms: number) => sql`now() - make_interval(secs => ${ms / 1000})`;

/**
 * Record that `callerId` has the trip open, and answer which of `memberIds`
 * (the caller among them) were seen within the window. A removed member's
 * leftover row is never served.
 *
 * Read first, write rarely: an `ON CONFLICT DO UPDATE` whose `WHERE` skips the
 * update still locks the row, and so writes on every poll. The upsert runs only
 * when the caller's row is missing or a heartbeat old; its `setWhere` keeps two
 * tabs racing past the read to one write.
 */
export async function onlineMembers(tripId: string, callerId: string, memberIds: readonly string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db
    .select({
      userId: tripPresence.userId,
      online: sql<boolean>`${tripPresence.seenAt} > ${ago(PRESENCE_WINDOW_MS)}`,
      fresh: sql<boolean>`${tripPresence.seenAt} > ${ago(PRESENCE_HEARTBEAT_MS)}`,
    })
    .from(tripPresence)
    .where(and(eq(tripPresence.tripId, tripId), inArray(tripPresence.userId, [...memberIds])));

  if (!rows.some((r) => r.userId === callerId && r.fresh)) {
    await db
      .insert(tripPresence)
      .values({ tripId, userId: callerId, seenAt: sql`now()` })
      .onConflictDoUpdate({
        target: [tripPresence.tripId, tripPresence.userId],
        set: { seenAt: sql`now()` },
        setWhere: sql`${tripPresence.seenAt} <= ${ago(PRESENCE_HEARTBEAT_MS)}`,
      });
  }
  const online = new Set(rows.filter((r) => r.online).map((r) => r.userId));
  if (memberIds.includes(callerId)) online.add(callerId);
  return [...online];
}
