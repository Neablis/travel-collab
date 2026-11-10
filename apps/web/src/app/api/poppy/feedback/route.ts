import { BODY_MAX_BYTES, FeedbackBody, feedbackLimit, recordFeedback } from "@/server/poppy/feedback";
import { poppyError } from "@/server/poppy/errors";
import { poppyGate } from "@/server/poppy/sessions";
import { TOO_LARGE, readCapped } from "@/server/readBody";

export const runtime = "nodejs";

// **`POST {feedback.endpoint}`** (Poppy 9.3, ADR-089 decision 11): an agent says
// what it could not do here. The Session header is required and verified, since a
// report is stored under the `client_id` it proves and 9.3 forbids attributing one
// on an unverified claim; no scope, because a signed-out agent may report, which is
// why an agent nobody has allowed is let through the gate (under its own fetch
// quota). Like every route an agent calls, it opens or continues the Session: a
// report-only agent is then seen and can be blocked, as far as its report was
// inside the quota, and an ended Session is refused as `session_ended`. The quota
// is charged first, so a report refused as `session_ended` still spends a share
// (a blocked id is refused earlier, in the gate). Answers `202` with no body; a body that is
// malformed or too long is `invalid_request`. The text is data: stored as sent,
// never read as an instruction.
export async function POST(request: Request) {
  const gate = await poppyGate(request, { unknownClientOk: true });
  if ("refused" in gate) return gate.refused;
  if (gate.claims === null) return poppyError("invalid_session", "a report needs a Poppy-Session header");

  // Charged before the Session opens and the body is read: the Session row of a
  // stranger is what `recordStranger` writes, so only a report inside the share
  // records an agent, and a stream of malformed ones is limited too.
  const limited = await feedbackLimit(gate.claims.clientId, request);
  if (limited !== null) return limited;

  const ended = await gate.open(null, { recordStranger: true });
  if (ended !== null) return ended;

  const text = await readCapped(request, BODY_MAX_BYTES);
  const body = FeedbackBody.safeParse(parse(text));
  if (!body.success) {
    return Response.json(
      { error: "invalid_request", error_description: "task is 1 to 200 characters and description 1 to 2000" },
      { status: 400 },
    );
  }
  await recordFeedback(gate.claims.clientId, body.data);
  return new Response(null, { status: 202 });
}

/** The parsed body, or `null` for one that is absent, over the byte ceiling or not JSON: the schema refuses `null`. */
function parse(text: string | undefined | typeof TOO_LARGE): unknown {
  if (text === undefined || text === TOO_LARGE) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
