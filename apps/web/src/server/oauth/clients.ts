import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { JWK } from "jose";
import { z } from "zod";
import { cimdDocumentKey, clientKeySetKey, fetchFailureKey } from "@/server/cache/keys";
import { getCache, type CachePort } from "@/server/cache/redis";
import { db } from "@/server/db/client";
import { oauthClientBlocks, oauthClients } from "@/server/db/schema";
import {
  beforeDeadline,
  guardedHttpsFetcher,
  readCapped,
  type Fetcher,
} from "@/server/external/remoteImage/fetchImage";
import { assertPublicAddress, RemoteImageRefused, resolveHost, type Resolve } from "@/server/external/remoteImage/guard";
import { consumeQuota, oauthCimdQuota, type QuotaPolicy } from "@/server/quota";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { checkRedirectUri, isLoopback } from "./redirects";

// **Who a `client_id` is** (ADR-083 §6, amendment E).
//
// An `https` `client_id` is a Client ID Metadata Document: the client publishes
// its name and redirects at that URL and we read them, so nobody registers
// anything. Anything else is the id of a row `/api/oauth/register` wrote (DCR,
// the fallback for clients that only register). Either way a grant points at
// an `oauth_clients` row, so it points at one kind of thing; a CIMD client's
// row is written only when someone allows it (`storeClient`), so looking at a
// consent page writes nothing.

/** A client, as authorize and the consent page see it. */
export interface OAuthClient {
  /** The `oauth_clients` row id, which a grant stores; `null` for a CIMD client until `storeClient`. */
  id: string | null;
  /** The protocol `client_id`: the row id for DCR, the document's URL for CIMD. */
  clientId: string;
  kind: "dcr" | "cimd";
  /** Self-declared; shown as a claim. */
  clientName: string;
  redirectUris: string[];
  /** The CIMD URL's host, which the consent page shows beside the redirect's (amendment G). */
  cimdHost: string | null;
  /** `private_key_jwt` for a Personal Agent (Poppy 4.1): the token endpoint then wants its client assertion. */
  authMethod: "none" | "private_key_jwt";
  /** Where its public keys are, on the document's own domain; set when `authMethod` is `private_key_jwt`. */
  jwksUri: string | null;
  /** On the document's own domain, so the consent page loads nothing from anywhere else. */
  logoUri: string | null;
}

export type ClientRefusal =
  /** No such client, or a `client_id` that could not name one. */
  | "unknown-client"
  /** A DCR client with no grant 24 hours after registering. */
  | "expired-client"
  /** A CIMD that could not be fetched, or was not a valid document. */
  | "invalid-metadata-document"
  /** A CIMD not fetched, because the account asking has fetched its hourly share (`oauthCimdQuota`). */
  | "too-many-lookups";

export type ResolvedClient = { ok: true; client: OAuthClient } | { ok: false; reason: ClientRefusal; detail?: string };

/** A DCR client that has not been used this long after registering is refused. */
export const UNUSED_CLIENT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Amendment J: a client metadata document is a few hundred bytes. The image
 * fetcher's 10 MB would let anyone make us read 10 MB per authorize.
 */
export const CIMD_LIMITS = { maxBytes: 5 * 1024, timeoutMs: 5_000 } as const;

/**
 * Who is asking, and what tests inject so none reaches the network: the
 * fetcher, the resolver it and the pre-flight check use, and the deadline.
 */
