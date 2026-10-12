// The account assistant (M45): POST /api/ask { messages, scope: { kind:
// "account" } } → a UI message stream answering across every trip the asker
// travelled on. It reads; it commits nothing and proposes nothing.
//
// The logic lives in @/server/ai/handleAskRequest beside the trip door's, and
// for the same reason: a route file may export only HTTP methods and a small
// config allowlist, and the integration tests inject a model.
import { after } from "next/server";
import { handleAccountAskRequest } from "@/server/ai/handleAskRequest";

export async function POST(request: Request) {
  // `after` keeps the turn's ledger writes alive past the response, as on the
  // trip door (KI-2026-09-14-b).
  return handleAccountAskRequest(request, undefined, undefined, undefined, (task) => after(task));
}

// The trip door's wall, for the same turn budget (`askDeadline.ts`).
export const maxDuration = 300;
