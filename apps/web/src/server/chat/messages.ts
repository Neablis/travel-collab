import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { CHAT_MESSAGE_MAX, type ChatLink, type ChatMessage, type PostChatMessage, type TripDetail, type TripRole } from "@tc/contracts";
import { db, type Queryable } from "../db/client";
import { pages, tripChatReads, tripMessages } from "../db/schema";
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
    kind: row.kind,
    requestedBy: row.requestedBy,
    replyTo: row.replyTo,
    suggestionId: row.suggestionId,
    asksAssistant: row.asksAssistant,
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
  const rows = await newestRows(tripId, CHAT_PAGE_LIMIT + 1);
  const hasEarlier = rows.length > CHAT_PAGE_LIMIT;
  const messages = rows.slice(0, CHAT_PAGE_LIMIT).reverse().map(toMessage);
  return { messages, hasEarlier, unread: await unreadCount(tripId, userId) };
}

/**
 * The newest `limit` messages, oldest first: what the assistant's `read_chat`
 * reads (M52 decision 18). A removed message keeps its place with no text, as
 * a member reads it.
 */
export async function recentMessages(tripId: string, limit: number): Promise<ChatMessage[]> {
  return (await newestRows(tripId, limit)).reverse().map(toMessage);
}

function newestRows(tripId: string, limit: number): Promise<Row[]> {
  return db
    .select()
    .from(tripMessages)
    .where(eq(tripMessages.tripId, tripId))
    .orderBy(desc(tripMessages.createdAt), desc(tripMessages.id))
    .limit(limit);
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

/**
 * Whether a new message's notebook or person is this trip's (the M46 walk): a
 * notebook on the trip, a person among its members. A day or stop is not
 * checked, as D3 left it: the client resolves one only on this trip's board.
 */
export async function linkOnTrip(detail: TripDetail, link: ChatLink): Promise<boolean> {
  if (link.kind === "person") return detail.members.some((m) => m.userId === link.id);
  if (link.kind !== "notebook") return true;
  const [page] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.tripId, detail.tripId), eq(pages.id, link.id)));
  return page !== undefined;
}

/** Store a message and move the trip's `chatRev`, in one transaction. */
export async function postMessage(
  tripId: string,
  authorId: string,
  input: PostChatMessage,
  now: Date = new Date(),
): Promise<ChatMessage> {
  return insertMessage({
    tripId,
    authorId,
    body: input.body,
    linkKind: input.link?.kind ?? null,
    linkId: input.link?.id ?? null,
    asksAssistant: input.assistant === true,
    createdAt: now,
  });
}

/**
 * The author id on the assistant's messages (M52). Not a `users.id`: nobody
 * signs in as it, so nobody edits one as its author, and the owner's delete
 * reaches it as it reaches any message.
 */
export const ASSISTANT_AUTHOR_ID = "assistant";

/** Who an assistant reply answers: the asker, their message, and any suggestion the turn stored. */
export interface AssistantReplyTo {
  requestedBy: string;
  replyTo: string;
  suggestionId?: string | null;
}

/**
 * An `@assistant` turn's reply, posted whole (decision 18) and naming the
 * member who asked. A reply past `CHAT_MESSAGE_MAX` is cut there rather than
 * lost: the turn has already been paid for.
 *
 * The model's text never passed `ChatMessageBody`, so its NUL refine is done
 * here: Postgres refuses U+0000 in a text column, and the insert would throw.
 */
export async function postAssistantReply(
  tripId: string,
  { requestedBy, replyTo, suggestionId = null }: AssistantReplyTo,
  body: string,
  now: Date = new Date(),
): Promise<ChatMessage> {
  const clean = body.replaceAll("\u0000", "");
  const text = clean.length <= CHAT_MESSAGE_MAX ? clean : `${clean.slice(0, CHAT_MESSAGE_MAX - 1).trimEnd()}…`;
  return insertMessage({
    tripId,
    authorId: ASSISTANT_AUTHOR_ID,
    kind: "assistant",
    requestedBy,
    replyTo,
    suggestionId,
    body: text,
    createdAt: now,
  });
}

/**
 * A change line (M52 decision 17): the app's announcement of a change someone
 * made, authored by them so it is not unread to them, and nobody's to edit or
 * delete (`editMessage`, `deleteMessage`). `body` is only what was done; the
 * chat names the author in front of it, as it does on their messages.
 */
export async function postSystemLine(
  tripId: string,
  actorId: string,
  body: string,
  link: ChatLink | undefined,
  now: Date = new Date(),
): Promise<ChatMessage> {
  return insertMessage({
    tripId,
    authorId: actorId,
    kind: "system",
    body,
    linkKind: link?.kind ?? null,
    linkId: link?.id ?? null,
    createdAt: now,
  });
}

async function insertMessage(values: Omit<typeof tripMessages.$inferInsert, "id">): Promise<ChatMessage> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tripMessages)
      .values({ id: randomUUID(), ...values })
      .returning();
    await bumpChatRev(tx, values.tripId);
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
  // A change line names its actor as author, and still says what the app saw.
  if (row.authorId !== userId || row.kind === "system") return { ok: false, error: "forbidden" };
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
 * Soft-delete: the author deletes their own, the owner any but a change line
 * (M46 D6, M52 decision 17). The row stays and reads as removed. Deleting a
 * message already removed changes nothing and moves no revision.
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
  if (row.kind === "system" || (row.authorId !== userId && role !== "owner")) return { ok: false, error: "forbidden" };
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
 * An admin hiding or restoring a reported message (ADR-073 §4), inside the
 * moderation transaction the caller holds. Hidden reads as removed for every
 * member, and `chatRev` moves in the same transaction so every open page
 * re-reads, as it does for an author's delete. Hiding twice keeps the first
 * time. Returns how many rows moved: 0 when no such message exists.
 *
 * The Chat module's write: Community (`reports.ts`) names the message by id
 * and never writes `trip_messages` itself.
 */
export async function setMessageHidden(
  tx: Queryable,
  tripId: string,
  messageId: string,
  hidden: boolean,
  at: Date,
): Promise<number> {
  const moved = await tx
    .update(tripMessages)
    .set({ hiddenAt: hidden ? sql`coalesce(${tripMessages.hiddenAt}, ${at})` : null })
    .where(and(eq(tripMessages.id, messageId), eq(tripMessages.tripId, tripId)))
    .returning({ id: tripMessages.id });
  if (moved.length > 0) await bumpChatRev(tx, tripId);
  return moved.length;
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