export interface ClientDeps {
  /** The account a metadata document's fetch is charged to. Without one, none is fetched. */
  userId?: string;
  fetch?: Fetcher;
  resolve?: Resolve;
  now?: Date;
  timeoutMs?: number;
  /** Where fetched metadata documents are kept for `CIMD_CACHE_TTL_SECONDS`; the shared cache by default. */
  cache?: CachePort;
  /** The fetch quota to charge, `oauthCimdQuota()` by default: a caller with no account is charged to a smaller one of its own. */
  quota?: QuotaPolicy[];
  /**
   * Read what the cache holds past `CIMD_CACHE_TTL_SECONDS`, up to
   * `CIMD_LAST_KNOWN_TTL_SECONDS`, when the host cannot be reached (a transport
   * failure, a timeout or a 5xx): for a Personal Agent already known, whose last
   * good key set is better evidence than nothing. **Never when the host
   * answered**: a 404, a 410 or a set without the key is the agent taking it
   * away, and a spent quota is not an answer at all, so neither lets a removed
   * key through. Only the token endpoint and Session verification ask;
   * authorize never does, so a changed document is read as it is now.
   */
  staleOk?: boolean;
}

/**
 * How long a fetched metadata document is served without fetching or charging
 * again. Short, so a client that changes its redirects is read as it is now
 * within minutes; long enough that one popular client costs a fetch per five
 * minutes, whoever connects it.
 */
export const CIMD_CACHE_TTL_SECONDS = 300;

/**
 * How long a Personal Agent's document and key set are kept past the point they
 * are served as fresh, for `ClientDeps.staleOk`: the longest a host that is down
 * can keep a key it has since removed working. Only a `private_key_jwt` client's
 * copies live this long; a public client's keep `CIMD_CACHE_TTL_SECONDS`.
 * Freshness is judged by `fetchedAt`, so keeping it longer changes nothing for
 * anyone else.
 */
export const CIMD_LAST_KNOWN_TTL_SECONDS = 24 * 60 * 60;

/** A cached metadata document: the fields we read of it, and when it was fetched (epoch ms). */
interface CachedDocument {
  document: unknown;
  fetchedAt: number;
}

/** A fetch that got an answer, with its status: `RemoteImageRefused` alone does not keep it. */
class UpstreamStatus extends RemoteImageRefused {
  readonly status: number;
  constructor(status: number) {
    super("upstream-status", String(status));
    this.status = status;
  }
}

/**
 * A resolver that failed to answer, with whether that says anything about the
 * host: a name that does not exist (`ENOTFOUND`, `ENODATA`) is the agent's
 * domain being gone, and stands; anything else (`EAI_AGAIN`, a SERVFAIL, a
 * resolver that refuses) is our own lookup failing, like a timeout.
 */
class ResolverFailure extends RemoteImageRefused {
  readonly transient: boolean;
  constructor(error: unknown) {
    super("unresolvable", error instanceof Error ? error.message : undefined);
    this.transient = !["ENOTFOUND", "ENODATA"].includes((error as { code?: string } | null)?.code ?? "");
  }
}

/**
 * Whether a failed fetch says the host could not be reached (a timeout, a
 * connection that failed, a 5xx, a resolver that failed) rather than answered.
 * A 404, a 410, another status or a body that is not what was asked for is the
 * host answering, and what it says stands.
 */
function isHostDown(error: unknown): boolean {
  if (error instanceof UpstreamStatus) return error.status >= 500;
  if (error instanceof ResolverFailure) return error.transient;
  if (error instanceof RemoteImageRefused) return error.reason === "timeout";
  return !(error instanceof SyntaxError);
}

/**
 * The cached copy a host that is down may fall back to: only for `staleOk`
 * callers, and only while the copy is under `CIMD_LAST_KNOWN_TTL_SECONDS` old.
 */
function lastKnownOf(cached: CachedDocument | null, deps: ClientDeps, now: Date): unknown {
  if (deps.staleOk !== true || cached === null) return undefined;
  return now.getTime() - cached.fetchedAt < CIMD_LAST_KNOWN_TTL_SECONDS * 1000 ? cached.document : undefined;
}

/**
 * How long a failed fetch of one URL is remembered. Without it a known agent
 * whose host fails costs a quota unit and up to five seconds on every request,
 * so a busy agent spends its caller's ceiling within the hour and a stranger
 * can spend the global one by asking for it repeatedly. With it each URL costs
 * at most one unit a minute, whatever the traffic.
 */
