import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { ChatMessage, PostChatMessage, TripRole } from "@tc/contracts";
import { db } from "../db/client";
import { tripChatReads, tripMessages } from "../db/schema";
import { isUuid } from "../ids";
import { bumpChatRev } from "./rev";

// The Chat module's store (ADR-073): ordinary CRUD on `trip_messages`, never an
// event. The caller has already passed `chatAccess`; what is decided here is
// only what is about one message (whose it is, whether it is gone).

/** The most messages one read returns, newest kept. */
export const CHAT_PAGE_LIMIT = 200;

type Row = typeof tripMessages.$inferSelect;

/** What a write on one message did, for the route to turn into a status. */
export type MessageOutcome<T> = { ok: true; value: T } | { ok: false; error: "not-found" | "forbidden" | "removed" };

const isRemoved = (row: Row) => row.deletedAt !== null || row.hiddenAt !== null;

function toMessage(row: Row): ChatMessage {
  const meta = {
    messageId: row.id,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
  if (isRemoved(row)) return { ...meta, removed: true };
  const link = row.linkKind !== null && row.linkId !== null ? { kind: row.linkKind, id: row.linkId } : undefined;
  return { ...meta, removed: false, body: row.body, ...(link ? { link } : {}) };
}

/**
 * The newest {@link CHAT_PAGE_LIMIT} messages, oldest first, and how many of
 * them the reader has not read: other people's live messages after their
 * cursor. Their own are never unread, and a removed one is nothing to read.
 */
export async function listMessages(
  tripId: string,
  userId: string,
): Promise<{ messages: ChatMessage[]; hasEarlier: boolean; unread: number }> {
  const rows = await db
    .select()
    .from(tripMessages)
    .where(eq(tripMessages.tripId, tripId))
    .orderBy(desc(tripMessages.createdAt), desc(tripMessages.id))
    .limit(CHAT_PAGE_LIMIT + 1);
  const hasEarlier = rows.length > CHAT_PAGE_LIMIT;
  const messages = rows.slice(0, CHAT_PAGE_LIMIT).reverse().map(toMessage);
  return { messages, hasEarlier, unread: await unreadCount(tripId, userId) };
}

async function unreadCount(tripId: string, userId: string): Promise<number> {
  return (await unreadByTrip(userId, [tripId])).get(tripId) ?? 0;
}

/**
 * How many messages the reader has not read on each of these trips, in one
 * statement for the whole list (Home's cards, M46 D5). A trip with none is
 * absent from the map. Which trips the reader may see is the caller's to
 * decide; this only counts.
 */
export async function unreadByTrip(userId: string, tripIds: readonly string[]): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({ tripId: tripMessages.tripId, n: count() })
    .from(tripMessages)
    .leftJoin(tripChatReads, and(eq(tripChatReads.tripId, tripMessages.tripId), eq(tripChatReads.userId, userId)))
    .where(
      and(
        inArray(tripMessages.tripId, [...tripIds]),
        ne(tripMessages.authorId, userId),
        isNull(tripMessages.deletedAt),
        isNull(tripMessages.hiddenAt),
        // After the cursor in the order the list is read, `(created_at, id)`,
        // so a message stamped the same millisecond as the one marked read is
        // still unread. No cursor yet: everything is.
        or(
          isNull(tripChatReads.tripId),
          sql`(${tripMessages.createdAt}, ${tripMessages.id}) > (${tripChatReads.lastReadAt}, ${tripChatReads.lastReadId})`,
        ),
      ),
    )
    .groupBy(tripMessages.tripId);
  return new Map(rows.map((r) => [r.tripId, r.n]));
}

