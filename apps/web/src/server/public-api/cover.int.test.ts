// **A trip's cover over the API** (M49 part 3, ADR-081 item 7), driven as
// real HTTP with a token: `PUT` from a URL, `GET`, `PATCH { position }` and
// `DELETE` on `/v1/trips/{tripId}/cover`. The guarded fetcher is the real one,
// given a fake `fetch` and a fake resolver, so no request here leaves the
// machine and the set-time check is the one the app would run.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { db } from "@/server/db/client";
import { tripCovers } from "@/server/db/schema";
import { grantMembership } from "@/server/access/members";
import type { Fetcher } from "@/server/external/remoteImage/fetchImage";
import type { Resolve } from "@/server/external/remoteImage/guard";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// The metadata service, which is what a private-address cover URL is after.
const INTERNAL_IP = "169.254.169.254";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_URL = "https://cdn.example.com/harbour.png";
const PAGE_URL = "https://cdn.example.com/page.html";
const PRIVATE_URL = "https://inside.example.com/latest/meta-data/";

vi.mock("@/server/external/remoteImage/fetchImage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/external/remoteImage/fetchImage")>();
  const resolve: Resolve = async (host) => [
    { address: host === "inside.example.com" ? INTERNAL_IP : "93.184.216.34", family: 4 },
  ];
  const fetch: Fetcher = async (url) => {
    if (url.href === IMAGE_URL) return new Response(PNG, { headers: { "content-type": "image/png" } });
    if (url.href === PAGE_URL) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    throw new Error(`unexpected fetch of ${url.href}`);
  };
  return {
    ...actual,
    fetchRemoteImage: (url: string, limits?: Parameters<typeof actual.fetchRemoteImage>[1]) =>
      actual.fetchRemoteImage(url, limits, { fetch, resolve }),
  };
});

const { POST: CREATE_TRIP } = await import("@/app/api/v1/trips/route");
const COVER = await import("@/app/api/v1/trips/[tripId]/cover/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

async function entitled(): Promise<string> {
  const id = `v1c-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M49 part 3 fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(
  owner: string,
  { scopes = ["trips:read", "trips:write"], tripIds = null }: { scopes?: ("trips:read" | "trips:write")[]; tripIds?: string[] | null } = {},
): Promise<string> {
  const minted = await mintToken(owner, { name: "cover", scopes, tripIds, expiresInDays: 30 });
  expect(minted.ok).toBe(true);
  return minted.ok ? minted.created.secret : "";
}

const req = (secret: string, method: string, body?: unknown) =>
  new Request("http://localhost/x", {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function newTrip(secret: string): Promise<string> {
  const res = await CREATE_TRIP(req(secret, "POST", { name: `Leith ${RUN}` }), NO_PARAMS);
  expect(res.status).toBe(201);
  return ((await res.json()) as TripDetail).tripId;
}

const rowsOf = (tripId: string) => db.select().from(tripCovers).where(eq(tripCovers.tripId, tripId));

let owner: string;
let secret: string;

beforeAll(async () => {
  owner = await entitled();
  secret = await tokenFor(owner);
});

describe("PUT /v1/trips/{tripId}/cover", () => {
  it("sets a cover from an image URL, and GET reads it back through our own origin", async () => {
    const tripId = await newTrip(secret);
    const body = { url: IMAGE_URL, alt: "The harbour at dusk", credit: { name: "Port of Leith" }, position: 30 };
    const put = await COVER.PUT(req(secret, "PUT", body), P(tripId));
    expect(put.status).toBe(200);

    const got = await COVER.GET(req(secret, "GET"), P(tripId));
    expect(got.status).toBe(200);
    const { cover } = await got.json();
    expect(cover).toMatchObject({
      source: "url",
      url: IMAGE_URL,
      alt: "The harbour at dusk",
      credit: { name: "Port of Leith", url: null },
      position: 30,
    });
    // What a browser loads is ours, never the image's host.
    expect(new URL(cover.proxySrc, "https://caesura.test").origin).toBe("https://caesura.test");
  });

  it.each([
    ["a URL that is not an image", PAGE_URL, "not-an-image"],
    ["a URL on a private address", PRIVATE_URL, "private-address"],
  ])("refuses %s as cover-url-rejected, saves nothing, and names no address", async (_what, url, reason) => {
    const tripId = await newTrip(secret);
    const res = await COVER.PUT(req(secret, "PUT", { url }), P(tripId));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: "cover-url-rejected", details: { reason } } });
    // The guard's own message carries the address the host resolved to; the
    // caller is told why, never what is inside our network.
    expect(text).not.toContain(INTERNAL_IP);
    expect(text).not.toContain("->");
    expect(await rowsOf(tripId)).toEqual([]);
  });
});

describe("PATCH and DELETE /v1/trips/{tripId}/cover", () => {
  it("moves the cover with { position } and leaves the image as it was", async () => {
    const tripId = await newTrip(secret);
    expect((await COVER.PUT(req(secret, "PUT", { url: IMAGE_URL }), P(tripId))).status).toBe(200);
    const res = await COVER.PATCH(req(secret, "PATCH", { position: 85 }), P(tripId));
    expect(res.status).toBe(200);
    expect((await res.json()).cover).toMatchObject({ source: "url", url: IMAGE_URL, position: 85 });
    expect((await (await COVER.GET(req(secret, "GET"), P(tripId))).json()).cover).toMatchObject({ position: 85 });
  });

  it("clears the cover", async () => {
    const tripId = await newTrip(secret);
    expect((await COVER.PUT(req(secret, "PUT", { url: IMAGE_URL }), P(tripId))).status).toBe(200);
    const res = await COVER.DELETE(req(secret, "DELETE"), P(tripId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cover: null });
    expect(await rowsOf(tripId)).toEqual([]);
  });
});

describe("who may set a cover", () => {
  it("refuses a token without trips:write, a viewer's token, and a token confined to another trip", async () => {
    const tripId = await newTrip(secret);
    const readOnly = await tokenFor(owner, { scopes: ["trips:read"] });
    const elsewhere = await tokenFor(owner, { tripIds: [await newTrip(secret)] });
    const viewer = await entitled();
    await grantMembership(db, { tripId, userId: viewer, role: "viewer", invitedBy: owner, now: new Date().toISOString() });
    const viewerToken = await tokenFor(viewer);

    for (const [token, code] of [
      [readOnly, "insufficient-scope"],
      [viewerToken, "forbidden"],
      [elsewhere, "trip-out-of-scope"],
    ] as const) {
      const res = await COVER.PUT(req(token, "PUT", { url: IMAGE_URL }), P(tripId));
      expect(res.status, code).toBe(403);
      expect((await res.json()).error.code).toBe(code);
    }
    // A viewer may still read it, as in the app.
    expect((await COVER.GET(req(viewerToken, "GET"), P(tripId))).status).toBe(200);
    expect(await rowsOf(tripId)).toEqual([]);
  });
});
