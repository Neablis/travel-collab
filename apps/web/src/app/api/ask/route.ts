// The assistants about no one trip (M45): POST /api/ask { messages, scope } →
// a UI message stream. `{ kind: "account" }` answers across every trip the
// asker travelled on and reads only; `{ kind: "playbook", page }` answers
// about one playbook page and, on a shared day, may draft the page's own two
// writes as a card (D9).
//
// The logic lives in @/server/ai/handleAskRequest beside the trip door's, and
// for the same reason: a route file may export only HTTP methods and a small
// config allowlist, and the integration tests inject a model.
import { after } from "next/server";
import { handleBeyondTripAskRequest } from "@/server/ai/handleAskRequest";

/** An assistant turn about no one trip: the account's or a playbook page's, as a UI message stream. */
export async function POST(request: Request) {
  // `after` keeps the turn's ledger writes alive past the response, as on the
  // trip door (KI-2026-09-14-b).
  return handleBeyondTripAskRequest(request, undefined, undefined, undefined, (task) => after(task));
}

// The trip door's wall, for the same turn budget (`askDeadline.ts`).
export const maxDuration = 300;
