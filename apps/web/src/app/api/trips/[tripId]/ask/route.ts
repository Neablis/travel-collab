// Ask route (M16, ADR-022) — and since ADR-033 Decision 1, THE AI route:
// POST /api/trips/:id/ask { messages, scope } → a UI message stream (SSE)
// carrying the assistant's answer and every tool call it made along the way.
// `scope` says what the turn is about; for a `page` scope the handler verifies
// it against the stored page before offering any page tool, and the turn drafts
// that page instead of answering.
//
// It commits nothing. The approval half is ./apply, and it runs only after a
// human clicked Approve.
//
// The logic lives in @/server/ai/handleAskRequest because Next.js only allows
// HTTP-method exports (+ a small config allowlist) from a route file, so a
// function the integration tests import directly to inject a model can't live
// here.
import { handleAskRequest } from "@/server/ai/handleAskRequest";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return handleAskRequest(request, tripId);
}