/** Store a message and move the trip's `chatRev`, in one transaction. */
export async function postMessage(
  tripId: string,
  authorId: string,
  input: PostChatMessage,
  now: Date = new Date(),
): Promise<ChatMessage> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tripMessages)
      .values({
        id: randomUUID(),
        tripId,
        authorId,
        body: input.body,
        linkKind: input.link?.kind ?? null,
        linkId: input.link?.id ?? null,
        createdAt: now,
      })
      .returning();
    await bumpChatRev(tx, tripId);
    return toMessage(row!);
  });
}

async function messageOnTrip(tripId: string, messageId: string): Promise<Row | null> {
  // A path segment that is not a uuid names no message; asked as one, Postgres
  // would refuse the cast and the route would answer 500.
  if (!isUuid(messageId)) return null;
  const [row] = await db
    .select()
    .from(tripMessages)
    .where(and(eq(tripMessages.tripId, tripId), eq(tripMessages.id, messageId)));
  return row ?? null;
}

/** The author changes their own text. Nobody else may, the owner included; a removed message stays removed. */
export async function editMessage(
  tripId: string,
  messageId: string,
  userId: string,
  body: string,
  now: Date = new Date(),
): Promise<MessageOutcome<ChatMessage>> {
  const row = await messageOnTrip(tripId, messageId);
  if (row === null) return { ok: false, error: "not-found" };
  if (row.authorId !== userId) return { ok: false, error: "forbidden" };
  if (isRemoved(row)) return { ok: false, error: "removed" };
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tripMessages)
      .set({ body, editedAt: now })
      // Re-checked in the write, so a delete that lands between the read and
      // this update is not undone by it.
      .where(and(eq(tripMessages.id, messageId), isNull(tripMessages.deletedAt), isNull(tripMessages.hiddenAt)))
      .returning();
    if (updated === undefined) return { ok: false, error: "removed" } as const;
    await bumpChatRev(tx, tripId);
    return { ok: true, value: toMessage(updated) } as const;
  });
}

/**
 * Soft-delete: the author deletes their own, the owner any (M46 D6). The row
 * stays and reads as removed. Deleting a message already removed changes
 * nothing and moves no revision.
 */
export async function deleteMessage(
  tripId: string,
  messageId: string,
  userId: string,
  role: TripRole,
  now: Date = new Date(),
): Promise<MessageOutcome<ChatMessage>> {
  const row = await messageOnTrip(tripId, messageId);
  if (row === null) return { ok: false, error: "not-found" };
  if (row.authorId !== userId && role !== "owner") return { ok: false, error: "forbidden" };
  if (isRemoved(row)) return { ok: true, value: toMessage(row) };
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tripMessages)
      .set({ deletedAt: now, deletedBy: userId })
      .where(and(eq(tripMessages.id, messageId), isNull(tripMessages.deletedAt)))
      .returning();
    if (updated === undefined) return { ok: true, value: toMessage({ ...row, deletedAt: now }) } as const;
    await bumpChatRev(tx, tripId);
    return { ok: true, value: toMessage(updated) } as const;
  });
}

/**
 * Move the reader's cursor to this message. Never backwards: a stale tab
 * marking an older message read does not make newer ones unread again.
 *
 * Not a chat write: nobody else's page changes, so no `chatRev`.
 */
export async function markRead(tripId: string, userId: string, messageId: string): Promise<MessageOutcome<null>> {
  const row = await messageOnTrip(tripId, messageId);
  if (row === null) return { ok: false, error: "not-found" };
  await db
    .insert(tripChatReads)
    .values({ tripId, userId, lastReadAt: row.createdAt, lastReadId: row.id })
    .onConflictDoUpdate({
      target: [tripChatReads.tripId, tripChatReads.userId],
      set: { lastReadAt: sql`excluded.last_read_at`, lastReadId: sql`excluded.last_read_id` },
      // Forward only, by the same pair the list is ordered by.
      setWhere: sql`(excluded.last_read_at, excluded.last_read_id) > (${tripChatReads.lastReadAt}, ${tripChatReads.lastReadId})`,
    });
  return { ok: true, value: null };
}
