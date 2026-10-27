// **Who a `client_id` is**, against a real database and a fake network: every
// fetch here is a `vi.fn` or the real guarded fetcher refused at its own
// lookup, and every resolve is a fake. Nothing reaches DNS or a socket.
//
// The CIMD cases are amendment J by name: a metadata document is a stranger's
// URL the server fetches, so each one below is a way that fetch could reach
// inside, read too much, be a different client than it claims, or be made
// without bound.
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { oauthClients } from "@/server/db/schema";
import type { Fetcher } from "@/server/external/remoteImage/fetchImage";
import type { Resolve } from "@/server/external/remoteImage/guard";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import {
  markClientUsed,
  registerClient,
  resolveClient,
  storeClient,
  storedClientRowId,
  UNUSED_CLIENT_LIFETIME_MS,
  type ClientDeps,
} from "./clients";

afterEach(() => vi.unstubAllEnvs());

const PUBLIC = "93.184.216.34";
const publicResolve: Resolve = async () => [{ address: PUBLIC, family: 4 }];

/** A CIMD URL no other test (or run) shares, since the table keeps one row per URL. */
const cimdUrl = (host = "app.example") => `https://${host}/oauth/${randomUUID()}.json`;

/** A resolve asked by an account no other test shares, so no test spends another's fetches. */
const asked = (over: ClientDeps = {}): ClientDeps => ({ resolve: publicResolve, userId: `cimd-${randomUUID()}`, ...over });

const documentFor = (url: string, over: Record<string, unknown> = {}) => ({
  client_id: url,
  client_name: "Some App",
  redirect_uris: ["https://app.example/callback"],
  ...over,
});

/** A fake fetcher answering one JSON body, recording each call. */
function serving(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn<Fetcher>(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init));
}

/** The client a resolve found, or a failure naming what came instead. */
async function resolved(url: string, deps: ClientDeps) {
  const outcome = await resolveClient(url, deps);
  if (!outcome.ok) throw new Error(`expected a client, got ${JSON.stringify(outcome)}`);
  return outcome.client;
}

