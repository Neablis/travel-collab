import { PLAYBOOKS_GENERIC_CACHE_CONTROL, renderCard } from "@/server/og/card";
import { playbookCountryCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { countryCardFor, segment } from "@/server/og/playbooks";

// The country page's card (SEO pass, Part 5), in the city card's shape. Keyed
// by ISO code, so the only text it can print is a country's own name.
/** `GET /api/og/playbooks/country/:code` — a country page's preview image, 1200×630 PNG. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { code } = await params;
  return renderCard(playbookCountryCopy(await countryCardFor(segment(code))), PLAYBOOKS_GENERIC_CACHE_CONTROL);
}
