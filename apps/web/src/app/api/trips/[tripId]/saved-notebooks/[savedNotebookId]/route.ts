import { Page } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { instantiateSavedNotebook } from "@/server/savedNotebooks";

const STATUS: Record<string, number> = {
  "not-found": 404,
  forbidden: 403,
  "demo-trip-readonly": 403,
  "concurrency-conflict": 409,
};

/**
 * Make a new notebook in this trip from one of your saved notebooks: 201 with
 * the `Page`.
 *
 * TWO checks, the saved-day insert's pair: `editor` on the target trip (this
 * creates a page), and ownership of the template (enforced inside
 * `instantiateSavedNotebook`, which only reads it scoped to the caller).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; savedNotebookId: string }> },
) {
  const { tripId, savedNotebookId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;

  const result = await instantiateSavedNotebook(savedNotebookId, access.detail, access.userId);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ page: Page.parse(result.page) }, { status: 201 });
}
