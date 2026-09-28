import { REFERRAL_CACHE_CONTROL, renderCard } from "@/server/og/card";
import { referralCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { referrerFirstNameFor } from "@/server/og/referral";

// Spec 2026-09-27 §2. `/signup` only points og:image here when the meta route
// found a referrer, so an unknown code reaches this only by a hand-built URL;
// it gets the nameless invitation rather than an error image.
//
// Rate-limited per IP (`server/og/limit.ts`): this lookup is a narrow form of
// the "is this code valid?" oracle M11a refused, and a code's ~49 bits are the
// first defence, the limiter the second — `server/og/referral.ts` has the rest.
/** `GET /api/og/referral/:code` — the referral link's preview image, 1200×630 PNG. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { code } = await params;
  return renderCard(referralCopy(await referrerFirstNameFor(code)), REFERRAL_CACHE_CONTROL);
}
