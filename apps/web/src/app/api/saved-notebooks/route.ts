import { CreateSavedNotebookInput, SavedNotebook, SavedNotebookSummary } from "@tc/contracts";
import { auth } from "@/server/auth";
import { requireTripAccess } from "@/server/access/trip-access";
import { listSavedNotebooks, saveNotebook } from "@/server/savedNotebooks";

/**
 * The signed-in person's saved notebooks, newest first, without their
 * documents (M14 link 10, on `/api/saved-days`' conventions). Per-person:
 * there is no route that takes an ownerId.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const savedNotebooks = await listSavedNotebooks(session.user.id);
  return Response.json({ savedNotebooks: savedNotebooks.map((s) => SavedNotebookSummary.parse(s)) });
}

/**
 * Keep one of a trip's notebooks as a template: 201 with the `SavedNotebook`,
 * 404 for a page not in that trip, 400 for a document this build cannot keep.
 */
export async function POST(request: Request) {
  const body = CreateSavedNotebookInput.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-saved-notebook" }, { status: 400 });
  // `viewer`, a saved day's reason (ADR-028): keeping a copy of what you can
  // already read takes nothing from the trip. Still a check — you cannot keep a
  // notebook out of a trip you were never let into.
  const access = await requireTripAccess(body.data.tripId, "viewer");
  if ("error" in access) return access.error;

  const result = await saveNotebook(body.data, access.detail, access.userId);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message },
      { status: result.error.code === "not-found" ? 404 : 400 },
    );
  }
  return Response.json({ savedNotebook: SavedNotebook.parse(result.value) }, { status: 201 });
}
