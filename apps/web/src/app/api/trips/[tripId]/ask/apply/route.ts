// Approval route (M9): POST /api/trips/:id/ask/apply { proposalId?, commands }
// → the same `{ detail, history, message }` a command batch answers with.
//
// The assistant's turn proposes and commits nothing; this is where a human's
// Approve becomes ONE atomic batch (ADR-013). Rejecting is this route not being
// called, so nothing on the reject path can get it wrong.
//
// The logic lives in @/server/ai/handleAskRequest beside the turn that produced
// the proposal, for the reason every route file in this tree does: Next.js only
// allows HTTP-method exports here, so a function the integration tests import
// directly to inject a geocoder cannot live in a route file.
import { handleApplyProposalRequest } from "@/server/ai/handleAskRequest";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return handleApplyProposalRequest(request, tripId);
}
