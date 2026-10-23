import { after } from "next/server";
import { ChatMessage, ChatPage, PostChatMessage } from "@tc/contracts";
import { readBody } from "@/server/readBody";
import { CHAT_NOT_ENTITLED_CODE, chatAccess, chatReadOnly } from "@/server/chat/access";
import { linkOnTrip, listMessages, postMessage } from "@/server/chat/messages";
import { resolveAiEntitlements } from "@/server/entitlements/resolver";
import { AI_NOT_ENTITLED_REASON, deniedResponse } from "@/server/ai/modelSelection";
import { runChatAskTurn } from "@/server/ai/handleAskRequest";

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

/**
 * Post a message; 201 with it. Any member while the owner is entitled; 402 after a lapse.
 *
 * An `@assistant` message (M52 decision 18) also starts a turn on the poster's
 * own plan, run once the response has gone, whose reply lands in the thread.
 * A poster whose plan has no assistant is refused 402 before anything is
 * posted or spent, with the Ask tab's own refusal.
 */
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
  const asksAssistant = body.data.assistant === true;
  if (asksAssistant && !(await resolveAiEntitlements({ userId: access.userId })).has("ai.ask")) {
    return deniedResponse(AI_NOT_ENTITLED_REASON);
  }
  const message = await postMessage(tripId, access.userId, body.data);
  if (asksAssistant) {
    after(() => runChatAskTurn({ tripId, askerId: access.userId, question: body.data.body, messageId: message.messageId }));
  }
  return Response.json({ message: ChatMessage.parse(message) }, { status: 201 });
}

// The `@assistant` turn runs in `after()`, inside this function's lifetime, so
// it gets the Ask route's wall (`ask/route.ts`), a literal for the same reason,
// and `askDeadline.test.ts` holds both to `ASK_MAX_DURATION_SECONDS`.
export const maxDuration = 300;