export const FETCH_FAILURE_SECONDS = 60;

/** A failed fetch as remembered: what to say, and whether the last-known copy may stand in for it. */
interface FetchFailure {
  hostDown: boolean;
  reason: string;
  at: number;
}

/**
 * The failure remembered for `url`, if one is under a minute old. Only for
 * `staleOk` callers, who only ever ask about a client someone has allowed;
 * authorize reads a document as it is now, and charges the account that asks.
 */
async function rememberedFailure(cache: CachePort, url: string, deps: ClientDeps, now: Date): Promise<FetchFailure | null> {
  if (deps.staleOk !== true) return null;
  const failure = await cache.get<FetchFailure>(fetchFailureKey(url));
  return failure !== null && now.getTime() - failure.at < FETCH_FAILURE_SECONDS * 1000 ? failure : null;
}

async function rememberFailure(cache: CachePort, url: string, deps: ClientDeps, now: Date, failure: Omit<FetchFailure, "at">): Promise<FetchFailure> {
  const kept = { ...failure, at: now.getTime() };
  if (deps.staleOk === true) await cache.set(fetchFailureKey(url), kept, FETCH_FAILURE_SECONDS);
  return kept;
}

const ROW_ID = z.uuid();

/**
 * The consent page shows a name inside quotes, as the app's own claim. A quote
 * would let a name close them and write its own words after ("Claude"
 * (Recognised: Claude)), and a control or bidi character would hide or reorder
 * what follows, so neither may be in one.
 */
