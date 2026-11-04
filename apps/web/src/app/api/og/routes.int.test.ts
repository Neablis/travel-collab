import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { commandsFor } from "@tc/factories";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { createInvite, revokeInvite } from "@/server/access/invites";
import { createPageShare, isPublishable, revokePageShare } from "@/server/access/pageShares";
import { listPages } from "@/server/pages";
import { setTripCover } from "@/server/tripCovers";
import { notebookCardFor, notebookCopy } from "@/server/og/notebook";
import { mintReferralCode } from "@/server/entitlements/referrals";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { GET as inviteImage } from "./invite/[token]/route";
import { GET as inviteMeta } from "./invite/[token]/meta/route";
import { GET as referralImage } from "./referral/[code]/route";
import { GET as referralMeta } from "./referral/[code]/meta/route";
import { GET as notebookImage } from "./notebook/[token]/route";

// The preview routes (spec 2026-09-27 §2.3): each state answers a real PNG at
// the size chat apps expect, and the meta sibling carries the title the
// unfurler prints beside it. What the lookups return is `server/og/og.int.test.ts`;
// this is what leaves over HTTP.

const run = randomUUID().slice(0, 8);
const OWNER = `dev-og-routes-owner-${run}`;
const TRIP_NAME = "Japan: Tokyo → Kyoto";

// The cover is a photo on the photo host, which the card renderer fetches; the
// network guard refuses a third party, so it is answered here with one pixel.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const photoHost = setupServer(
  http.get("https://images.unsplash.com/*", () => new HttpResponse(ONE_PIXEL_PNG, { headers: { "content-type": "image/png" } })),
);
afterAll(() => photoHost.close());

let pendingToken = "";
let revokedToken = "";
let referralCode = "";
let liveNotebookToken = "";
let revokedNotebookToken = "";
let notebookTitle = "";

const request = new Request("http://test/x");
const withToken = (token: string) => ({ params: Promise.resolve({ token }) });
const withCode = (code: string) => ({ params: Promise.resolve({ code }) });

/** The width and height a PNG declares in its IHDR chunk. */
async function pngSize(response: Response): Promise<{ width: number; height: number }> {
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

beforeAll(async () => {
  photoHost.listen({ onUnhandledRequest: "bypass" });
  await entitleAccounts([OWNER]);
  await db.update(users).set({ name: "Dana Reyes", email: "dana@example.com" }).where(eq(users.id, OWNER));
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: TRIP_NAME }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  for (const command of commandsFor("threeDayTrip", tripId, { startDate: "2027-06-01" })) {
    if (!(await executeTripCommand(command, OWNER)).ok) throw new Error(`failed to seed ${command.type}`);
  }
  pendingToken = (await createInvite(tripId, OWNER, { email: null, role: "editor" })).token;
  const revoked = await createInvite(tripId, OWNER, { email: null, role: "editor" });
  await revokeInvite(tripId, revoked.inviteId);
  revokedToken = revoked.token;
  // M58: a notebook that was public and is private again, then public once
  // more (a new token), on a trip with a cover. Not the Overview, whose title
  // is the trip's name and so could not show the card names nothing else.
  const notebook = (await listPages(tripId)).find((page) => isPublishable(page) && !page.title.includes(TRIP_NAME))!;
  notebookTitle = notebook.title;
  await setTripCover(
    tripId,
    {
      id: "photo-1", alt: null, photographerName: "Pat", photographerUrl: "https://unsplash.com/@pat",
      photoPageUrl: "https://unsplash.com/photos/photo-1", downloadLocation: "https://api.unsplash.com/photos/photo-1/download",
      urls: { raw: "https://images.unsplash.com/photo-1", regular: "https://images.unsplash.com/photo-1?w=1080", small: "https://images.unsplash.com/photo-1?w=400" },
    },
    OWNER,
  );
  const first = await createPageShare(tripId, notebook.id, OWNER);
  if (!first.ok) throw new Error(first.error.message);
  await revokePageShare(tripId, notebook.id, first.value.shareId);
  revokedNotebookToken = first.value.token;
  const second = await createPageShare(tripId, notebook.id, OWNER);
  if (!second.ok) throw new Error(second.error.message);
  liveNotebookToken = second.value.token;
  const minted = await mintReferralCode(OWNER);
  if (!minted.ok) throw new Error(minted.reason);
  referralCode = minted.code;
});

