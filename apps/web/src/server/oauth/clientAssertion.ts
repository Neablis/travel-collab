import { createLocalJWKSet, jwtVerify, type JWK } from "jose";
import { clientAssertionJtiKey } from "@/server/cache/keys";
import type { CachePort } from "@/server/cache/redis";

// **A client assertion, as Poppy 4.1 reads RFC 7523** (`private_key_jwt`).
//
// `aud` is the issuer, as one string, compared character for character. Not
// the token endpoint: our metadata's endpoints are not checked by the agent
// (spec 10.4), so an assertion addressed to an endpoint could be one another
// company collected and replays here. ES256 is required and PS384 accepted
// (PS384 lets an agent have assertions signed blindly); nothing else.
//
// **Short means five minutes from `iat`**, and the `jti` is kept until the
// assertion would have expired anyway. The cache is best-effort (ADR-059), so
// a replay window opens only while it is down, and the assertion then still
// has to be unexpired and signed.

export const CLIENT_ASSERTION_ALGORITHMS = ["ES256", "PS384"] as const;
/** The longest an assertion may live, `iat` to `exp`. */
export const CLIENT_ASSERTION_MAX_LIFETIME_SECONDS = 300;
const CLOCK_TOLERANCE_SECONDS = 30;

export type AssertionOutcome = { ok: true } | { ok: false; reason: string };

const no = (reason: string): AssertionOutcome => ({ ok: false, reason });

/** Check `assertion` for `clientId` against its public `keys`, and remember its `jti`. */
export async function verifyClientAssertion(
  assertion: string,
  deps: { clientId: string; issuer: string; keys: JWK[]; now: Date; cache: CachePort },
): Promise<AssertionOutcome> {
  let payload;
  try {
    ({ payload } = await jwtVerify(assertion, createLocalJWKSet({ keys: deps.keys }), {
      algorithms: [...CLIENT_ASSERTION_ALGORITHMS],
      issuer: deps.clientId,
      subject: deps.clientId,
      currentDate: deps.now,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["iss", "sub", "aud", "exp", "iat", "jti"],
    }));
  } catch (error) {
    return no(error instanceof Error ? error.message : "invalid assertion");
  }
  // jose accepts an audience array holding the issuer; the spec asks for a single string.
  if (payload.aud !== deps.issuer) return no("aud must be the issuer, as a single string");
  const { iat, exp, jti } = payload as { iat: number; exp: number; jti: string };
  if (exp - iat > CLIENT_ASSERTION_MAX_LIFETIME_SECONDS) return no("the assertion lives too long");
  if (jti === "" || jti.length > 256) return no("jti is not usable");
  const key = clientAssertionJtiKey(deps.clientId, jti);
  if ((await deps.cache.get<true>(key)) !== null) return no("jti was already used");
  const ttl = Math.max(1, exp + CLOCK_TOLERANCE_SECONDS - Math.floor(deps.now.getTime() / 1000));
  await deps.cache.set(key, true, ttl);
  return { ok: true };
}
