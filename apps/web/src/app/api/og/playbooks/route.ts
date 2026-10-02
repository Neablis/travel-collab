import { PLAYBOOKS_GENERIC_CACHE_CONTROL, renderCard } from "@/server/og/card";
import { PLAYBOOKS_BOARD, PLAYBOOKS_GENERIC } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";

// Spec 2026-10-02 §2.7: the card `/playbooks` and `/playbooks/board` point at,
// and the one every day, profile or city lookup falls back to. Static words,
// so the pages state their own og:title (`lib/playbooksPreview.ts`) and there
// is no `meta` sibling. Still charged to the per-IP limiter: a render is not
// free, and a CDN miss is a render.
/** `GET /api/og/playbooks[?board=1]` — the Playbooks preview image, 1200×630 PNG. */
export async function GET(request: Request) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const board = new URL(request.url).searchParams.get("board") === "1";
  return renderCard(board ? PLAYBOOKS_BOARD : PLAYBOOKS_GENERIC, PLAYBOOKS_GENERIC_CACHE_CONTROL);
}