describe("GET /api/og/invite/:token", () => {
  it.each([
    ["a pending invite", () => pendingToken],
    ["a revoked invite", () => revokedToken],
    ["an unknown token", () => `no-such-token-${run}`],
  ])("draws %s as a 1200×630 PNG with the short cache header", async (_state, token) => {
    const response = await inviteImage(request, withToken(token()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600, stale-while-revalidate=604800");
    expect(await pngSize(response)).toEqual({ width: 1200, height: 630 });
  });
});

describe("GET /api/og/invite/:token/meta", () => {
  it("titles a pending invite with the inviter's first name and the trip", async () => {
    const response = await inviteMeta(request, withToken(pendingToken));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { title: string; description: string };
    expect(body.title).toBe(`Dana invited you to plan ${TRIP_NAME}`);
    expect(body.description).toBe("Jun 1, 2027 – Jun 3, 2027 · 3 days · 3 cities");
  });

  it("titles a revoked invite generically, naming nobody", async () => {
    const response = await inviteMeta(request, withToken(revokedToken));

    const body = (await response.json()) as { title: string; description: string };
    expect(body.title).toBe("You're invited to a trip on Caesura");
    expect(JSON.stringify(body)).not.toContain("Dana");
  });
});

describe("GET /api/og/referral/:code", () => {
  it.each([
    ["a known code", () => referralCode],
    ["an unknown code", () => `NOPE${run}`],
  ])("draws %s as a 1200×630 PNG, cached for a day at the edge", async (_state, code) => {
    const response = await referralImage(request, withCode(code()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(await pngSize(response)).toEqual({ width: 1200, height: 630 });
  });
});

describe("GET /api/og/referral/:code/meta", () => {
  it("titles a known code with the referrer's first name", async () => {
    const response = await referralMeta(request, withCode(referralCode));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      title: "Dana invited you to Caesura",
      description: "Trips, planned together",
    });
  });

  it("answers 404 for a code that names nobody, so the page keeps the site card", async () => {
    const response = await referralMeta(request, withCode(`NOPE${run}`));

    expect(response.status).toBe(404);
  });
});

// M58 (ADR-088 §2): the card for `/n/<token>` is the notebook's title and the
// trip's cover, and nothing else; a revoked or unknown token is the generic card.
describe("GET /api/og/notebook/:token", () => {
  it("draws a live notebook as a 1200×630 PNG that no cache may keep", async () => {
    const response = await notebookImage(request, withToken(liveNotebookToken));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await pngSize(response)).toEqual({ width: 1200, height: 630 });
  });

  it.each([
    ["a revoked link", () => revokedNotebookToken],
    ["an unknown token", () => `no-such-token-${run}`],
  ])("draws %s as the generic card, which names nothing", async (_state, token) => {
    expect(await notebookCardFor(token())).toEqual({ kind: "generic" });
    const response = await notebookImage(request, withToken(token()));

    expect(response.status).toBe(200);
    expect(await pngSize(response)).toEqual({ width: 1200, height: 630 });
  });

  it("carries the title and the cover, and neither the trip's name nor anyone's", async () => {
    const card = await notebookCardFor(liveNotebookToken);

    expect(card).toEqual({ kind: "notebook", title: notebookTitle, cover: "https://images.unsplash.com/photo-1?w=1080" });
    const copy = JSON.stringify(notebookCopy(card));
    expect(copy).toContain(notebookTitle);
    expect(copy).not.toContain("Japan");
    expect(copy).not.toContain("Dana");
    expect(copy).not.toContain("Jun 1");
  });
});

describe("the per-IP rate limit on every /api/og route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // Only `Date` is faked, pinned mid-window: the limiter's windows are
  // epoch-aligned minutes, and three requests straddling a boundary would land
  // in two windows and pass for the wrong reason.
  it.each([
    ["invite image", (req: Request) => inviteImage(req, withToken(pendingToken))],
    ["invite meta", (req: Request) => inviteMeta(req, withToken(pendingToken))],
    ["referral image", (req: Request) => referralImage(req, withCode(referralCode))],
    ["referral meta", (req: Request) => referralMeta(req, withCode(referralCode))],
    ["notebook image", (req: Request) => notebookImage(req, withToken(liveNotebookToken))],
  ])("refuses the %s past the ceiling with an uncacheable 429, per IP", async (_route, call) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T12:00:30.000Z"));
    vi.stubEnv("LINK_PREVIEW_RATE_LIMIT_PER_IP_MINUTE", "2");
    const ip = `ip-${randomUUID()}`;
    const from = (address: string) =>
      new Request("http://test/x", { headers: { "x-forwarded-for": `${address}, 10.0.0.1` } });

    expect((await call(from(ip))).status).toBe(200);
    expect((await call(from(ip))).status).toBe(200);
    const refused = await call(from(ip));

    expect(refused.status).toBe(429);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect((await call(from(`other-${ip}`))).status).toBe(200);
  });
});
