import { LIBRARY_TAG, cacheTagHeader } from "@/server/libraryCache";
import { PLAYBOOK_CACHE_CONTROL, renderCard } from "@/server/og/card";
import { playbookCityCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { cityCardFor, segment } from "@/server/og/playbooks";

// Spec 2026-10-02 §2.7: `/playbooks?city=` for exactly one city. The city is
// printed only when a published day carries it; any other text, typed into a
// URL by anyone, gets the generic card rather than a branded line of its own.
/** `GET /api/og/playbooks/city/:city` — Discover-for-one-city's preview image, 1200×630 PNG. */
export async function GET(request: Request, { params }: { params: Promise<{ city: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { city } = await params;
  return renderCard(
    playbookCityCopy(await cityCardFor(segment(city))),
    PLAYBOOK_CACHE_CONTROL,
    cacheTagHeader(LIBRARY_TAG),
  );
}
