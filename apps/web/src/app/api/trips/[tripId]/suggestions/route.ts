import { CreateSuggestionInput, SuggestionChange, TripSuggestionsResponse } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readBody } from "@/server/readBody";
import { createSuggestion } from "@/server/suggestions/create";
import { listSuggestionChanges } from "@/server/suggestions/list";
import { refused } from "@/server/suggestions/http";

/** The pending changes this reader may see (a suggester their own, a reviewer all), and their `rev`. */
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const result = await listSuggestionChanges(tripId, session.user.id);
  if (!result.ok) return refused(result.error);
  return Response.json(TripSuggestionsResponse.parse(result.value));
}

/** A suggester's draft. 201 with one change per unit, in draft order. */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = await readBody(request, CreateSuggestionInput, "invalid-suggestion");
  if ("error" in body) return body.error;
  const result = await createSuggestion(tripId, session.user.id, body.data);
  if (!result.ok) return refused(result.error);
  return Response.json({ changes: SuggestionChange.array().parse(result.value) }, { status: 201 });
}
