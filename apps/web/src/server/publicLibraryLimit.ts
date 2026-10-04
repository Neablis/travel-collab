import { auth } from "./auth";
import { consumeQuota, publicLibraryQuota, quotaRefusal, sweepExpiredCounters } from "./quota";
import { clientIp, scheduleSweep } from "./og/limit";

// The rate limit on the public library's GETs when the caller has no account
// (ADR-061): Discover, the board, a profile, a day, its reviews and the place
// search. The same Postgres counter `og/limit.ts` charges link previews to,
// keyed the same way, by client IP — so `clientIp` and the sweep are borrowed
// from there rather than spelled twice.
//
// Only the anonymous path is charged. `publicLibraryReader` is the one call a
// route makes: it resolves the session and, with none, charges the IP.
//
// Unlike the `/api/og/**` routes these answers are not CDN-cached (they depend
// on who is asking), so every anonymous read reaches the counter. A refusal is
// still marked `no-store`, for `og/limit.ts`'s reason.

/**
 * Who is reading a public-library GET: the signed-in id, or `null` for a
 * reader with no account once their IP has been charged — or the refusal to
 * return instead.
 */
export async function publicLibraryReader(
  request: Request,
): Promise<{ refused: Response } | { readerId: string | null }> {
  const session = await auth();
  if (session?.user?.id) return { readerId: session.user.id };
  const refused = await limitPublicLibraryRead(request);
  return refused === null ? { readerId: null } : { refused };
}

/**
 * Charge this anonymous request to its IP. `null` means go ahead; otherwise
 * the 429 (or 503 when the counter is down, `consumeQuota`'s fail-closed rule)
 * to return.
 */
export async function limitPublicLibraryRead(
  request: Request,
  onAllowed: () => void = maybeSweep,
): Promise<Response | null> {
  const decision = await consumeQuota(publicLibraryQuota(), clientIp(request));
  if (decision.allowed) {
    // Only an allowed request may start a sweep — `og/limit.ts`'s rule: a
    // flood must not get a lever on DELETEs.
    onAllowed();
    return null;
  }
  const refusal = quotaRefusal(decision);
  refusal.headers.set("Cache-Control", "no-store");
  return refusal;
}

// IP-keyed, so this policy's rows are as unbounded as link previews' and need
// the same sweep. It shares `scheduleSweep`'s one-at-a-time flag with them, so
// a sweep skipped because theirs is in flight is simply left to a later request.
const SWEEP_PROBABILITY = 0.01;

function maybeSweep(): void {
  if (Math.random() < SWEEP_PROBABILITY) {
    scheduleSweep(() => sweepExpiredCounters(publicLibraryQuota()));
  }
}
