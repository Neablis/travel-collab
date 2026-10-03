import { AddDefaultPagesInput } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { listPageEntries } from "@/server/pages";
import { addMissingDefaultPages } from "@/server/pageCommands";
import { defaultNotebookRefusal } from "@/server/defaultNotebookResponses";
import { readBody } from "@/server/readBody";

// "Add missing default notebooks" (Mitchell, 2026-09-27): seeds every default
// notebook this trip has none of, and answers with the list as it now is, so
// the index can replace its rows in one step. Owner only — the guard refuses
// an editor or a viewer with the ordinary 403, and the pipeline checks again.
//
// Which notebooks are missing is the server's to work out, from the same
// `@tc/pages` rule the index used to decide whether to offer this. The body may
// name ONE (`seedKey`) — a link card to a missing default adds the notebook it
// points at and no other (Mitchell, 2026-10-03).
/** Seeds the default notebooks this trip lacks, or the one named (owner only), and answers `{ pages, viewerId }`, as the list does. */
export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const g = await guard(tripId, "owner");
  if ("error" in g) return g.error;
  const body = await readBody(req, AddDefaultPagesInput, "invalid-defaults");
  if ("error" in body) return body.error;
  const result = await addMissingDefaultPages(tripId, g.userId, body.data.seedKey);
  if (!result.ok) return defaultNotebookRefusal(result.error);
  return Response.json({ pages: await listPageEntries(tripId), viewerId: g.userId });
}
