import { ResetPageInput } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { isUuid } from "@/server/ids";
import { resetPageToDefault } from "@/server/pageCommands";
import { defaultNotebookRefusal } from "@/server/defaultNotebookResponses";
import { readBody } from "@/server/readBody";

// "Reset to default" on a seeded notebook (Mitchell, 2026-09-27). Owner only.
// One more edit in the trip's history, never a delete and recreate: the page
// keeps its id, so the Overview's links to it still resolve.
//
// `restoreSeq` is the version just before the reset — what the screen's Undo
// hands to `…/restore`. A reset that changed nothing wrote nothing, and has
// nothing to undo.
export async function POST(req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "owner");
  if ("error" in g) return g.error;
  if (!isUuid(pageId)) return Response.json({ error: "not-found" }, { status: 404 });
  const body = await readBody(req, ResetPageInput, "invalid-reset");
  if ("error" in body) return body.error;
  const result = await resetPageToDefault(tripId, pageId, g.userId, body.data.expectedUpdatedAt);
  if (!result.ok) return defaultNotebookRefusal(result.error);
  if (result.page === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ page: result.page, restoreSeq: result.seq === null ? null : result.seq - 1 });
}
