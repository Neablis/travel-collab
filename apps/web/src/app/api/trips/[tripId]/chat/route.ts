import { ChatMessage, ChatPage, PostChatMessage } from "@tc/contracts";
import { readBody } from "@/server/readBody";
import { CHAT_NOT_ENTITLED_CODE, chatAccess, chatReadOnly } from "@/server/chat/access";
import { linkOnTrip, listMessages, postMessage } from "@/server/chat/messages";

// A trip's chat (M46, ADR-073). Not a planning command: a message is written
// to its own table, never to the event log. Who may read and post is
// `chatAccess`, asked again on every request.

/** The newest messages, the reader's unread count, and whether they may post. Any member. */
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await chatAccess(tripId);
  if ("error" in access) return access.error;
  const page = await listMessages(tripId, access.userId);
  return Response.json(
    ChatPage.parse({
      ...page,
      canPost: access.canPost,
      ...(access.canPost ? {} : { readOnlyReason: CHAT_NOT_ENTITLED_CODE }),
    }),
  );
}

/** Post a message; 201 with it. Any member while the owner is entitled; 402 after a lapse. */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await chatAccess(tripId);
  if ("error" in access) return access.error;
  if (!access.canPost) return chatReadOnly();
  const body = await readBody(request, PostChatMessage, "invalid-chat-message", { maxBytes: 64 * 1024 });
  if ("error" in body) return body.error;
  if (body.data.link !== undefined && !(await linkOnTrip(access.detail, body.data.link))) {
    return Response.json({ error: "That notebook or person isn't on this trip." }, { status: 400 });
  }
  const message = await postMessage(tripId, access.userId, body.data);
  return Response.json({ message: ChatMessage.parse(message) }, { status: 201 });
}
