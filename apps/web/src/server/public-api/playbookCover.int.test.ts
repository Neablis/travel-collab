// **A playbook's cover over the API** (Mitchell, 2026-10-26), driven as
// real HTTP with a token: `PUT` from a URL, `GET`, `PATCH { position }` and
// `DELETE` on `/v1/playbooks/{playbookId}/cover`. The guarded fetcher is the
// real one, given a fake `fetch` and a fake resolver, so no request here
// leaves the machine and the set-time check is the one the app would run.
// Ownership, not trip roles, is the gate: a Playbook has no members list.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { db } from "@/server/db/client";
import { savedDayCovers } from "@/server/db/schema";
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

const { POST: CREATE_PLAYBOOK } = await import("@/app/api/v1/playbooks/route");
const PLAYBOOK = await import("@/app/api/v1/playbooks/[playbookId]/route");
const COVER = await import("@/app/api/v1/playbooks/[playbookId]/cover/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (playbookId: string) => ({ params: Promise.resolve({ playbookId }) });

async function entitled(): Promise<string> {
  const id = `v1p-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "Playbook cover fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(
  owner: string,
  { scopes = ["library:read", "library:write"] }: { scopes?: ("library:read" | "library:write")[] } = {},
): Promise<string> {
  const minted = await mintToken(owner, { name: "playbook-cover", scopes, tripIds: null, expiresInDays: 30 });
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

async function newPlaybook(secret: string): Promise<string> {
  const res = await CREATE_PLAYBOOK(
    req(secret, "POST", {
      name: `Leith ${RUN}`,
      days: [
        {
          stops: [
            {
              title: "The harbour",
              timeWindow: { start: "09:00", end: "12:00" },
              location: { name: "The Shore", city: "Edinburgh", countryCode: "GB" },
              notes: "",
              anchors: [],
              kind: "planned",
              tags: [],
              cost: null,
            },
          ],
        },
      ],
    }),
    NO_PARAMS,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { playbook: { playbookId: string } }).playbook.playbookId;
}

const rowsOf = (playbookId: string) =>
  db.select().from(savedDayCovers).where(eq(savedDayCovers.savedDayId, playbookId));

let owner: string;
let secret: string;

beforeAll(async () => {
  owner = await entitled();
  secret = await tokenFor(owner);
});

describe("PUT /v1/playbooks/{playbookId}/cover", () => {
  it("sets a cover from an image URL, and GET reads it back through our own origin", async () => {
    const playbookId = await newPlaybook(secret);
    const body = { url: IMAGE_URL, alt: "The harbour at dusk", credit: { name: "Port of Leith" }, position: 30 };
    const put = await COVER.PUT(req(secret, "PUT", body), P(playbookId));
    expect(put.status).toBe(200);

    const got = await COVER.GET(req(secret, "GET"), P(playbookId));
    expect(got.status).toBe(200);
    const { cover } = await got.json();
    expect(cover).toMatchObject({
      source: "url",
      url: IMAGE_URL,
      alt: "The harbour at dusk",
      credit: { name: "Port of Leith", url: null },
      position: 30,
    });
    // What a browser loads is ours, never the image's host. A missing
    // `proxySrc` would resolve to the base below, so its path is checked first.
    expect(cover.proxySrc).toMatch(/^\/api\/cover-image\?/);
    expect(new URL(cover.proxySrc, "https://caesura.test").origin).toBe("https://caesura.test");
  });

  it.each([
    ["a URL that is not an image", PAGE_URL, "not-an-image"],
    ["a URL on a private address", PRIVATE_URL, "private-address"],
  ])("refuses %s as cover-url-rejected, saves nothing, and names no address", async (_what, url, reason) => {
    const playbookId = await newPlaybook(secret);
    const res = await COVER.PUT(req(secret, "PUT", { url }), P(playbookId));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: "cover-url-rejected", details: { reason } } });
    // The guard's own message carries the address the host resolved to; the
    // caller is told why, never what is inside our network.
    expect(text).not.toContain(INTERNAL_IP);
    expect(text).not.toContain("->");
    expect(await rowsOf(playbookId)).toEqual([]);
  });
});

describe("PATCH and DELETE /v1/playbooks/{playbookId}/cover", () => {
  it("moves the cover with { position } and leaves the image as it was", async () => {
    const playbookId = await newPlaybook(secret);
    expect((await COVER.PUT(req(secret, "PUT", { url: IMAGE_URL }), P(playbookId))).status).toBe(200);
    const res = await COVER.PATCH(req(secret, "PATCH", { position: 85 }), P(playbookId));
    expect(res.status).toBe(200);
    expect((await res.json()).cover).toMatchObject({ source: "url", url: IMAGE_URL, position: 85 });
    expect((await (await COVER.GET(req(secret, "GET"), P(playbookId))).json()).cover).toMatchObject({ position: 85 });
  });

  it("answers 404 when there is no cover to move", async () => {
    const playbookId = await newPlaybook(secret);
    const res = await COVER.PATCH(req(secret, "PATCH", { position: 40 }), P(playbookId));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not-found");
  });

  it("clears the cover", async () => {
    const playbookId = await newPlaybook(secret);
    expect((await COVER.PUT(req(secret, "PUT", { url: IMAGE_URL }), P(playbookId))).status).toBe(200);
    const res = await COVER.DELETE(req(secret, "DELETE"), P(playbookId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cover: null });
    expect(await rowsOf(playbookId)).toEqual([]);
  });
});

describe("who may set a playbook's cover", () => {
  it("refuses a token without library:write, and a stranger's token on a private playbook", async () => {
    const playbookId = await newPlaybook(secret);
    const readOnly = await tokenFor(owner, { scopes: ["library:read"] });
    const stranger = await entitled();
    const strangerToken = await tokenFor(stranger);

    for (const [token, code] of [
      [readOnly, "insufficient-scope"],
      [strangerToken, "not-found"],
    ] as const) {
      const res = await COVER.PUT(req(token, "PUT", { url: IMAGE_URL }), P(playbookId));
      expect(res.status, code).toBe(code === "insufficient-scope" ? 403 : 404);
      expect((await res.json()).error.code).toBe(code);
    }
    // A stranger may not even read a private playbook's cover: the day
    // itself is the same 404 to them.
    expect((await COVER.GET(req(strangerToken, "GET"), P(playbookId))).status).toBe(404);
    expect(await rowsOf(playbookId)).toEqual([]);
  });

  it("reads a published playbook's cover for a stranger, but still refuses their writes", async () => {
    const playbookId = await newPlaybook(secret);
    expect((await COVER.PUT(req(secret, "PUT", { url: IMAGE_URL }), P(playbookId))).status).toBe(200);
    expect(
      (await PLAYBOOK.PATCH(req(secret, "PATCH", { visibility: "public" }), P(playbookId))).status,
    ).toBe(200);

    const stranger = await entitled();
    const strangerToken = await tokenFor(stranger);
    const got = await COVER.GET(req(strangerToken, "GET"), P(playbookId));
    expect(got.status).toBe(200);
    expect((await got.json()).cover).toMatchObject({ source: "url", url: IMAGE_URL });
    // Published is readable, not writable, to anyone but the author.
    expect((await COVER.PUT(req(strangerToken, "PUT", { url: IMAGE_URL }), P(playbookId))).status).toBe(404);
    expect((await COVER.PATCH(req(strangerToken, "PATCH", { position: 10 }), P(playbookId))).status).toBe(404);
    expect((await COVER.DELETE(req(strangerToken, "DELETE"), P(playbookId))).status).toBe(404);
  });

  it("lets the author set a cover on their published playbook", async () => {
    const playbookId = await newPlaybook(secret);
    expect(
      (await PLAYBOOK.PATCH(req(secret, "PATCH", { visibility: "public" }), P(playbookId))).status,
    ).toBe(200);
    // Covers are decoration, not content under review: unlike PATCHing the
    // days of a published playbook, setting its cover is not a 409.
    expect((await COVER.PUT(req(secret, "PUT", { url: IMAGE_URL }), P(playbookId))).status).toBe(200);
    expect((await (await COVER.GET(req(secret, "GET"), P(playbookId))).json()).cover).toMatchObject({
      source: "url",
      url: IMAGE_URL,
    });
  });
});
