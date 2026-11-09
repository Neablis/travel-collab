import { createLocalJWKSet, errors, jwtVerify, type JWK, type JWTVerifyOptions } from "jose";
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
// has to be unexpired and signed. The claim is one `SET NX`, so two requests
// carrying one assertion at once cannot both pass.

export const CLIENT_ASSERTION_ALGORITHMS = ["ES256", "PS384"] as const;
/** The longest an assertion may live, `iat` to `exp`. */
export const CLIENT_ASSERTION_MAX_LIFETIME_SECONDS = 300;
const CLOCK_TOLERANCE_SECONDS = 30;

export type AssertionOutcome = { ok: true } | { ok: false; reason: string };

const no = (reason: string): AssertionOutcome => ({ ok: false, reason });

/** Check `assertion` for `clientId` against its public `keys`, and remember its `jti`. */
export async function verifyClientAssertion(
  assertion: string,
  deps: {
    clientId: string;
    issuer: string;
    keys: JWK[];
    now: Date;
    cache: CachePort;
    /** Called once when no key matches the assertion's `kid`, for a key set read again; undefined or `null` gives up. */
    refetchKeys?: () => Promise<JWK[] | null>;
  },
): Promise<AssertionOutcome> {
  const options: JWTVerifyOptions = {
    algorithms: [...CLIENT_ASSERTION_ALGORITHMS],
    issuer: deps.clientId,
    subject: deps.clientId,
    currentDate: deps.now,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
    // Also refuses an `iat` ahead of now: without it `exp - iat` alone would let a
    // far-future assertion stay valid for as long as it is dated ahead.
    maxTokenAge: CLIENT_ASSERTION_MAX_LIFETIME_SECONDS,
    requiredClaims: ["iss", "sub", "aud", "exp", "iat", "jti"],
  };
  const against = async (keys: JWK[]) => {
    try {
      return (await jwtVerify(assertion, createLocalJWKSet({ keys }), options)).payload;
    } catch (error) {
      // No `kid` and two keys of the type (a rotation in progress): RFC 7523 does not
      // require a `kid`, so each candidate is tried rather than refusing the agent.
      if (!(error instanceof errors.JWKSMultipleMatchingKeys)) throw error;
      let last: unknown = error;
      for await (const candidate of error) {
        try {
          return (await jwtVerify(assertion, candidate, options)).payload;
        } catch (inner) {
          last = inner;
        }
      }
      throw last;
    }
  };
  let payload;
  try {
    try {
      payload = await against(deps.keys);
    } catch (error) {
      // A key rotated in since the key set was cached: read it again, once.
      const fresh = error instanceof errors.JWKSNoMatchingKey ? await deps.refetchKeys?.() : null;
      if (fresh == null) throw error;
      payload = await against(fresh);
    }
  } catch (error) {
    return no(error instanceof Error ? error.message : "invalid assertion");
  }
  // jose accepts an audience array holding the issuer; the spec asks for a single string.
  if (payload.aud !== deps.issuer) return no("aud must be the issuer, as a single string");
  const { iat, exp, jti } = payload as { iat: number; exp: number; jti: string };
  if (exp - iat > CLIENT_ASSERTION_MAX_LIFETIME_SECONDS) return no("the assertion lives too long");
  if (jti === "" || jti.length > 256) return no("jti is not usable");
  const key = clientAssertionJtiKey(deps.clientId, jti);
  const ttl = Math.max(1, exp + CLOCK_TOLERANCE_SECONDS - Math.floor(deps.now.getTime() / 1000));
  if (!(await deps.cache.setIfAbsent(key, true, ttl))) return no("jti was already used");
  return { ok: true };
}