describe("a client metadata document", () => {
  it("is fetched and checked, and names the document's host", async () => {
    const url = cimdUrl();
    const fetch = serving(documentFor(url));
    expect(await resolveClient(url, asked({ fetch }))).toEqual({
      ok: true,
      client: expect.objectContaining({
        clientId: url,
        kind: "cimd",
        clientName: "Some App",
        redirectUris: ["https://app.example/callback"],
        cimdHost: "app.example",
      }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // Looking at a consent page must cost the database nothing: otherwise anyone
  // signed in writes a row per URL they can serve a document at.
  it("writes no row until someone allows it", async () => {
    const url = cimdUrl();
    await resolved(url, asked({ fetch: serving(documentFor(url)) }));
    expect(await db.select().from(oauthClients).where(eq(oauthClients.cimdUrl, url))).toEqual([]);
  });

  it("is stored once on Allow, and a later Allow updates that one row, so grants keep one client id", async () => {
    const url = cimdUrl();
    const now = new Date();
    const first = await storeClient(await resolved(url, asked({ fetch: serving(documentFor(url)) })), now);
    const renamed = await resolved(url, asked({ fetch: serving(documentFor(url, { client_name: "Renamed" })) }));
    expect(await storeClient(renamed, now)).toBe(first);
    const rows = await db.select().from(oauthClients).where(eq(oauthClients.cimdUrl, url));
    expect(rows.map((row) => [row.id, row.clientName])).toEqual([[first, "Renamed"]]);
  });

  it("is refused when its client_id differs from its URL", async () => {
    const url = cimdUrl();
    expect(await resolveClient(url, asked({ fetch: serving(documentFor(url, { client_id: `${url}?other` })) }))).toEqual({
      ok: false,
      reason: "invalid-metadata-document",
      detail: expect.stringContaining("client_id"),
    });
  });

  it("is refused when a redirect it lists would be refused at registration", async () => {
    const url = cimdUrl();
    const fetch = serving(documentFor(url, { redirect_uris: ["http://app.example/callback"] }));
    expect((await resolveClient(url, asked({ fetch }))).ok).toBe(false);
  });

  it.each([
    ["a quote", 'Claude" (Recognised: Claude) "x'],
    ["a right-to-left override", "Notes‮exe.ppa"],
    ["a control character", "Notes\u0007"],
  ])("is refused when its client_name carries %s", async (_case, name) => {
    const url = cimdUrl();
    const fetch = serving(documentFor(url, { client_name: name }));
    expect(await resolveClient(url, asked({ fetch }))).toEqual(
      expect.objectContaining({ ok: false, reason: "invalid-metadata-document" }),
    );
  });

  it("makes no second request for logo_uri or jwks_uri", async () => {
    const url = cimdUrl();
    const fetch = serving(
      documentFor(url, { logo_uri: "https://app.example/logo.png", jwks_uri: "https://app.example/jwks.json" }),
    );
    expect((await resolveClient(url, asked({ fetch }))).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the bound on CIMD fetches", () => {
  it("charges the account asking before each fetch, and fetches nothing past its hourly limit", async () => {
    vi.stubEnv("OAUTH_CIMD_RATE_LIMIT_PER_USER_HOURLY", "2");
    const userId = `cimd-${randomUUID()}`;
    const fetch = vi.fn<Fetcher>(async (url) => new Response(JSON.stringify(documentFor(url.href))));
    expect((await resolveClient(cimdUrl(), asked({ fetch, userId }))).ok).toBe(true);
    expect((await resolveClient(cimdUrl(), asked({ fetch, userId }))).ok).toBe(true);
    expect(await resolveClient(cimdUrl(), asked({ fetch, userId }))).toEqual({ ok: false, reason: "too-many-lookups" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await resolveClient(cimdUrl(), asked({ fetch }))).ok).toBe(true);
  });

  it("fetches nothing for a resolve no account asked for", async () => {
    const fetch = serving({});
    expect((await resolveClient(cimdUrl(), { fetch, resolve: publicResolve })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("CIMD SSRF", () => {
  it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1"])(
    "refuses a host resolving to %s, before fetching anything",
    async (address) => {
      const fetch = serving({});
      const resolve: Resolve = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
      const outcome = await resolveClient(cimdUrl(), asked({ fetch, resolve }));
      expect(outcome).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "private-address" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  // A nameserver that never answers would otherwise hold the consent page for
  // the system resolver's own timeout, well past the 5 seconds amendment J sets.
  it("answers a timeout when the pre-flight resolve never settles, within the deadline", async () => {
    const fetch = serving({});
    const stalled: Resolve = () => new Promise(() => undefined);
    const outcome = await resolveClient(cimdUrl(), asked({ fetch, resolve: stalled, timeoutMs: 5 }));
    expect(outcome).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "timeout" });
    expect(fetch).not.toHaveBeenCalled();
  });

  // DNS rebinding: the pre-flight check sees a public answer, the socket's own
  // lookup a private one. Only the real guarded fetcher, which connects
  // through the guard's lookup, catches it. `*.localhost` is the one name the
  // network guard lets reach a socket, and the lookup refuses it first.
  it("refuses a host that answers public on the first lookup and private on the second (the pin)", async () => {
    let lookups = 0;
    const rebinding: Resolve = async () => {
      lookups += 1;
      return [{ address: lookups === 1 ? PUBLIC : "127.0.0.1", family: 4 }];
    };
    const outcome = await resolveClient(cimdUrl("rebind.localhost"), asked({ resolve: rebinding }));
    expect(outcome).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "private-address" });
    expect(lookups).toBe(2);
  });

  it("refuses a 6 KB document", async () => {
    const url = cimdUrl();
    const padded = documentFor(url, { padding: "x".repeat(6 * 1024) });
    expect(await resolveClient(url, asked({ fetch: serving(padded) }))).toEqual({
      ok: false,
      reason: "invalid-metadata-document",
      detail: "too-large",
    });
  });

  it("refuses a redirect to a private host, without following it", async () => {
    const fetch = serving("", { status: 302, headers: { location: "https://inside.example/client.json" } });
    const outcome = await resolveClient(cimdUrl(), asked({ fetch }));
    expect(outcome).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "upstream-status" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a CIMD URL with a port, credentials or no path, without fetching", async () => {
    const fetch = serving({});
    for (const url of ["https://app.example:8443/c.json", "https://u:p@app.example/c.json", "https://app.example/"]) {
      expect(await resolveClient(url, asked({ fetch }))).toEqual({ ok: false, reason: "unknown-client" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the row a token endpoint client_id names", () => {
  // A CIMD client's `client_id` is its URL; its row id is ours, not a name it
  // can present, as `resolveClient` already holds for authorize.
  it("is a CIMD client's row by its URL, and never by its row id", async () => {
    const url = cimdUrl();
    const rowId = await storeClient(await resolved(url, asked({ fetch: serving(documentFor(url)) })), new Date());
    expect(await storedClientRowId(url)).toBe(rowId);
    expect(await storedClientRowId(rowId)).toBeNull();
  });
});


describe("dynamic client registration", () => {
  const ip = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

  it("registers a client that resolves, keyed by a keyed digest of the IP, never a bare hash", async () => {
    const from = ip();
    const registered = await registerClient({ client_name: "Test", redirect_uris: ["https://example.com/cb"] }, from);
    expect(registered.ok).toBe(true);
    const clientId = registered.ok ? String(registered.body.client_id) : "";
    const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
    expect(row!.registeredIpHash).toBe(keyedDigest(from).digest);
    expect(row!.registeredIpHash).not.toBe(createHash("sha256").update(from).digest("hex"));
    expect(await resolveClient(clientId)).toEqual({
      ok: true,
      client: expect.objectContaining({ clientId, kind: "dcr", clientName: "Test", cimdHost: null }),
    });
  });

  it.each([
    ["http on a public host", "http://example.com/cb"],
    ["a fragment", "https://example.com/cb#x"],
    ["something that does not parse", "nope"],
  ])("refuses %s with invalid_redirect_uri", async (_case, uri) => {
    expect(await registerClient({ redirect_uris: [uri] }, ip())).toEqual(
      expect.objectContaining({ ok: false, error: "invalid_redirect_uri" }),
    );
  });

  // The consent page shows the name in quotes: one that closes them writes its
  // own words after, and a bidi override reorders what follows.
  it.each([
    ["a quote", 'Claude" (Recognised: Claude) "x'],
    ["a right-to-left override", "Notes‮exe.ppa"],
    ["a control character", "Notes\u0007"],
  ])("refuses a client_name carrying %s with invalid_client_metadata", async (_case, name) => {
    expect(await registerClient({ client_name: name, redirect_uris: ["https://example.com/cb"] }, ip())).toEqual(
      expect.objectContaining({ ok: false, error: "invalid_client_metadata" }),
    );
  });

  it("refuses a confidential client with invalid_client_metadata", async () => {
    expect(
      await registerClient(
        { redirect_uris: ["https://example.com/cb"], token_endpoint_auth_method: "client_secret_basic" },
        ip(),
      ),
    ).toEqual(expect.objectContaining({ ok: false, error: "invalid_client_metadata" }));
  });

  it("expires a client with no grant after 24 hours, and not one that has been used", async () => {
    const registeredAt = new Date("2026-10-27T00:00:00.000Z");
    const later = new Date(registeredAt.getTime() + UNUSED_CLIENT_LIFETIME_MS + 1);
    const unused = await registerClient({ redirect_uris: ["https://example.com/cb"] }, ip(), registeredAt);
    const used = await registerClient({ redirect_uris: ["https://example.com/cb"] }, ip(), registeredAt);
    const unusedId = unused.ok ? String(unused.body.client_id) : "";
    const usedId = used.ok ? String(used.body.client_id) : "";
    await markClientUsed(usedId, registeredAt);
    expect(await resolveClient(unusedId, { now: later })).toEqual({ ok: false, reason: "expired-client" });
    expect((await resolveClient(usedId, { now: later })).ok).toBe(true);
  });

  it("answers unknown for an id that names no client, or is not an id at all", async () => {
    expect(await resolveClient(randomUUID())).toEqual({ ok: false, reason: "unknown-client" });
    expect(await resolveClient("not-a-uuid")).toEqual({ ok: false, reason: "unknown-client" });
  });
});