const ClientName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((name) => !/["\p{Cc}\p{Cf}]/u.test(name), "client_name may not contain quotes or control characters");

/** An https URL on `clientId`'s domain (or a subdomain of it), no credentials, no port (Poppy 4.1; ADR-081's port rule). */
function onClientsDomain(clientId: string, value: string): boolean {
  try {
    const url = new URL(value);
    const home = new URL(clientId).hostname;
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      (url.hostname === home || url.hostname.endsWith(`.${home}`))
    );
  } catch {
    return false;
  }
}

/**
 * A metadata document, as far as we read one. Anything else in it is ignored.
 * `private_key_jwt` is the one confidential method, and only with a key set on
 * the document's own domain: a document naming someone else's keys would let
 * its author borrow another client's identity.
 */
const ClientMetadataDocument = z
  .object({
    client_id: z.string(),
    client_name: ClientName.optional(),
    redirect_uris: z.array(z.string()).min(1).max(10),
    token_endpoint_auth_method: z.enum(["none", "private_key_jwt"]).optional(),
    jwks_uri: z.string().optional(),
    logo_uri: z.string().optional(),
  })
  .superRefine((doc, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (doc.token_endpoint_auth_method === "private_key_jwt" && doc.jwks_uri === undefined) {
      bad("jwks_uri", "private_key_jwt needs a jwks_uri");
    }
    // Only a Personal Agent is held to its own domain: a public client's
    // `jwks_uri` and `logo_uri` were never read, and a CDN logo is ordinary.
    if (doc.token_endpoint_auth_method !== "private_key_jwt") return;
    if (doc.jwks_uri !== undefined && !onClientsDomain(doc.client_id, doc.jwks_uri)) {
      bad("jwks_uri", "jwks_uri must be an https URL on the client_id's domain");
    }
    // Poppy 4.1: each redirect is on the client_id's domain, or a loopback redirect.
    const stray = doc.redirect_uris.find((uri) => !onClientsDomain(doc.client_id, uri) && !isLoopback(uri));
    if (stray !== undefined) bad("redirect_uris", `redirect ${stray} must be on the client_id's domain or a loopback redirect`);
  });

function toClient(row: typeof oauthClients.$inferSelect): OAuthClient {
  return {
    id: row.id,
    clientId: row.kind === "cimd" ? row.cimdUrl! : row.id,
    kind: row.kind,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    cimdHost: row.cimdUrl === null ? null : new URL(row.cimdUrl).host,
    authMethod: "none",
    jwksUri: null,
    logoUri: null,
  };
}

/** The client a protocol `client_id` names, fetching its metadata document when it is a URL. */
export async function resolveClient(clientId: string, deps: ClientDeps = {}): Promise<ResolvedClient> {
  const now = deps.now ?? new Date();
  if (clientId.startsWith("https://")) return resolveMetadataDocument(clientId, deps);
  if (!ROW_ID.safeParse(clientId).success) return { ok: false, reason: "unknown-client" };
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(and(eq(oauthClients.id, clientId), eq(oauthClients.kind, "dcr")));
  if (row === undefined) return { ok: false, reason: "unknown-client" };
  // Expired on read, never deleted: an unused registration is debris, and
  // refusing it is what keeps open registration from being a free store.
  if (row.firstUsedAt === null && now.getTime() - row.createdAt.getTime() > UNUSED_CLIENT_LIFETIME_MS) {
    return { ok: false, reason: "expired-client" };
  }
  return { ok: true, client: toClient(row) };
}

/**
 * The row a `client_id` names without fetching anything: what the token
 * endpoint uses to check a code was issued to the client presenting it.
 */
export async function storedClientRowId(clientId: string): Promise<string | null> {
  // A uuid names a DCR client only, as in `resolveClient`: a CIMD client's
  // `client_id` is its URL, never its row id.
  const where = clientId.startsWith("https://")
    ? eq(oauthClients.cimdUrl, clientId)
    : ROW_ID.safeParse(clientId).success
      ? and(eq(oauthClients.id, clientId), eq(oauthClients.kind, "dcr"))
      : null;
  if (where === null) return null;
  const [row] = await db.select({ id: oauthClients.id }).from(oauthClients).where(where);
  return row?.id ?? null;
}

/**
 * Whether the operator cut this protocol `client_id` off (ADR-089 decision 3).
 * Read on every use and never cached, so a block takes effect on the next request.
 */
export async function clientIsBlocked(clientId: string): Promise<boolean> {
  const [row] = await db.select({ clientId: oauthClientBlocks.clientId }).from(oauthClientBlocks).where(eq(oauthClientBlocks.clientId, clientId));
  return row !== undefined;
}

const refused = (detail: string): ResolvedClient => ({ ok: false, reason: "invalid-metadata-document", detail });

/**
 * Fetch and check a client metadata document. Stores nothing: the row is
 * written by `storeClient`, once someone allows the client.
 *
 * **A stranger's URL, fetched by the server (amendment J).** Charged to the
 * account asking before anything is fetched (`oauthCimdQuota`), so no one can
 * make the server fetch without bound. Through ADR-081's guarded fetcher, whose
 * socket connects to the address the guard checked, so a rebinding DNS answer
 * cannot swap in a private address after the check. https on the default port,
 * no credentials in the URL, no redirect followed at all, 5 KB and 5 seconds,
 * the DNS pre-flight included.
 *
 * A document that passed is kept in the shared cache (ADR-059) for
 * `CIMD_CACHE_TTL_SECONDS`, and a hit is neither fetched nor charged, so
 * accounts spending their shares on throwaway URLs cannot use up the global
 * ceiling for a client people are connecting. A hit is checked like a fetch.
 * The cache fails open: unavailable, every authorize fetches and is charged.
 */
async function resolveMetadataDocument(url: string, deps: ClientDeps): Promise<ResolvedClient> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "unknown-client" };
  }
  // The CIMD draft's shape: a path, no fragment, no credentials. The port rule is ADR-081's.
  if (parsed.pathname === "/" || url.includes("#") || parsed.username !== "" || parsed.password !== "" || parsed.port !== "") {
    return { ok: false, reason: "unknown-client" };
  }
  const now = deps.now ?? new Date();
  const cache = deps.cache ?? getCache();
  const cached = await cache.get<CachedDocument>(cimdDocumentKey(url));
  const fresh = cached !== null && now.getTime() - cached.fetchedAt < CIMD_CACHE_TTL_SECONDS * 1000;
  let body: unknown;
  // Served from the cache, fresh or (the host down, `staleOk`) the last known copy: not written back.
  let reused = fresh;
  if (fresh) {
    body = cached.document;
  } else {
    let failure = await rememberedFailure(cache, cimdDocumentKey(url), deps, now);
    if (failure === null) {
      if (deps.userId === undefined) return refused("no account to charge the fetch to");
      if (!(await consumeQuota(deps.quota ?? oauthCimdQuota(), deps.userId)).allowed) return { ok: false, reason: "too-many-lookups" };
      try {
        body = JSON.parse(await fetchDocument(parsed, deps));
      } catch (error) {
        const reason = error instanceof SyntaxError ? "not JSON" : error instanceof RemoteImageRefused ? error.reason : String(error);
        failure = await rememberFailure(cache, cimdDocumentKey(url), deps, now, { hostDown: isHostDown(error), reason });
      }
    }
    if (failure !== null) {
      const lastKnown = failure.hostDown ? lastKnownOf(cached, deps, now) : undefined;
      if (lastKnown === undefined) return refused(failure.reason);
      body = lastKnown;
      reused = true;
    }
  }
  // A body that arrived and is not a client is the host answering, so it is remembered like a 404.
  const refuse = async (reason: string) => {
    if (!reused) await rememberFailure(cache, cimdDocumentKey(url), deps, now, { hostDown: false, reason });
    return refused(reason);
  };
  // A cached document is checked as if it had just arrived: the cache is a
  // shared store, and a rule tightened since it was written still applies.
  const document = ClientMetadataDocument.safeParse(body);
  if (!document.success) return refuse("not a client metadata document");
  // Exact, as a string: a document is only the client it says it is if it
  // lives at the id it claims.
  if (document.data.client_id !== url) return refuse("client_id differs from the document's URL");
  const badRedirect = document.data.redirect_uris.find((uri) => !checkRedirectUri(uri).ok);
  if (badRedirect !== undefined) return refuse(`redirect ${badRedirect} is not allowed`);
  // Only a document that passed, and only what was read of it, so a refused
  // URL is fetched (and charged) again rather than refused from the cache.
  const confidential = document.data.token_endpoint_auth_method === "private_key_jwt";
  if (!reused) {
    const keptSeconds = confidential ? CIMD_LAST_KNOWN_TTL_SECONDS : CIMD_CACHE_TTL_SECONDS;
    await cache.set(cimdDocumentKey(url), { document: document.data, fetchedAt: now.getTime() }, keptSeconds);
  }
  return {
    ok: true,
    client: {
      id: null,
      clientId: url,
      kind: "cimd",
      clientName: document.data.client_name ?? parsed.host,
      redirectUris: document.data.redirect_uris,
      cimdHost: parsed.host,
      authMethod: confidential ? "private_key_jwt" : "none",
      jwksUri: confidential ? document.data.jwks_uri! : null,
      // Only a Personal Agent's, and only on its own domain: the consent page loads it.
      logoUri: confidential && onClientsDomain(url, document.data.logo_uri ?? "") ? document.data.logo_uri! : null,
    },
  };
}

