import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { calculateJwkThumbprint, compactVerify, createLocalJWKSet, decodeJwt, decodeProtectedHeader, importJWK, type JWK } from "jose";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { poppyDelegationKey } from "@/server/cache/keys";
import { getCache, type CachePort } from "@/server/cache/redis";
import { db } from "@/server/db/client";
import { oauthClients, oauthGrants, oauthTokens } from "@/server/db/schema";
import { fetchClientKeys, resolveClient, type ClientDeps } from "@/server/oauth/clients";
import { oauthIssuer } from "@/server/oauth/metadata";
import { signedOutFetchQuota } from "@/server/quota";
import { keyedDigestCandidates } from "@/server/secrets/keyedDigest";

// **The `Poppy-Session` header, verified** (Poppy 5.2 and 5.3, ADR-089 decision
// 8). A Session JWT is signed by a delegated key that a key in the agent's
// `jwks_uri` vouches for; this checks the chain in the spec's order, then the
// claims, then that the token it rides with was issued to the same client.
//
// Every refusal is one `invalid_session`, and the reason is for the log and the
// developer: it names the check, never a key. **A JWT never grants account
// access** (5.3): this answers who the agent and Session are, and the access
// token is still the actor's to verify.

export interface SessionClaims {
  clientId: string;
  sid: string;
  userId: string;
  agentId: string | null;
}

export type SessionOutcome = { ok: true; claims: SessionClaims } | { ok: false; reason: string };

export interface SessionDeps {
  now?: Date;
  /** The Company's identifier, which `aud` must equal; `oauthIssuer()` by default. */
  issuer?: string;
  /** What `htu` is compared against, with the request's path; `deploymentOrigin()` by default, never the request's Host. */
  origin?: string;
  cache?: CachePort;
  /** The public keys of the agent `clientId` names; its CIMD document and `jwks_uri`, guarded and cached, by default. */
  loadKeys?: (clientId: string) => Promise<{ ok: true; keys: JWK[] } | { ok: false; reason: string }>;
  /** Who the fetches for `loadKeys` are charged to when they are not cached. */
  chargeTo?: string;
  clientDeps?: ClientDeps;
  /** The protocol `client_id` an access token was issued to; its grant's client by default. */
  tokenClientId?: (token: string) => Promise<string | null>;
}

const ACCEPTANCE_WINDOW_SECONDS = 60;
const MAX_DELEGATION_SECONDS = 24 * 60 * 60;
const DELEGATION_ALGORITHMS = ["ES256", "PS384"];
/** Conversation IDs' alphabet and length (Poppy 8.2), which `sid` shares. */
const SID = /^[A-Za-z0-9_-]{1,256}$/;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k"];

const no = (reason: string): SessionOutcome => ({ ok: false, reason });

/** `ath` as RFC 9449 section 4.2 computes it. */
export function accessTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

