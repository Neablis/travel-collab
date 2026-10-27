// **Who a `client_id` is**, against a real database and a fake network: every
// fetch here is a `vi.fn` or the real guarded fetcher refused at its own
// lookup, and every resolve is a fake. Nothing reaches DNS or a socket.
//
// The CIMD cases are amendment J by name: a metadata document is a stranger's
// URL the server fetches, so each one below is a way that fetch could reach
// inside, read too much, or be a different client than it claims.
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { oauthClients } from "@/server/db/schema";
import type { Fetcher } from "@/server/external/remoteImage/fetchImage";
import type { Resolve } from "@/server/external/remoteImage/guard";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { markClientUsed, registerClient, resolveClient, UNUSED_CLIENT_LIFETIME_MS } from "./clients";

const PUBLIC = "93.184.216.34";
const publicResolve: Resolve = async () => [{ address: PUBLIC, family: 4 }];

/** A CIMD URL no other test (or run) shares, since the table keeps one row per URL. */
const cimdUrl = (host = "app.example") => `https://${host}/oauth/${randomUUID()}.json`;

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

describe("a client metadata document", () => {
  it("is fetched, checked and stored, and names the document's host", async () => {
    const url = cimdUrl();
    const fetch = serving(documentFor(url));
    const resolved = await resolveClient(url, { fetch, resolve: publicResolve });
    expect(resolved).toEqual({
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

  it("updates its one row when fetched again, so grants keep one client id", async () => {
    const url = cimdUrl();
    const first = await resolveClient(url, { fetch: serving(documentFor(url)), resolve: publicResolve });
    const second = await resolveClient(url, {
      fetch: serving(documentFor(url, { client_name: "Renamed" })),
      resolve: publicResolve,
    });
    expect(first.ok && second.ok && second.client.id === first.client.id).toBe(true);
    expect(second.ok && second.client.clientName).toBe("Renamed");
  });

  it("is refused when its client_id differs from its URL", async () => {
    const url = cimdUrl();
    const resolved = await resolveClient(url, {
      fetch: serving(documentFor(url, { client_id: `${url}?other` })),
      resolve: publicResolve,
    });
    expect(resolved).toEqual({ ok: false, reason: "invalid-metadata-document", detail: expect.stringContaining("client_id") });
  });

  it("is refused when a redirect it lists would be refused at registration", async () => {
    const url = cimdUrl();
    const resolved = await resolveClient(url, {
      fetch: serving(documentFor(url, { redirect_uris: ["http://app.example/callback"] })),
      resolve: publicResolve,
    });
    expect(resolved.ok).toBe(false);
  });

  it("makes no second request for logo_uri or jwks_uri", async () => {
    const url = cimdUrl();
    const fetch = serving(
      documentFor(url, { logo_uri: "https://app.example/logo.png", jwks_uri: "https://app.example/jwks.json" }),
    );
    expect((await resolveClient(url, { fetch, resolve: publicResolve })).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("CIMD SSRF", () => {
  it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1"])(
    "refuses a host resolving to %s, before fetching anything",
    async (address) => {
      const fetch = serving({});
      const resolve: Resolve = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
      const resolved = await resolveClient(cimdUrl(), { fetch, resolve });
      expect(resolved).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "private-address" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

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
    const resolved = await resolveClient(cimdUrl("rebind.localhost"), { resolve: rebinding });
    expect(resolved).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "private-address" });
    expect(lookups).toBe(2);
  });

  it("refuses a 6 KB document", async () => {
    const url = cimdUrl();
    const padded = documentFor(url, { padding: "x".repeat(6 * 1024) });
    const resolved = await resolveClient(url, { fetch: serving(padded), resolve: publicResolve });
    expect(resolved).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "too-large" });
  });

  it("refuses a redirect to a private host, without following it", async () => {
    const fetch = serving("", { status: 302, headers: { location: "https://inside.example/client.json" } });
    const resolved = await resolveClient(cimdUrl(), { fetch, resolve: publicResolve });
    expect(resolved).toEqual({ ok: false, reason: "invalid-metadata-document", detail: "upstream-status" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a CIMD URL with a port, credentials or no path, without fetching", async () => {
    const fetch = serving({});
    for (const url of ["https://app.example:8443/c.json", "https://u:p@app.example/c.json", "https://app.example/"]) {
      expect(await resolveClient(url, { fetch, resolve: publicResolve })).toEqual({ ok: false, reason: "unknown-client" });
    }
    expect(fetch).not.toHaveBeenCalled();
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
