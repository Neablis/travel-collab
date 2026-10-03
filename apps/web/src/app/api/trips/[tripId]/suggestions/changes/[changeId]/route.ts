import { ResolveSuggestionChangeInput, SuggestionChange } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readBody } from "@/server/readBody";
import { resolveSuggestionChange } from "@/server/suggestions/resolve";
import { refused } from "@/server/suggestions/http";

/**
 * Accept, dismiss or withdraw one change (spec W14). Answers every change the
 * call resolved, the named one first: a dismiss or withdraw takes its pending
 * dependents with it, and the client must not have to refetch to learn which.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tripId: string; changeId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId, changeId } = await params;
  const body = await readBody(request, ResolveSuggestionChangeInput, "invalid-action");
  if ("error" in body) return body.error;
  const result = await resolveSuggestionChange(tripId, changeId, session.user.id, body.data.action);
  if (!result.ok) return refused(result.error);
  return Response.json({ changes: SuggestionChange.array().parse(result.value) });
}
