import { RestorePageInput } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { isUuid } from "@/server/ids";
import { restorePageVersion } from "@/server/pageCommands";
import { defaultNotebookRefusal } from "@/server/defaultNotebookResponses";
import { readBody } from "@/server/readBody";

// The Undo for "Reset to default": puts a notebook back to how it was at a
// version of the trip's history, as one more edit. Owner only, because it is
// the reset's undo — a page undo for everyone is KI-2026-09-22-c's to design.
/** Restores a notebook to its title and document at `toSeq` (owner only); answers `{ page }`. */
export async function POST(req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "owner");
  if ("error" in g) return g.error;
  if (!isUuid(pageId)) return Response.json({ error: "not-found" }, { status: 404 });
  const body = await readBody(req, RestorePageInput, "invalid-restore");
  if ("error" in body) return body.error;
  const result = await restorePageVersion(tripId, pageId, body.data.toSeq, g.userId, body.data.expectedUpdatedAt);
  if (!result.ok) return defaultNotebookRefusal(result.error);
  if (result.page === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ page: result.page });
}
