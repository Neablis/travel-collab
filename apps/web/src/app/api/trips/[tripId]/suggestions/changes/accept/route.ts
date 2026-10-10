import { AcceptSuggestionChangesInput, SuggestionChange } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readBody } from "@/server/readBody";
import { acceptSuggestionChanges } from "@/server/suggestions/accept";
import { MAX_ACCEPT_BODY_BYTES, refused } from "@/server/suggestions/http";

/**
 * Accept several changes as one batch, all or nothing (M40 D1). A static
 * segment, so Next routes it ahead of the sibling `[changeId]`; no change id
 * is ever the word `accept`, which is not a uuid. Answers every change it
 * accepted, in the order they were replayed; a refusal names its change in
 * `changeId`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = await readBody(request, AcceptSuggestionChangesInput, "invalid-change-ids", { maxBytes: MAX_ACCEPT_BODY_BYTES });
  if ("error" in body) return body.error;
  const result = await acceptSuggestionChanges(tripId, body.data.changeIds, session.user.id);
  if (!result.ok) return refused(result.error);
  return Response.json({ changes: SuggestionChange.array().parse(result.value) });
}
