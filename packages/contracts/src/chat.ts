import { z } from "zod";

// A trip's chat (M46, ADR-073): what the people on a trip say to each other.
// Ordinary CRUD in its own store (`trip_messages`), never an event: replaying
// the log must not need it and undo must never take back something somebody
// said. Not on the public API (`server/public-api/exposure.ts`).

/** The longest message, in characters. A chat line, not a document. */
export const CHAT_MESSAGE_MAX = 4000;

/**
 * A message's link to one day, stop, notebook or person on the trip (M46 D3,
 * and the M46 walk for the last two), by id. The target may later be deleted
 * or the person removed; the link is kept and the client renders it as plain
 * text, so nothing here promises the id still resolves.
 *
 * A person is a `users.id`, which is not a uuid; the rest are.
 */
export const ChatLink = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["day", "stop", "notebook"]), id: z.string().uuid() }),
  z.object({ kind: z.literal("person"), id: z.string().min(1).max(255) }),
]);
export type ChatLink = z.infer<typeof ChatLink>;

const ChatMessageBody = z
  .string()
  .trim()
  .min(1, "A message cannot be empty.")
  .max(CHAT_MESSAGE_MAX, `A message is at most ${CHAT_MESSAGE_MAX} characters.`)
  // Postgres cannot store U+0000 in `text`; refused here it is a 400, not a
  // failed insert answered 500.
  .refine((body) => !body.includes("\u0000"), "A message cannot contain a NUL character.");

const MessageMeta = {
  messageId: z.string().uuid(),
  authorId: z.string().min(1),
  createdAt: z.string(),
  /** When the author last changed the text; null when never. */
  editedAt: z.string().nullable(),
};

/**
 * One message as a member reads it. A removed message (deleted by its author
 * or the owner, or hidden by an admin) keeps its place in the conversation and
 * carries **no text and no link**: the variant has no field to leak them in.
 */
export const ChatMessage = z.discriminatedUnion("removed", [
  z.object({ ...MessageMeta, removed: z.literal(false), body: z.string(), link: ChatLink.optional() }),
  z.object({ ...MessageMeta, removed: z.literal(true) }),
]);
export type ChatMessage = z.infer<typeof ChatMessage>;

/** `POST /api/trips/:tripId/chat`. */
export const PostChatMessage = z.object({
  body: ChatMessageBody,
  link: ChatLink.optional(),
});
export type PostChatMessage = z.infer<typeof PostChatMessage>;

/** `PATCH /api/trips/:tripId/chat/:messageId` — the author's new text. The link is not editable. */
export const EditChatMessage = z.object({
  body: ChatMessageBody,
});
export type EditChatMessage = z.infer<typeof EditChatMessage>;

/** `POST /api/trips/:tripId/chat/read` — the newest message the caller has seen. */
export const MarkChatRead = z.object({
  messageId: z.string().uuid(),
});
export type MarkChatRead = z.infer<typeof MarkChatRead>;

/**
 * Why a member may read but not post (M46 D2). The only one today: the trip's
 * owner is no longer entitled to collaborators, and the chat stays readable.
 */
export const ChatReadOnlyReason = z.enum(["collaborators-not-entitled"]);
export type ChatReadOnlyReason = z.infer<typeof ChatReadOnlyReason>;

/**
 * `GET /api/trips/:tripId/chat` — the newest messages, oldest first.
 *
 * `unread` counts messages by other people, not removed, after the caller's
 * read cursor. `hasEarlier` says the page was cut at its limit, so a client
 * never shows a partial conversation as the whole of it.
 */
export const ChatPage = z.object({
  messages: z.array(ChatMessage),
  hasEarlier: z.boolean(),
  unread: z.number().int().nonnegative(),
  canPost: z.boolean(),
  readOnlyReason: ChatReadOnlyReason.optional(),
});
export type ChatPage = z.infer<typeof ChatPage>;
