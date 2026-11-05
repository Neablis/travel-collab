import { guard } from "@/server/pages-guard";
import { publishPreviewFor } from "@/server/access/publicNotebook";

/**
 * The publish dialog's stranger's-eye preview (M58 decision 5). Needs `editor`,
 * the role that can publish. It shows what the link would serve, which is the
 * page's content with the hidden widgets already withheld, so it is built here
 * by the same function `/n/<token>` uses and never recomputed in the browser
 * from the member's data. Answers 404 for an unknown page, 422 for a notebook
 * that can't be made public.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  const preview = await publishPreviewFor(tripId, pageId);
  if (preview === null) return Response.json({ error: "not-found" }, { status: 404 });
  // The same refusal `POST .../shares` gives, so the dialog never previews what it cannot publish.
  if (preview === "unpublishable") return Response.json({ error: "This notebook can't be made public." }, { status: 422 });
  return Response.json({ preview });
}
