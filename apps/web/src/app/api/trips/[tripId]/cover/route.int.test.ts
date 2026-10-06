import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverSearchResponse, TripCoverResponse, TripSummary, type CoverCandidate } from "@tc/contracts";
import { grantMembership } from "@/server/access/members";
import { executeTripCommand } from "@/server/commands";
import { serverConfig } from "@/server/config";
import { db } from "@/server/db/client";
import { rateLimitCounters, tripCovers } from "@/server/db/schema";
import { offlineCoverPhotos } from "@/server/external/unsplash/offline";
import { rebuildProjections } from "@/server/projections";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

// M37 part 3's gate boxes, against real Postgres and the offline cover source
// (`EXTERNAL_DATA_OFFLINE=true`): no test here reaches Unsplash. The fake
// records each download ping, which is what "exactly one ping per pick" is
// asserted on; `getCoverPhotos` is wrapped so "no page view calls Unsplash"
// can count calls to the port itself.

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const portCalls = vi.fn();
vi.mock("@/server/external/unsplash", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/external/unsplash")>();
  return {
    ...original,
    getCoverPhotos: () => {
      portCalls();
      return original.getCoverPhotos();
    },
  };
});

const { GET: COVER_GET, PUT, DELETE } = await import("./route");
const { GET: SEARCH } = await import("./search/route");
const { GET: LIST_TRIPS } = await import("../../route");
const { GET: TRIP_DETAIL } = await import("../route");

const run = randomUUID().slice(0, 8);
const OWNER = `cover-owner-${run}`;
const EDITOR = `cover-editor-${run}`;
const SUGGESTER = `cover-suggester-${run}`;
const VIEWER = `cover-viewer-${run}`;

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Lisbon" }, OWNER)).ok).toBe(true);
  for (const [userId, role] of [[EDITOR, "editor"], [SUGGESTER, "suggester"], [VIEWER, "viewer"]] as const) {
    await grantMembership(db, { tripId, userId, role, invitedBy: OWNER, now: new Date().toISOString() });
  }
  return tripId;
}

const at = (tripId: string) => ({ params: Promise.resolve({ tripId }) });
const search = (tripId: string, q = "lisbon", page = 1) =>
  SEARCH(new Request(`http://test/api/trips/${tripId}/cover/search?q=${encodeURIComponent(q)}&page=${page}`), at(tripId));
const pick = (tripId: string, candidate: CoverCandidate) =>
  PUT(
    new Request(`http://test/api/trips/${tripId}/cover`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate }),
    }),
    at(tripId),
  );
const clear = (tripId: string) => DELETE(new Request(`http://test/api/trips/${tripId}/cover`, { method: "DELETE" }), at(tripId));
const coverOf = async (tripId: string) =>
  TripCoverResponse.parse(await (await COVER_GET(new Request("http://test/x"), at(tripId))).json()).cover;

/** The offline source's candidates, as the picker would hold them. */
async function candidates(tripId: string): Promise<CoverCandidate[]> {
  const res = await search(tripId);
  expect(res.status).toBe(200);
  return CoverSearchResponse.parse(await res.json()).results;
}

const savedKey = serverConfig.unsplashAccessKey;

beforeAll(async () => {
  // A free owner's granted roles cap to viewer (M20 link 6).
  await entitleAccounts([OWNER]);
});

beforeEach(async () => {
  vi.stubEnv("EXTERNAL_DATA_OFFLINE", "true");
  offlineCoverPhotos.pings.length = 0;
  portCalls.mockClear();
  currentUserId = OWNER;
  // Only this policy's rows: the global ceiling is per deployment, and this
  // file's picks and searches would otherwise add up across tests.
  await db.delete(rateLimitCounters).where(like(rateLimitCounters.bucket, "unsplash-hourly:%"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  serverConfig.unsplashAccessKey = savedKey;
});

describe("GET /api/trips/:id/cover/search", () => {
  it("answers a page of candidates to an editor, and nothing for an empty query without charging it", async () => {
    const tripId = await seedTrip();
    currentUserId = EDITOR;
    expect((await candidates(tripId)).length).toBeGreaterThanOrEqual(2);

    const empty = await search(tripId, "   ");
    expect(await empty.json()).toEqual({ results: [] });
    const [charged] = await db
      .select({ hits: rateLimitCounters.hits })
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.bucket, `unsplash-hourly:user:${EDITOR}`));
    expect(charged?.hits).toBe(1);
  });

  it("429s once the person's Unsplash quota is spent", async () => {
    vi.stubEnv("UNSPLASH_RATE_LIMIT_PER_USER_HOURLY", "2");
    const tripId = await seedTrip();
    expect((await search(tripId)).status).toBe(200);
    expect((await search(tripId)).status).toBe(200);
    const refused = await search(tripId);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ reason: "user" });
  });

  it("503s covers-unavailable with no key and not offline, before charging anything", async () => {
    vi.stubEnv("EXTERNAL_DATA_OFFLINE", "false");
    serverConfig.unsplashAccessKey = "";
    const tripId = await seedTrip();
    const res = await search(tripId);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "covers-unavailable" });
    expect(await db.select().from(rateLimitCounters).where(like(rateLimitCounters.bucket, "unsplash-hourly:%"))).toEqual([]);
  });

  it("400s on a deleted trip and refuses a page out of range", async () => {
    const tripId = await seedTrip();
    expect((await search(tripId, "lisbon", 0)).status).toBe(400);
    await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);
    expect((await search(tripId)).status).toBe(400);
  });
});