interface VerifiedDelegation {
  /** The compact form, so a cached entry is only taken for the very JWT it was verified from. */
  jwt: string;
  jwk: JWK;
  exp: number;
}

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Verify the delegation (5.2 steps 1 and 2); the cache is consulted first and written once it passes. */
async function verifyDelegation(
  dlg: string,
  clientId: string,
  deps: Required<Pick<SessionDeps, "cache" | "loadKeys">> & { now: Date },
): Promise<{ ok: true; delegation: VerifiedDelegation } | { ok: false; reason: string }> {
  const nowSeconds = Math.floor(deps.now.getTime() / 1000);
  let claims;
  let header;
  try {
    claims = decodeJwt(dlg);
    header = decodeProtectedHeader(dlg);
  } catch {
    return { ok: false, reason: "delegation is not a JWT" };
  }
  const key = isString(claims.jti) ? poppyDelegationKey(clientId, claims.jti) : null;
  if (key !== null) {
    const cached = await deps.cache.get<VerifiedDelegation>(key);
    if (cached !== null && cached.jwt === dlg && cached.exp > nowSeconds) return { ok: true, delegation: cached };
  }

  // 1. The key in `jwks_uri` named by `kid` signed it.
  const keys = await deps.loadKeys(clientId);
  if (!keys.ok) return { ok: false, reason: keys.reason };
  try {
    await compactVerify(dlg, createLocalJWKSet({ keys: keys.keys }), { algorithms: DELEGATION_ALGORITHMS });
  } catch {
    return { ok: false, reason: "delegation signature is not from a key in jwks_uri" };
  }
  // 2. Its typ and iss, that it has not expired, and that it lives at most 24 hours.
  if (header.typ !== "poppy-delegation+jwt") return { ok: false, reason: "delegation typ must be poppy-delegation+jwt" };
  if (claims.iss !== clientId) return { ok: false, reason: "delegation iss is not the Session JWT's iss" };
  const { iat, exp } = claims;
  if (typeof iat !== "number" || typeof exp !== "number") return { ok: false, reason: "delegation needs iat and exp" };
  if (exp <= nowSeconds) return { ok: false, reason: "delegation expired" };
  if (exp - iat > MAX_DELEGATION_SECONDS) return { ok: false, reason: "delegation lifetime is over 24 hours" };
  const jwk = (claims.cnf as { jwk?: JWK } | undefined)?.jwk;
  if (jwk === undefined || typeof jwk !== "object" || PRIVATE_MEMBERS.some((member) => member in jwk)) {
    return { ok: false, reason: "delegation cnf.jwk must be a public key" };
  }
  const delegation = { jwt: dlg, jwk, exp };
  if (key !== null) await deps.cache.set(key, delegation, exp - nowSeconds);
  return { ok: true, delegation };
}

/**
 * Check the request's `Poppy-Session` header (5.3). `accessToken` is the
 * bearer it carries, if any: `ath` must match it, and it must have been issued
 * to the client the header names. Nothing here is the actor's job: whether the
 * token is live, and what it may do, is still decided where it was.
 */
export async function verifySessionHeader(
  request: Request,
  accessToken?: string,
  deps: SessionDeps = {},
): Promise<SessionOutcome> {
  const jwt = request.headers.get("poppy-session");
  if (jwt === null) return no("no Poppy-Session header");
  const now = deps.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);

  let header;
  let unverified;
  try {
    header = decodeProtectedHeader(jwt);
    unverified = decodeJwt(jwt);
  } catch {
    return no("the Session JWT is not a JWT");
  }
  const clientId = unverified.iss;
  if (!isString(clientId)) return no("iss is missing");
  if (!isString(header.poppy_dlg)) return no("the Session JWT carries no delegation (poppy_dlg)");

  const loadKeys = deps.loadKeys ?? ((id: string) => keysOf(id, deps));
  const verified = await verifyDelegation(header.poppy_dlg, clientId, { now, cache: deps.cache ?? getCache(), loadKeys });
  if (!verified.ok) return no(verified.reason);

  // 3. The delegated key signed the Session JWT, and its `kid` is that key's thumbprint.
  if (header.typ !== "poppy-session+jwt") return no("typ must be poppy-session+jwt");
  if (header.alg !== "ES256") return no("alg must be ES256");
  let payload;
  try {
    const key = await importJWK(verified.delegation.jwk, "ES256");
    const result = await compactVerify(jwt, key, { algorithms: ["ES256"] });
    payload = JSON.parse(new TextDecoder().decode(result.payload)) as Record<string, unknown>;
  } catch {
    return no("the Session JWT is not signed by its delegated key");
  }
  if (header.kid !== (await calculateJwkThumbprint(verified.delegation.jwk))) {
    return no("kid is not the delegated key's thumbprint");
  }

  // The claims (5.2, 5.3 step 2).
  if (payload.aud !== (deps.issuer ?? oauthIssuer())) return no("aud must be the issuer, as a single string");
  if (!isString(payload.sid) || !SID.test(payload.sid)) return no("sid is missing or not URL-safe");
  if (!isString(payload.sub) || payload.sub.length > 256) return no("sub is missing");
  if (payload.agent_id !== undefined && (!isString(payload.agent_id) || payload.agent_id.length > 256)) return no("agent_id is not usable");
  if (!isString(payload.jti)) return no("jti is missing");
  if (request.method !== payload.htm) return no("htm is not this request's method");
  // Compared as URLs (RFC 9449 4.3 names RFC 3986 normalisation: host case, a default port),
  // without the query or fragment, against the deployment's origin: the Host a proxy forwarded is not ours to trust.
  if (!isString(payload.htu) || !sameEndpoint(payload.htu, deps.origin ?? deploymentOrigin(), new URL(request.url).pathname)) {
    return no("htu is not this request's URL");
  }
  const iat = payload.iat;
  if (typeof iat !== "number" || Math.abs(nowSeconds - iat) > ACCEPTANCE_WINDOW_SECONDS) return no("iat is outside the one minute window");

  // 5.3 step 3: `ath` binds the JWT to the token, and without a token it is absent.
  if (accessToken === undefined) {
    if (payload.ath !== undefined) return no("ath is set but the request carries no access token");
  } else {
    if (payload.ath !== accessTokenHash(accessToken)) return no("ath is not the access token's hash");
    if (((await (deps.tokenClientId ?? issuedTo)(accessToken)) ?? null) !== clientId) {
      return no("the access token was issued to another client than iss");
    }
  }
  return { ok: true, claims: { clientId, sid: payload.sid, userId: payload.sub, agentId: payload.agent_id ?? null } };
}

