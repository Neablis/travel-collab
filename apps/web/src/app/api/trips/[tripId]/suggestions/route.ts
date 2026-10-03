import { CreateSuggestionInput, SuggestionChange, TripSuggestionsResponse } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readBody } from "@/server/readBody";
import { createSuggestion } from "@/server/suggestions/create";
import { listSuggestionChanges } from "@/server/suggestions/list";
import type { SuggestionError, SuggestionErrorCode } from "@/server/suggestions/shared";

// Exhaustive, so a code the module adds cannot reach a client as a default.
// The module decides who is told not-found rather than forbidden (spec W26),
// which is why neither handler goes through `requireTripAccess`: its 403 for a
// stranger would contradict it, and it would read the trip a second time.
const STATUS: Record<SuggestionErrorCode, number> = {
  "not-found": 404,
  forbidden: 403,
  invalid: 400,
  "does-not-apply": 422,
  "dependency-pending": 409,
  "already-resolved": 409,
  "no-longer-applies": 409,
};

function refused({ code, message, index }: SuggestionError): Response {
  return Response.json({ error: message, code, index }, { status: STATUS[code] });
}

/** The changes this reader may see (a suggester their own, a reviewer all), and their `rev`. */
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