/** The public keys of a Personal Agent's `jwks_uri`: a bounded list, never a private member. */
const KeySet = z.object({
  keys: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(10)
    .refine((keys) => keys.every((key) => !["d", "p", "q", "dp", "dq", "qi", "k"].some((member) => member in key)), "a key set holds public keys only"),
});

/** A key set is a few small keys; more than this is not one. */
const KEY_SET_MAX_BYTES = 16 * 1024;

export type KeySetOutcome = { ok: true; keys: JWK[] } | { ok: false; detail: string };

/** The youngest a cached key set may be and still be read again for an unknown `kid`. */
const KEY_SET_REFETCH_SECONDS = 60;

/**
 * The keys a `private_key_jwt` client signs with, fetched from its `jwks_uri`
 * the way its document was: charged to `deps.userId`, through the guarded
 * fetcher, cached for `CIMD_CACHE_TTL_SECONDS`. Never `createRemoteJWKSet`,
 * whose own fetch would bypass the address guard and the quota.
 */
export async function fetchClientKeys(
  client: OAuthClient,
  deps: ClientDeps = {},
  /** `again` is a key set asked for because no key matched: a copy younger than a minute is kept, so that is one fetch a minute at most. */
  opts: { again?: boolean } = {},
): Promise<KeySetOutcome> {
  if (client.jwksUri === null) return { ok: false, detail: "the client has no jwks_uri" };
  const url = new URL(client.jwksUri);
  const now = deps.now ?? new Date();
  const cache = deps.cache ?? getCache();
  const key = clientKeySetKey(client.jwksUri);
  const failedKey = fetchFailureKey(client.jwksUri);
  const cached = await cache.get<CachedDocument>(key);
  const maxAgeSeconds = opts.again === true ? KEY_SET_REFETCH_SECONDS : CIMD_CACHE_TTL_SECONDS;
  const fresh = cached !== null && now.getTime() - cached.fetchedAt < maxAgeSeconds * 1000;
  let body: unknown;
  let reused = fresh;
  if (fresh) {
    body = cached.document;
  } else {
    let failure = await rememberedFailure(cache, failedKey, deps, now);
    if (failure === null) {
      if (deps.userId === undefined) return { ok: false, detail: "no account to charge the fetch to" };
      if (!(await consumeQuota(deps.quota ?? oauthCimdQuota(), deps.userId)).allowed) return { ok: false, detail: "too many lookups" };
      try {
        body = JSON.parse(await fetchDocument(url, deps, KEY_SET_MAX_BYTES));
      } catch (error) {
        const reason = error instanceof RemoteImageRefused ? error.reason : "not a key set";
        failure = await rememberFailure(cache, failedKey, deps, now, { hostDown: isHostDown(error), reason });
      }
    }
    if (failure !== null) {
      // Not for a key set asked for again, which exists to find a key the copy lacks.
      const lastKnown = failure.hostDown && opts.again !== true ? lastKnownOf(cached, deps, now) : undefined;
      if (lastKnown === undefined) return { ok: false, detail: failure.reason };
      body = lastKnown;
      reused = true;
    }
  }
  const keySet = KeySet.safeParse(body);
  if (!keySet.success) {
    const detail = keySet.error.issues[0]?.message ?? "not a key set";
    if (!reused) await rememberFailure(cache, failedKey, deps, now, { hostDown: false, reason: detail });
    return { ok: false, detail };
  }
  if (!reused) await cache.set(key, { document: keySet.data, fetchedAt: now.getTime() }, CIMD_LAST_KNOWN_TTL_SECONDS);
  return { ok: true, keys: keySet.data.keys as JWK[] };
}

