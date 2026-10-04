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
import { after } from "next/server";
import { handleAskRequest } from "@/server/ai/handleAskRequest";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // `after` keeps the turn's ledger writes alive past the response on the
  // abort and error paths too, which do not await them (KI-2026-09-14-b).
  return handleAskRequest(request, tripId, undefined, undefined, undefined, (task) => after(task));
}

// **The wall a turn is measured against, said out loud** (KI-2026-09-26-s).
// It was the platform's default until 2026-09-26, when a notebook turn ran into
// it and nothing — no record, no draft — survived. A literal because Next.js
// reads it statically; `ASK_MAX_DURATION_SECONDS` is the same number for code to
// derive the turn's two deadlines from, and `askDeadline.test.ts` asserts they agree.
export const maxDuration = 300;
