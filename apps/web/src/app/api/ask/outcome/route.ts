// What a person did with a turn's answer (M57): POST /api/ask/outcome
// { turnId, kind }. The browser reports the three things only it sees — a
// hand-off pressed, a carried-ask chip pressed, a trip created from a hand-off.
// The approval and the accept are recorded by the server where they happen.
import { z } from "zod";
import { CLIENT_OUTCOME_KINDS } from "@/lib/turnOutcomeKinds";
import { auth } from "@/server/auth";
import { recordTurnOutcome } from "@/server/turnOutcomes";
import { consumeQuota, quotaRefusal, turnOutcomeQuota } from "@/server/quota";
import { readBody } from "@/server/readBody";

const OutcomeInput = z.object({ turnId: z.string().guid(), kind: z.enum(CLIENT_OUTCOME_KINDS) });

/**
 * 204 once recorded (a repeat of the same press too); 404 for a turn that is
 * not the caller's, which is not told apart from one that does not exist. That
 * includes a press that beats the turn's `ai_usage` row, written after the
 * stream ends: an accepted limit, the outcome is lost (`recordTurnOutcome`).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const userId = session.user.id;
  const decision = await consumeQuota(turnOutcomeQuota(), userId);
  if (!decision.allowed) return quotaRefusal(decision);
  const body = await readBody(request, OutcomeInput, "invalid-outcome", { maxBytes: 1024 });
  if ("error" in body) return body.error;
  const recorded = await recordTurnOutcome(body.data.turnId, body.data.kind, userId);
  return recorded ? new Response(null, { status: 204 }) : Response.json({ error: "turn-not-found" }, { status: 404 });
}
