// Ask route (M16, ADR-022): POST /api/trips/:id/ask { messages, scope } → a UI
// message stream (SSE) carrying the assistant's answer and every read-tool call
// it made along the way. Beside, and never instead of, POST /api/trips/:id/ai —
// that one commits changes and answers nothing; this one answers and commits
// nothing.
//
// The logic lives in @/server/ai/handleAskRequest for the same reason
// `handleAiRequest` does: Next.js only allows HTTP-method exports (+ a small
// config allowlist) from a route file, so a function the integration tests
// import directly to inject a model can't live here.
import { handleAskRequest } from "@/server/ai/handleAskRequest";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return handleAskRequest(request, tripId);
}
