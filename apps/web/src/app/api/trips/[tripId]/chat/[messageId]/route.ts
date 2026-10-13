import { ChatMessage, EditChatMessage } from "@tc/contracts";
import { readBody } from "@/server/readBody";
import { chatAccess, chatReadOnly } from "@/server/chat/access";
import { deleteMessage, editMessage, type MessageOutcome } from "@/server/chat/messages";

type Params = { params: Promise<{ tripId: string; messageId: string }> };

const REFUSAL: Record<"not-found" | "forbidden" | "removed", [number, string]> = {
  "not-found": [404, "not-found"],
  forbidden: [403, "forbidden"],
  // The message was deleted or hidden; there is nothing left to edit.
  removed: [409, "This message has been removed."],
};

function answer(outcome: MessageOutcome<ChatMessage>): Response {
  if (!outcome.ok) {
    const [status, error] = REFUSAL[outcome.error];
    return Response.json({ error }, { status });
  }
  return Response.json({ message: ChatMessage.parse(outcome.value) });
}

/** The author edits their own message's text. */
export async function PATCH(request: Request, { params }: Params) {
  const { tripId, messageId } = await params;
  const access = await chatAccess(tripId);
  if ("error" in access) return access.error;
  if (!access.canPost) return chatReadOnly();
  const body = await readBody(request, EditChatMessage, "invalid-chat-message", { maxBytes: 64 * 1024 });
  if ("error" in body) return body.error;
  return answer(await editMessage(tripId, messageId, access.userId, body.data.body));
}

/**
 * Soft-delete: the author their own, the owner any. Answers the message as removed.
 *
 * Allowed after a lapse: read-only stops new content, not its removal, so an
 * owner can still take down a message in a chat nobody can post to.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { tripId, messageId } = await params;
  const access = await chatAccess(tripId);
  if ("error" in access) return access.error;
  return answer(await deleteMessage(tripId, messageId, access.userId, access.role));
}
