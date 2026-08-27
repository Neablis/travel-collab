import { SharedTripView } from "@tc/contracts";
import { readShare } from "@/server/access/shares";

const STATUS: Record<string, number> = { "not-found": 404, gone: 410, forbidden: 403, invalid: 400 };

// The one endpoint in this app a stranger may call. No `auth()` — that is the
// feature, not an oversight (ADR-027): a share link handed to someone who has
// no account has to work, or it is not a share link.
//
// What it serves is `SharedTripView`, not `TripDetail`: no member ids, no
// conflicts, no status. The narrowing is done in the contract by explicit
// field list rather than by filtering here, so a new `TripDetail` field has to
// be opted in to the public surface rather than leaking into it.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await readShare(token);
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: STATUS[result.error.code] ?? 400 });
  }
  return Response.json({ trip: SharedTripView.parse(result.value) });
}
