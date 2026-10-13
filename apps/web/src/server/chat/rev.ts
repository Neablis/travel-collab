import { eq, sql } from "drizzle-orm";
import { db, type Queryable } from "../db/client";
import { tripChatRevs } from "../db/schema";

/**
 * Bump the trip's chat revision (ADR-073 §2), inside the transaction of the
 * write it reports, so a rolled-back write never moves it and a committed one
 * always does. `bumpAccessRev`'s construction.
 */
export async function bumpChatRev(tx: Queryable, tripId: string): Promise<void> {
  await tx
    .insert(tripChatRevs)
    .values({ tripId, rev: 1 })
    .onConflictDoUpdate({ target: tripChatRevs.tripId, set: { rev: sql`${tripChatRevs.rev} + 1` } });
}

/** The events poll's `chatRev`: opaque, compared only for equality. "0" before the first message. */
export async function chatRevFor(tripId: string): Promise<string> {
  const rows = await db.select({ rev: tripChatRevs.rev }).from(tripChatRevs).where(eq(tripChatRevs.tripId, tripId));
  return String(rows[0]?.rev ?? 0);
}
