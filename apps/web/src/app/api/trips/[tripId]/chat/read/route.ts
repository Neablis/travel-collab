import { MarkChatRead } from "@tc/contracts";
import { readBody } from "@/server/readBody";
import { chatAccess } from "@/server/chat/access";
import { markRead } from "@/server/chat/messages";

/**
 * Move the caller's read cursor to a message (M46 D5); 204. Reading is not
 * posting, so a member may mark read after a lapse too.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await chatAccess(tripId);
  if ("error" in access) return access.error;
  const body = await readBody(request, MarkChatRead, "invalid-chat-read", { maxBytes: 1024 });
  if ("error" in body) return body.error;
  const outcome = await markRead(tripId, access.userId, body.data.messageId);
  if (!outcome.ok) return Response.json({ error: "not-found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