describe("PUT and DELETE /api/trips/:id/cover", () => {
  it("stores a pick and pings its download location exactly once", async () => {
    const tripId = await seedTrip();
    const [first] = await candidates(tripId);
    const res = await pick(tripId, first!);
    expect(res.status).toBe(200);
    const { cover } = TripCoverResponse.parse(await res.json());
    expect(cover).toEqual({
      unsplashId: first!.id,
      urls: first!.urls,
      alt: first!.alt,
      photographerName: first!.photographerName,
      photographerUrl: first!.photographerUrl,
      photoPageUrl: first!.photoPageUrl,
    });
    expect(offlineCoverPhotos.pings).toEqual([first!.downloadLocation]);
    expect(await coverOf(tripId)).toEqual(cover);
    // A search result shown is not a use: only the pick pinged.
  });

  it("replaces the cover on a re-pick and pings once more, the same photo included", async () => {
    const tripId = await seedTrip();
    const [first, second] = await candidates(tripId);
    await pick(tripId, first!);
    currentUserId = EDITOR;
    expect((await pick(tripId, second!)).status).toBe(200);
    expect((await pick(tripId, second!)).status).toBe(200);

    expect(offlineCoverPhotos.pings).toEqual([first!.downloadLocation, second!.downloadLocation, second!.downloadLocation]);
    expect((await coverOf(tripId))?.unsplashId).toBe(second!.id);
    const rows = await db.select().from(tripCovers).where(eq(tripCovers.tripId, tripId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.setBy).toBe(EDITOR);
  });

  it("clears the cover", async () => {
    const tripId = await seedTrip();
    const [first] = await candidates(tripId);
    await pick(tripId, first!);
    const res = await clear(tripId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cover: null });
    expect(await coverOf(tripId)).toBeNull();
    expect(await db.select().from(tripCovers).where(eq(tripCovers.tripId, tripId))).toEqual([]);
  });

  it("refuses a candidate the source did not mint, storing and pinging nothing", async () => {
    const tripId = await seedTrip();
    const [first] = await candidates(tripId);
    const forged = { ...first!, photographerUrl: "javascript:alert(1)" };
    const res = await pick(tripId, forged);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not-a-cover-candidate" });
    expect(await coverOf(tripId)).toBeNull();
    expect(offlineCoverPhotos.pings).toEqual([]);
  });

  it.each([
    ["viewer", VIEWER],
    ["suggester", SUGGESTER],
  ])("403s a %s on search, pick and clear", async (_role, userId) => {
    const tripId = await seedTrip();
    const [first] = await candidates(tripId);
    await pick(tripId, first!);
    offlineCoverPhotos.pings.length = 0;

    currentUserId = userId;
    expect((await search(tripId)).status).toBe(403);
    expect((await pick(tripId, first!)).status).toBe(403);
    expect((await clear(tripId)).status).toBe(403);
    expect(offlineCoverPhotos.pings).toEqual([]);
    // They may still see it.
    expect((await coverOf(tripId))?.unsplashId).toBe(first!.id);
  });

  it("400s a pick or a clear on a deleted trip", async () => {
    const tripId = await seedTrip();
    const [first] = await candidates(tripId);
    await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);
    expect((await pick(tripId, first!)).status).toBe(400);
    expect((await clear(tripId)).status).toBe(400);
    expect(offlineCoverPhotos.pings).toEqual([]);
  });
});

describe("a cover on the trip list", () => {
  it("rides on GET /api/trips as TripSummary.cover, and survives a projection rebuild", async () => {
    const tripId = await seedTrip();
    const bare = await seedTrip();
    const [first] = await candidates(tripId);
    await pick(tripId, first!);

    const listed = async () => {
      const res = await LIST_TRIPS();
      const { trips } = (await res.json()) as { trips: unknown[] };
      return trips.map((t) => TripSummary.parse(t));
    };
    const byId = new Map((await listed()).map((t) => [t.tripId, t]));
    expect(byId.get(tripId)?.cover).toEqual(await coverOf(tripId));
    expect(byId.get(tripId)?.cover?.photographerName).toBe(first!.photographerName);
    expect(byId.get(bare)?.cover).toBeNull();

    // `trip_covers` is CRUD, not a projection: a rebuild deletes and
    // re-inserts `trip_summaries` and must leave every cover where it was.
    await rebuildProjections();
    expect(new Map((await listed()).map((t) => [t.tripId, t])).get(tripId)?.cover?.unsplashId).toBe(first!.id);
  });

  // M37's gate: no page view calls Unsplash. The wall in eslint.config.mjs
  // stops these routes importing the port; this proves they do not reach it,
  // with a key configured and the real adapter the one that would answer.
  it("lists trips and reads a trip without calling the cover port or Unsplash", async () => {
    const tripId = await seedTrip();
    const [first] = await candidates(tripId);
    await pick(tripId, first!);
    portCalls.mockClear();
    offlineCoverPhotos.pings.length = 0;

    vi.stubEnv("EXTERNAL_DATA_OFFLINE", "false");
    serverConfig.unsplashAccessKey = "test-key-never-sent";
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    const searchSpy = vi.spyOn(offlineCoverPhotos, "search");

    expect((await LIST_TRIPS()).status).toBe(200);
    expect((await TRIP_DETAIL(new Request(`http://test/api/trips/${tripId}`), at(tripId))).status).toBe(200);

    expect(portCalls).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(offlineCoverPhotos.pings).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
