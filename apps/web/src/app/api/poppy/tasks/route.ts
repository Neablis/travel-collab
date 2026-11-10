import { poppyGate } from "@/server/poppy/sessions";
import { tasksResponse } from "@/server/poppy/tasks";

export const runtime = "nodejs";

// **`GET {tasks.endpoint}`** (Poppy 9, ADR-089 decision 11): the tasks Caesura
// does not offer, and where to send feedback. It describes what Caesura offers,
// not anyone's account, so it takes no access token and nothing is read from the
// Session: every Session gets the same body, which is why it may be cached
// (9 asks for `private` or `no-store` only on a response that differs).
//
// A header that is sent is still verified (5.3), so a forged one is refused as
// `invalid_session` and a blocked `client_id` as the kill switch has it, and an
// ended Session as `session_ended`, as on every route an agent calls. An agent
// nobody has allowed is let through: the body is public, and it is the signed-out
// agent that most needs to know what not to try. One with no header is served too.
export async function GET(request: Request) {
  const gate = await poppyGate(request, { unknownClientOk: true });
  if ("refused" in gate) return gate.refused;
  const ended = await gate.open(null, { recordStranger: true });
  if (ended !== null) return ended;
  return Response.json(tasksResponse(), { headers: { "Cache-Control": "public, max-age=300" } });
}
