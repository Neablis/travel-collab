import { CARD_CACHE_CONTROL } from "@/server/og/card";
import { referralCopy } from "@/server/og/copy";
import { referrerFirstNameFor } from "@/server/og/referral";

// For `/signup?code=`'s `generateMetadata`. A 404 for a code that names nobody
// is the page's cue to keep the site card: the spec's fallback for a failed
// referral lookup is "the current site card", not a nameless one.
/** `GET /api/og/referral/:code/meta` — `{ title, description }`, or 404 when the code names nobody. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const name = await referrerFirstNameFor(code);
  if (name === null) return Response.json({ error: "not-found" }, { status: 404 });
  const { title, description } = referralCopy(name);
  return Response.json({ title, description }, { headers: { "Cache-Control": CARD_CACHE_CONTROL } });
}
