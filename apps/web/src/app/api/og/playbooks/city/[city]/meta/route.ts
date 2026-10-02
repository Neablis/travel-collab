import { LinkPreviewMeta } from "@tc/contracts";
import { PLAYBOOKS_GENERIC_CACHE_CONTROL } from "@/server/og/card";
import { playbookCityCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { cityCardFor, segment } from "@/server/og/playbooks";

// For Discover's `generateMetadata` when the URL names one city.
/** `GET /api/og/playbooks/city/:city/meta` — `LinkPreviewMeta` for one city's Discover preview. */
export async function GET(request: Request, { params }: { params: Promise<{ city: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { city } = await params;
  const { title, description } = playbookCityCopy(await cityCardFor(segment(city)));
  return Response.json(LinkPreviewMeta.parse({ title, description }), {
    headers: { "Cache-Control": PLAYBOOKS_GENERIC_CACHE_CONTROL },
  });
}
