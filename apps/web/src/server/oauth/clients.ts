import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { oauthClients } from "@/server/db/schema";
import { guardedHttpsFetcher, type Fetcher } from "@/server/external/remoteImage/fetchImage";
import { assertPublicAddress, RemoteImageRefused, resolveHost, type Resolve } from "@/server/external/remoteImage/guard";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { checkRedirectUri } from "./redirects";

// **Who a `client_id` is** (ADR-083 §6, amendment E).
//
// An `https` `client_id` is a Client ID Metadata Document: the client publishes
// its name and redirects at that URL and we read them, so nobody registers
// anything. Anything else is the id of a row `/api/oauth/register` wrote (DCR,
// the fallback for clients that only register). Either way the result is an
// `oauth_clients` row, so a grant points at one kind of thing.

/** A client, as authorize and the consent page see it. */
export interface OAuthClient {
  /** The `oauth_clients` row id, which a grant stores. */
  id: string;
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
  | "invalid-metadata-document";

export type ResolvedClient = { ok: true; client: OAuthClient } | { ok: false; reason: ClientRefusal; detail?: string };

/** A DCR client that has not been used this long after registering is refused. */
export const UNUSED_CLIENT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Amendment J: a client metadata document is a few hundred bytes. The image
 * fetcher's 10 MB would let anyone make us read 10 MB per authorize.
 */
export const CIMD_LIMITS = { maxBytes: 5 * 1024, timeoutMs: 5_000 } as const;

/** Injected so no test reaches the network: the fetcher, and the resolver it and the pre-flight check use. */
export interface ClientDeps {
  fetch?: Fetcher;
  resolve?: Resolve;
  now?: Date;
}

const ROW_ID = z.uuid();

/** A metadata document, as far as we read one. Anything else in it is ignored. */
const ClientMetadataDocument = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(100).optional(),
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
  const where = clientId.startsWith("https://")
    ? eq(oauthClients.cimdUrl, clientId)
    : ROW_ID.safeParse(clientId).success
      ? eq(oauthClients.id, clientId)
      : null;
  if (where === null) return null;
  const [row] = await db.select({ id: oauthClients.id }).from(oauthClients).where(where);
  return row?.id ?? null;
}

const refused = (detail: string): ResolvedClient => ({ ok: false, reason: "invalid-metadata-document", detail });

/**
 * Fetch, check and store a client metadata document.
 *
 * **A stranger's URL, fetched by the server (amendment J).** Through ADR-081's
 * guarded fetcher, whose socket connects to the address the guard checked, so a
 * rebinding DNS answer cannot swap in a private address after the check. https
 * on the default port, no credentials in the URL, no redirect followed at all,
 * 5 KB and 5 seconds. Fetched on every authorize rather than cached, so a
 * client that changes its redirects is read as it is now.
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
  let text: string;
  try {
    text = await fetchDocument(parsed, deps);
  } catch (error) {
    return refused(error instanceof RemoteImageRefused ? error.reason : String(error));
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refused("not JSON");
  }
  const document = ClientMetadataDocument.safeParse(body);
  if (!document.success) return refused("not a client metadata document");
  // Exact, as a string: a document is only the client it says it is if it
  // lives at the id it claims.
  if (document.data.client_id !== url) return refused("client_id differs from the document's URL");
  const badRedirect = document.data.redirect_uris.find((uri) => !checkRedirectUri(uri).ok);
  if (badRedirect !== undefined) return refused(`redirect ${badRedirect} is not allowed`);
  // `logo_uri` and `jwks_uri` are never read: the page shows no logo, and there
  // are no confidential clients to need keys.
  const values = {
    clientName: document.data.client_name ?? parsed.host,
    redirectUris: document.data.redirect_uris,
  };
  const [row] = await db
    .insert(oauthClients)
    .values({
      id: randomUUID(),
      kind: "cimd",
      cimdUrl: url,
      registeredIpHash: null,
      createdAt: deps.now ?? new Date(),
      firstUsedAt: null,
      ...values,
    })
    // One row per document: a second fetch updates it, so grants keep pointing at one id.
    .onConflictDoUpdate({ target: oauthClients.cimdUrl, set: values })
    .returning();
  return { ok: true, client: toClient(row!) };
}

async function fetchDocument(url: URL, deps: ClientDeps): Promise<string> {
  // Like every outside fetch, none while external data is offline (the e2e server).
  if (process.env.EXTERNAL_DATA_OFFLINE === "true") throw new RemoteImageRefused("offline");
  const resolve = deps.resolve ?? resolveHost;
  const fetch = deps.fetch ?? guardedHttpsFetcher(resolve);
  const signal = AbortSignal.timeout(CIMD_LIMITS.timeoutMs);
  // Refuses a private name before any socket exists; the fetcher's own lookup
  // then checks the address it really connects to.
  await assertPublicAddress(url.hostname, resolve);
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
  return readCapped(response, CIMD_LIMITS.maxBytes);
}

/** The body as text, refused once it passes `maxBytes`, counted as it arrives. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RemoteImageRefused("too-large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** RFC 7591 registration, as `/api/oauth/register` reads it. Unknown fields are ignored. */
const RegistrationRequest = z.object({
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_name: z.string().trim().min(1).max(100).optional(),
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