/**
 * The `oauth_clients` row a grant for `client` points at. A DCR client has one
 * already; a CIMD client's is written here, at Allow, and only here, so a
 * consent page nobody accepted leaves nothing behind. One row per document: a
 * later Allow updates it, so grants keep pointing at one id.
 */
export async function storeClient(client: OAuthClient, now: Date): Promise<string> {
  if (client.id !== null) return client.id;
  // What a later Allow may change: the row is one per document, so a document
  // that changed its name, redirects or logo is read as it is now. Its auth method is
  // not here: that is the grant's, as of the Allow.
  const values = {
    clientName: client.clientName,
    redirectUris: client.redirectUris,
    logoUri: client.logoUri,
  };
  const [row] = await db
    .insert(oauthClients)
    .values({
      id: randomUUID(),
      kind: "cimd",
      cimdUrl: client.clientId,
      registeredIpHash: null,
      createdAt: now,
      firstUsedAt: null,
      ...values,
    })
    .onConflictDoUpdate({ target: oauthClients.cimdUrl, set: values })
    .returning({ id: oauthClients.id });
  return row!.id;
}

async function fetchDocument(url: URL, deps: ClientDeps, maxBytes: number = CIMD_LIMITS.maxBytes): Promise<string> {
  // Like every outside fetch, none while external data is offline (the e2e server).
  if (process.env.EXTERNAL_DATA_OFFLINE === "true") throw new RemoteImageRefused("offline");
  const resolve = deps.resolve ?? resolveHost;
  const fetch = deps.fetch ?? guardedHttpsFetcher(resolve);
  // `assertPublicAddress` keeps only the message of a resolver's error; this keeps its code.
  let resolverError: unknown;
  const noted: Resolve = (host) =>
    resolve(host).catch((error: unknown) => {
      resolverError = error;
      throw error;
    });
  const signal = AbortSignal.timeout(deps.timeoutMs ?? CIMD_LIMITS.timeoutMs);
  // Refuses a private name before any socket exists; the fetcher's own lookup
  // then checks the address it really connects to. Inside the deadline: the
  // resolver takes no signal, and a nameserver that never answers would hold
  // the consent page for the system resolver's timeout instead.
  try {
    await beforeDeadline(assertPublicAddress(url.hostname, noted), signal);
  } catch (error) {
    throw resolverError !== undefined && error instanceof RemoteImageRefused && error.reason === "unresolvable" ? new ResolverFailure(resolverError) : error;
  }
  const response = await fetch(url, {
    signal,
    redirect: "manual",
    headers: { accept: "application/json", "user-agent": "Caesura-OAuth/1" },
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    // A redirect included: following one is a second fetch of a URL nobody checked.
    throw new UpstreamStatus(response.status);
  }
  return new TextDecoder().decode(await readCapped(response, maxBytes));
}

/** RFC 7591 registration, as `/api/oauth/register` reads it. Unknown fields are ignored. */
const RegistrationRequest = z.object({
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_name: ClientName.optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
});

export type Registration =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

/**
 * Register a DCR client (RFC 7591) and answer its client information.
 *
 * Open to anyone (Mitchell, D7): the consent page, not this, is the defence.
 * The caller has already charged the IP's registration quota.
 */
export async function registerClient(body: unknown, ip: string, now: Date = new Date()): Promise<Registration> {
  const request = RegistrationRequest.safeParse(body);
  if (!request.success) {
    const redirects = request.error.issues.some((issue) => issue.path[0] === "redirect_uris");
    return redirects
      ? { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must list 1 to 10 URIs" }
      : { ok: false, error: "invalid_client_metadata", description: request.error.issues[0]?.message ?? "invalid" };
  }
  for (const uri of request.data.redirect_uris) {
    const check = checkRedirectUri(uri);
    if (!check.ok) return { ok: false, error: "invalid_redirect_uri", description: `${uri} ${check.why}` };
  }
  const id = randomUUID();
  const clientName = request.data.client_name ?? "Unnamed app";
  await db.insert(oauthClients).values({
    id,
    clientName,
    redirectUris: request.data.redirect_uris,
    kind: "dcr",
    cimdUrl: null,
    registeredIpHash: keyedDigest(ip).digest,
    createdAt: now,
    firstUsedAt: null,
  });
  return {
    ok: true,
    body: {
      client_id: id,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: clientName,
      redirect_uris: request.data.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

/** A client's first grant: from now on it no longer expires unused. */
export async function markClientUsed(rowId: string, now: Date): Promise<void> {
  await db
    .update(oauthClients)
    .set({ firstUsedAt: now })
    .where(and(eq(oauthClients.id, rowId), isNull(oauthClients.firstUsedAt)));
}
