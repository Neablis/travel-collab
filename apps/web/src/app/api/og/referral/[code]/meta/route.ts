import { LinkPreviewMeta } from "@tc/contracts";
import { REFERRAL_CACHE_CONTROL } from "@/server/og/card";
import { referralCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { referrerFirstNameFor } from "@/server/og/referral";

// For `/signup?code=`'s `generateMetadata`. A 404 for a code that names nobody
// is the page's cue to keep the site card: the spec's fallback for a failed
// referral lookup is "the current site card", not a nameless one. The 404 is
// not cached, so a code minted a moment later is not hidden behind it.
/** `GET /api/og/referral/:code/meta` — `LinkPreviewMeta`, or 404 when the code names nobody. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { code } = await params;
  const name = await referrerFirstNameFor(code);
  if (name === null) return Response.json({ error: "not-found" }, { status: 404 });
  const { title, description } = referralCopy(name);
  return Response.json(LinkPreviewMeta.parse({ title, description }), {
    headers: { "Cache-Control": REFERRAL_CACHE_CONTROL },
  });
}
