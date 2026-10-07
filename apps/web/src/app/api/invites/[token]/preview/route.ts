import { TripPreview } from "@tc/contracts";
import { readInvitePreview } from "@/server/invitePreview";

/**
 * `GET /api/invites/:token/preview` — the trip as a pending invite's holder may
 * see it before joining (M38 part 4, D4).
 *
 * **No session**, as the landing beside it: the token is the authority
 * (ADR-026), and the person holding it may not have an account yet.
 *
 * A refusal is a status and an EMPTY body — 404 for a token that never
 * existed, 410 for one revoked or already used — so a spent link carries
 * nothing at all. The parse is the other half of D4: `TripPreview` is
 * `.strict()` throughout, so a key it does not name fails here rather than
 * leaving.
 *
 * Not rate-limited, for the landing's reason: the token is 256 bits of entropy
 * (`mintToken`), so there is nothing to enumerate.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await readInvitePreview(token);
  if (!result.ok) return new Response(null, { status: result.reason === "not-found" ? 404 : 410 });
  return Response.json(TripPreview.parse(result.preview));
}
