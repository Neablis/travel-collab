import { FeedbackBody, feedbackLimit, recordFeedback } from "@/server/poppy/feedback";
import { poppyError } from "@/server/poppy/errors";
import { poppyGate } from "@/server/poppy/sessions";

export const runtime = "nodejs";

// **`POST {feedback.endpoint}`** (Poppy 9.3, ADR-089 decision 11): an agent says
// what it could not do here. The Session header is required and verified, since a
// report is stored under the `client_id` it proves and 9.3 forbids attributing one
// on an unverified claim; no scope, because a signed-out agent may report. Answers
// `202` with no body; a body that is malformed or too long is `invalid_request`.
// The text is data: stored as sent, never read as an instruction.
export async function POST(request: Request) {
  const gate = await poppyGate(request);
  if ("refused" in gate) return gate.refused;
  if (gate.claims === null) return poppyError("invalid_session", "a report needs a Poppy-Session header");

  const limited = await feedbackLimit(gate.claims.clientId);
  if (limited !== null) return limited;

  const body = FeedbackBody.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: "invalid_request", error_description: "task is 1 to 200 characters and description 1 to 2000" },
      { status: 400 },
    );
  }
  await recordFeedback(gate.claims.clientId, body.data);
  return new Response(null, { status: 202 });
}
