import type { UpstreamError } from "@/server/external/unsplash";

// The answers the cover routes share, so the picker reads one vocabulary.

// When Unsplash said "not now" without saying until when.
const FALLBACK_RETRY_SECONDS = 600;

/** Covers are not set up on this deployment: no key, and not offline. The UI says so. */
export const coversUnavailable = () => Response.json({ error: "covers-unavailable" }, { status: 503 });

/** The trip is deleted: no cover is searched for, set or cleared on it. */
export const tripDeleted = () => Response.json({ error: "This trip has been deleted." }, { status: 400 });

/**
 * What a failed call to Unsplash answers. Its rate limit is "not now", so a
 * 429 with `Retry-After`, as our own quota's refusal is; anything else is the
 * vendor failing, a 502.
 */
export function upstreamFailure(error: UpstreamError, now: Date = new Date()): Response {
  if (error.status !== 429) return Response.json({ error: "covers-upstream" }, { status: 502 });
  const retryAfterSeconds = error.retryAfter
    ? Math.max(1, Math.ceil((error.retryAfter.getTime() - now.getTime()) / 1000))
    : FALLBACK_RETRY_SECONDS;
  return Response.json(
    { error: "covers-rate-limited", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
