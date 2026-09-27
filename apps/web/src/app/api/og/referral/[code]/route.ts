import { renderCard } from "@/server/og/card";
import { referralCopy } from "@/server/og/copy";
import { referrerFirstNameFor } from "@/server/og/referral";

// Spec 2026-09-27 §2. `/signup` only points og:image here when the meta route
// found a referrer, so an unknown code reaches this only by a hand-built URL;
// it gets the nameless invitation rather than an error image.
//
// Not rate-limited, the same as `GET /api/invites/:token`: no anonymous read in
// this app has a limiter, and a code is ~49 bits — `server/og/referral.ts` says
// why this lookup is not the oracle M11a refused.
/** `GET /api/og/referral/:code` — the referral link's preview image, 1200×630 PNG. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return renderCard(referralCopy(await referrerFirstNameFor(code)));
}
