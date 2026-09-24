import { SavedNotebook } from "@tc/contracts";
import { auth } from "@/server/auth";
import { deleteSavedNotebook, getSavedNotebook } from "@/server/savedNotebooks";

// Owner-only, and scoped in the query rather than checked after the read: a
// template belonging to someone else is indistinguishable from one that does
// not exist, which is the right answer to both. There is no publish yet, so
// unlike a saved day there is no second kind of reader to let in.
export async function GET(_request: Request, { params }: { params: Promise<{ savedNotebookId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { savedNotebookId } = await params;
  const savedNotebook = await getSavedNotebook(savedNotebookId, session.user.id);
  if (savedNotebook === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ savedNotebook: SavedNotebook.parse(savedNotebook) });
}

// A soft delete (`deleteSavedNotebook`). 404 for not yours, never existed, or
// already deleted — one answer, so ids cannot be probed.
export async function DELETE(_request: Request, { params }: { params: Promise<{ savedNotebookId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { savedNotebookId } = await params;
  if (!(await deleteSavedNotebook(savedNotebookId, session.user.id))) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
