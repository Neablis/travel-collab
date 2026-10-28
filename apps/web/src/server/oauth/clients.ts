import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { cimdDocumentKey } from "@/server/cache/keys";
import { getCache, type CachePort } from "@/server/cache/redis";
import { db } from "@/server/db/client";
import { oauthClients } from "@/server/db/schema";
import {
  beforeDeadline,
  guardedHttpsFetcher,
  readCapped,
  type Fetcher,
} from "@/server/external/remoteImage/fetchImage";
import { assertPublicAddress, RemoteImageRefused, resolveHost, type Resolve } from "@/server/external/remoteImage/guard";
import { consumeQuota, oauthCimdQuota } from "@/server/quota";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { checkRedirectUri } from "./redirects";

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
}

/**
 * How long a fetched metadata document is served without fetching or charging
 * again. Short, so a client that changes its redirects is read as it is now
 * within minutes; long enough that one popular client costs a fetch per five
 * minutes, whoever connects it.
 */
export const CIMD_CACHE_TTL_SECONDS = 300;

/** A cached metadata document: the fields we read of it, and when it was fetched (epoch ms). */
interface CachedDocument {
  document: unknown;
  fetchedAt: number;
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

/** A metadata document, as far as we read one. Anything else in it is ignored. */
const ClientMetadataDocument = z.object({
  client_id: z.string(),
  client_name: ClientName.optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  // No confidential clients here, so a document asking for one is not for us.
  token_endpoint_auth_method: z.literal("none").optional(),
});

function toClient(row: typeof oauthClients.$inferSelect): OAuthClient {
  return {
    id: row.id,
    clientId: row.kind === "cimd" ? row.cimdUrl! : row.id,
    kind: row.kind,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    cimdHost: row.cimdUrl === null ? null : new URL(row.cimdUrl).host,
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
  if (fresh) {
    body = cached.document;
  } else {
    if (deps.userId === undefined) return refused("no account to charge the fetch to");
    if (!(await consumeQuota(oauthCimdQuota(), deps.userId)).allowed) return { ok: false, reason: "too-many-lookups" };
    let text: string;
    try {
      text = await fetchDocument(parsed, deps);
    } catch (error) {
      return refused(error instanceof RemoteImageRefused ? error.reason : String(error));
    }
    try {
      body = JSON.parse(text);
    } catch {
      return refused("not JSON");
    }
  }
  // A cached document is checked as if it had just arrived: the cache is a
  // shared store, and a rule tightened since it was written still applies.
  const document = ClientMetadataDocument.safeParse(body);
  if (!document.success) return refused("not a client metadata document");
  // Exact, as a string: a document is only the client it says it is if it
  // lives at the id it claims.
  if (document.data.client_id !== url) return refused("client_id differs from the document's URL");
  const badRedirect = document.data.redirect_uris.find((uri) => !checkRedirectUri(uri).ok);
  if (badRedirect !== undefined) return refused(`redirect ${badRedirect} is not allowed`);
  // Only a document that passed, and only what was read of it, so a refused
  // URL is fetched (and charged) again rather than refused from the cache.
  if (!fresh) {
    await cache.set(cimdDocumentKey(url), { document: document.data, fetchedAt: now.getTime() }, CIMD_CACHE_TTL_SECONDS);
  }
  // `logo_uri` and `jwks_uri` are never read: the page shows no logo, and there
  // are no confidential clients to need keys.
  return {
    ok: true,
    client: {
      id: null,
      clientId: url,
      kind: "cimd",
      clientName: document.data.client_name ?? parsed.host,
      redirectUris: document.data.redirect_uris,
      cimdHost: parsed.host,
    },
  };
}

/**
 * The `oauth_clients` row a grant for `client` points at. A DCR client has one
 * already; a CIMD client's is written here, at Allow, and only here, so a
 * consent page nobody accepted leaves nothing behind. One row per document: a
 * later Allow updates it, so grants keep pointing at one id.
 */
export async function storeClient(client: OAuthClient, now: Date): Promise<string> {
  if (client.id !== null) return client.id;
  const values = { clientName: client.clientName, redirectUris: client.redirectUris };
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

async function fetchDocument(url: URL, deps: ClientDeps): Promise<string> {
  // Like every outside fetch, none while external data is offline (the e2e server).
  if (process.env.EXTERNAL_DATA_OFFLINE === "true") throw new RemoteImageRefused("offline");
  const resolve = deps.resolve ?? resolveHost;
  const fetch = deps.fetch ?? guardedHttpsFetcher(resolve);
  const signal = AbortSignal.timeout(deps.timeoutMs ?? CIMD_LIMITS.timeoutMs);
  // Refuses a private name before any socket exists; the fetcher's own lookup
  // then checks the address it really connects to. Inside the deadline: the
  // resolver takes no signal, and a nameserver that never answers would hold
  // the consent page for the system resolver's timeout instead.
  await beforeDeadline(assertPublicAddress(url.hostname, resolve), signal);
  const response = await fetch(url, {
    signal,
    redirect: "manual",
    headers: { accept: "application/json", "user-agent": "Caesura-OAuth/1" },
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    // A redirect included: following one is a second fetch of a URL nobody checked.
    throw new RemoteImageRefused("upstream-status", String(response.status));
  }
  return new TextDecoder().decode(await readCapped(response, CIMD_LIMITS.maxBytes));
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