/** Whether `htu` names `pathname` on `origin`; a value that does not parse names nothing. */
function sameEndpoint(htu: string, origin: string, pathname: string): boolean {
  try {
    const named = new URL(htu);
    return named.origin === new URL(origin).origin && named.pathname === pathname;
  } catch {
    return false;
  }
}

const issuedTo = async (token: string) => (await tokenHolder(token))?.clientId ?? null;

/** A Personal Agent's keys, by its document and `jwks_uri`; a client that is not one has none. */
async function keysOf(clientId: string, deps: SessionDeps): Promise<{ ok: true; keys: JWK[] } | { ok: false; reason: string }> {
  // Charged to the signed-out quota, never `oauthCimdQuota`: anyone can send this header, naming
  // any URL, and that must not use up the share `/oauth/authorize` draws on for real clients.
  const clientDeps = { userId: deps.chargeTo ?? "poppy-session", now: deps.now, quota: signedOutFetchQuota(), ...deps.clientDeps };
  const resolved = await resolveClient(clientId, clientDeps);
  if (!resolved.ok) return { ok: false, reason: `iss is not a usable client: ${resolved.reason}` };
  if (resolved.client.authMethod !== "private_key_jwt") return { ok: false, reason: "iss is not a Personal Agent" };
  const keys = await fetchClientKeys(resolved.client, clientDeps);
  return keys.ok ? keys : { ok: false, reason: `its keys could not be had: ${keys.detail}` };
}

/**
 * Who an OAuth access token was issued to: the `client_id` its grant was made
 * to (the document's URL for CIMD, the row's id for DCR) and the account that
 * consented. Read as the token is, by digest, and without judging whether it
 * is still live: that is `verifyAccessToken`'s, so nothing is recorded from it
 * before the actor has accepted the token.
 */
export async function tokenHolder(token: string): Promise<{ clientId: string; accountId: string } | null> {
  const digests = keyedDigestCandidates(token).map((candidate) => candidate.digest);
  const [row] = await db
    .select({ id: oauthClients.id, cimdUrl: oauthClients.cimdUrl, ownerId: oauthGrants.ownerId })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(inArray(oauthTokens.tokenHash, digests), eq(oauthTokens.kind, "access")));
  return row === undefined ? null : { clientId: row.cimdUrl ?? row.id, accountId: row.ownerId };
}
