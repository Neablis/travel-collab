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
// `invalid_session` and a blocked `client_id` as the kill switch has it. One that
// is not sent is served: the body is public, and nothing here is attributed.
export async function GET(request: Request) {
  const gate = await poppyGate(request);
  if ("refused" in gate) return gate.refused;
  return Response.json(tasksResponse(), { headers: { "Cache-Control": "public, max-age=300" } });
}
