// AI route (Task 5.5): POST /api/trips/:id/ai { prompt, surface, pageContext? }
// → for `page` surface, a validated PageContent; for `board`/`combined`, the
// atomic-batch result (detail + history) from whatever tool calls the model
// made. The actual logic lives in @/server/ai/handleAiRequest — Next.js only
// allows HTTP-method exports (+ a small config allowlist) from a route file,
// so `handleAiRequest` (which tests import directly to inject a fake model)
// can't live here itself.
import { handleAiRequest } from "@/server/ai/handleAiRequest";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return handleAiRequest(request, tripId);
}
