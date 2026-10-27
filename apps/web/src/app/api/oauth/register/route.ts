import { clientIp, scheduleSweep } from "@/server/og/limit";
import { registerClient } from "@/server/oauth/clients";
import { oauthError, oauthJson, preflight } from "@/server/oauth/errors";
import { consumeQuota, oauthRegisterQuota, registrationAddress, sweepExpiredCounters } from "@/server/quota";
import { keyedDigest } from "@/server/secrets/keyedDigest";

// **RFC 7591 dynamic client registration: `POST /api/oauth/register`.** Open
// to anyone (ADR-083 §6): MCP clients that predate client metadata documents
// only register, and Mitchell wants any website to be able to connect. The
// consent page is the defence; this bounds the rows a stranger can write.

/** Register a client (RFC 7591), once this address's hourly registrations allow it. */
export async function POST(request: Request) {
  const ip = clientIp(request);
  // Keyed, never the address itself: the counter table outlives any one request.
  const decision = await consumeQuota(oauthRegisterQuota(), keyedDigest(registrationAddress(ip)).digest);
  if (!decision.allowed) {
    const unavailable = decision.reason === "unavailable";
    const refusal = oauthError(
      unavailable ? "temporarily_unavailable" : "too_many_requests",
      unavailable ? "registration is unavailable; try again shortly" : "too many registrations from this address",
      unavailable ? 503 : 429,
    );
    refusal.headers.set("Retry-After", String(decision.retryAfterSeconds));
    return refusal;
  }
  // Only an allowed request may start a sweep (`og/limit.ts`'s rule).
  maybeSweep();
  const registered = await registerClient(await request.json().catch(() => null), ip);
  return registered.ok ? oauthJson(registered.body, 201) : oauthError(registered.error, registered.description);
}

export const OPTIONS = preflight;

// IP-keyed, so one row per address that ever registered, unbounded without
// the sweep `publicLibraryLimit.ts` runs for the same reason.
const SWEEP_PROBABILITY = 0.01;

function maybeSweep(): void {
  if (Math.random() < SWEEP_PROBABILITY) scheduleSweep(() => sweepExpiredCounters(oauthRegisterQuota()));
}
