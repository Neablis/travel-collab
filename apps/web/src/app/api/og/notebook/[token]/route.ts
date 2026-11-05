import { renderCard } from "@/server/og/card";
import { notebookCardFor, notebookCopy } from "@/server/og/notebook";
import { limitLinkPreview } from "@/server/og/limit";

// M58. Public, with no session read: the caller is a chat app's unfurler. Like
// the invite card, every token gets a 200 and a card, the live notebook's own
// or the generic one, since an unfurler draws nothing for an error and the
// status would tell a stranger nothing the card does not. Rate-limited per IP
// (`server/og/limit.ts`). Unlike the invite card it is not kept at the edge:
// making a notebook private works on the next request (ADR-088 §3), and a
// cached card would keep printing its title.
const NOTEBOOK_CACHE_CONTROL = "private, no-store";

/** `GET /api/og/notebook/:token` — a public notebook's preview image, 1200×630 PNG: its title and the trip's cover. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { token } = await params;
  const card = await notebookCardFor(token);
  return renderCard(notebookCopy(card), NOTEBOOK_CACHE_CONTROL, {}, card.kind === "notebook" ? card.cover : null);
}
