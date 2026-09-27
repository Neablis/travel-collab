import { guard } from "@/server/pages-guard";
import { listPageEntries } from "@/server/pages";
import { addMissingDefaultPages } from "@/server/pageCommands";
import { defaultNotebookRefusal } from "@/server/defaultNotebookResponses";

// "Add missing default notebooks" (Mitchell, 2026-09-27): seeds every default
// notebook this trip has none of, and answers with the list as it now is, so
// the index can replace its rows in one step. Owner only — the guard refuses
// an editor or a viewer with the ordinary 403, and the pipeline checks again.
//
// No body: which notebooks are missing is the server's to work out, from the
// same `@tc/pages` rule the index used to decide whether to offer this.
export async function POST(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const g = await guard(tripId, "owner");
  if ("error" in g) return g.error;
  const result = await addMissingDefaultPages(tripId, g.userId);
  if (!result.ok) return defaultNotebookRefusal(result.error);
  return Response.json({ pages: await listPageEntries(tripId), viewerId: g.userId });
}
