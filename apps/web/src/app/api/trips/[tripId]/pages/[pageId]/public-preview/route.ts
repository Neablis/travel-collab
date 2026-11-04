import { guard } from "@/server/pages-guard";
import { publishPreviewFor } from "@/server/access/publicNotebook";

// The publish dialog's stranger's-eye preview (M58 decision 5). `editor`, the
// role that can publish: it shows what the link would serve, which is the
// page's content with the hidden widgets already withheld, so it is built here
// by the same function `/n/<token>` uses and never recomputed in the browser
// from the member's data.
export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  const preview = await publishPreviewFor(tripId, pageId);
  return preview === null ? Response.json({ error: "not-found" }, { status: 404 }) : Response.json({ preview });
}
