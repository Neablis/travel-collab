import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverSearchResponse, TripCover, TripCoverResponse, type CoverCandidate } from "@tc/contracts";
import { DiscoverResponse, PublicProfileResponse } from "@/lib/playbooks";
import { executeTripCommand } from "@/server/commands";
import { serverConfig } from "@/server/config";
import { db } from "@/server/db/client";
import { rateLimitCounters, savedDayCovers, savedDays } from "@/server/db/schema";
import { offlineCoverPhotos } from "@/server/external/unsplash/offline";
import { dayPageView, publishedDaysPage } from "@/server/publicLibrary";
import { clearSavedDayCover, setSavedDayCover } from "@/server/savedDayCovers";

// M37 part 5: a playbook day's cover, against real Postgres and the offline
// cover source (`EXTERNAL_DATA_OFFLINE=true`) — no test here reaches Unsplash.
// The trip cover suite's boxes, with the author in the editor's place, and two
// of a published day's own: a cover is gone wherever its day is (moderated,
// deleted, private), and no public read of a day asks the cover port anything.
//
// Actors and a city minted per test, `[savedDayId]/route.int.test.ts`'s reason:
// the library is global, and a Discover assertion about a shared city would be
// an assertion about whatever else this lane published into it.

// The ping is sent with Next's `after()`, which throws outside a request
// scope: replaced by a queue `settle()` drains, as the trip suite does, so a
// test sees the ping was not sent before the response and then awaits it.
const afterResponse = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    afterResponse.push(task);
  },
}));
async function settle(): Promise<void> {
  while (afterResponse.length > 0) await afterResponse.shift()!();
}

let currentUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// The library cache's clear, watched: outside a production build it clears
// nothing, so what a test can see is whether a write asked for it.
const invalidated = vi.hoisted(() => vi.fn());
vi.mock("@/server/libraryCache", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/libraryCache")>();
  return {
    ...original,
    invalidatePublicDay: async (savedDayId: string, ownerId: string) => {
      invalidated(savedDayId, ownerId);
      return original.invalidatePublicDay(savedDayId, ownerId);
    },
  };
});

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
const { GET: READ_DAY, DELETE: DELETE_DAY } = await import("../route");
const { POST: PUBLISH, DELETE: UNPUBLISH } = await import("../publish/route");
const { POST: SAVE } = await import("../../route");
const { GET: DISCOVER } = await import("../../../playbooks/route");
const { GET: PROFILE } = await import("../../../playbooks/profile/[userId]/route");

let AUTHOR = "";
let OTHER = "";
let CITY = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  AUTHOR = `daycover-author-${run}`;
  OTHER = `daycover-other-${run}`;
  CITY = `Covercity${run}`;
  currentUserId = AUTHOR;
  vi.stubEnv("EXTERNAL_DATA_OFFLINE", "true");
  offlineCoverPhotos.pings.length = 0;
  afterResponse.length = 0;
  portCalls.mockClear();
  // These policies' rows only, as the trip suite clears them: the global
  // ceilings are per deployment, and the picks below would otherwise add up.
  await db.delete(rateLimitCounters).where(like(rateLimitCounters.bucket, "unsplash-%"));
});

const savedKey = serverConfig.unsplashAccessKey;
afterEach(() => {
  vi.unstubAllEnvs();
  serverConfig.unsplashAccessKey = savedKey;
});

/** A one-stop day in CITY, kept by the author. Private until `publish`. */
async function saveDay(name = "Harbour morning"): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, AUTHOR);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, AUTHOR);
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "The fish market",
      timeWindow: { start: "07:00", end: "08:00" },
      location: { name: "Market hall", city: CITY },
    },
    AUTHOR,
  );
  const as = currentUserId;
  currentUserId = AUTHOR;
  const res = await SAVE(
    new Request("http://test/x", { method: "POST", body: JSON.stringify({ name, tripId, dayIds: [dayId] }) }),
  );
  currentUserId = as;
  expect(res.status).toBe(201);
  return ((await res.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
}

const at = (savedDayId: string) => ({ params: Promise.resolve({ savedDayId }) });
// Anonymous reads are charged per IP; a fresh one each so the limit never bites.
const anonymous = () => ({ "x-forwarded-for": `anon-${randomUUID()}` });

async function publish(savedDayId: string): Promise<void> {
  const as = currentUserId;
  currentUserId = AUTHOR;
  expect((await PUBLISH(new Request("http://test/x", { method: "POST" }), at(savedDayId))).status).toBe(200);
  currentUserId = as;
}

const search = (savedDayId: string, q = "harbour") =>
  SEARCH(new Request(`http://test/api/saved-days/${savedDayId}/cover/search?q=${encodeURIComponent(q)}`), at(savedDayId));
const pick = (savedDayId: string, candidate: CoverCandidate) =>
  PUT(
    new Request(`http://test/api/saved-days/${savedDayId}/cover`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate }),
    }),
    at(savedDayId),
  );
const clear = (savedDayId: string) =>
  DELETE(new Request(`http://test/api/saved-days/${savedDayId}/cover`, { method: "DELETE" }), at(savedDayId));
const coverRead = (savedDayId: string) =>
  COVER_GET(new Request("http://test/x", { headers: anonymous() }), at(savedDayId));

/** The offline source's candidates, as the author's picker holds them. */
async function candidates(savedDayId: string): Promise<CoverCandidate[]> {
  const as = currentUserId;
  currentUserId = AUTHOR;
  const res = await search(savedDayId);
  currentUserId = as;
  expect(res.status).toBe(200);
  return CoverSearchResponse.parse(await res.json()).results;
}

/** The day's cover as `GET /api/saved-days/:id` hands it to the current reader, or the status it refused with. */
async function dayCover(savedDayId: string): Promise<TripCover | null | number> {
  const res = await READ_DAY(new Request("http://test/x", { headers: anonymous() }), at(savedDayId));
  if (res.status !== 200) return res.status;
  const body = (await res.json()) as { cover: unknown };
  return body.cover === null ? null : TripCover.parse(body.cover);
}

/** The card Discover draws for `savedDayId` for the current reader, or undefined when it shows none. */
async function card(savedDayId: string) {
  const res = await DISCOVER(new Request(`http://test/api/playbooks?city=${CITY}`, { headers: anonymous() }));
  expect(res.status).toBe(200);
  return DiscoverResponse.parse(await res.json()).days.find((d) => d.savedDayId === savedDayId);
}

describe("who may change a playbook day's cover", () => {
  it("is the author alone: another reader of a published day gets 403 on all three writes", async () => {
    const savedDayId = await saveDay();
    await publish(savedDayId);
    const [first] = await candidates(savedDayId);

    currentUserId = OTHER;
    // The witness: OTHER can read this day — a 403, not the 404 of a day they cannot see.
    expect(await dayCover(savedDayId)).toBeNull();
    for (const res of [await search(savedDayId), await pick(savedDayId, first!), await clear(savedDayId)]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "not-the-author" });
    }
    await settle();
    expect(offlineCoverPhotos.pings).toEqual([]);
    expect(await db.select().from(savedDayCovers).where(eq(savedDayCovers.savedDayId, savedDayId))).toEqual([]);
  });

  it("401s a reader with no account, and 404s another account on a private day", async () => {
    const savedDayId = await saveDay();
    const [first] = await candidates(savedDayId);
    currentUserId = null;
    expect((await search(savedDayId)).status).toBe(401);
    expect((await pick(savedDayId, first!)).status).toBe(401);
    currentUserId = OTHER;
    // A private day is not there to anyone else — the same 404 an unknown id gets.
    expect((await search(savedDayId)).status).toBe(404);
    expect((await pick(savedDayId, first!)).status).toBe(404);
    expect((await clear(savedDayId)).status).toBe(404);
    expect((await search(randomUUID())).status).toBe(404);
  });
});

describe("picking and clearing", () => {
  it("stores the pick with exactly one ping after the response, a re-pick sends one more, and a clear removes it", async () => {
    const savedDayId = await saveDay();
    await publish(savedDayId);
    const [first, second] = await candidates(savedDayId);
    expect(offlineCoverPhotos.pings).toEqual([]);

    const res = await pick(savedDayId, first!);
    expect(res.status).toBe(200);
    const stored = TripCoverResponse.parse(await res.json()).cover;
    expect(stored?.unsplashId).toBe(first!.id);
    expect(offlineCoverPhotos.pings).toEqual([]);
    await settle();
    expect(offlineCoverPhotos.pings).toEqual([first!.downloadLocation]);
    expect(TripCoverResponse.parse(await (await coverRead(savedDayId)).json()).cover).toEqual(stored);

    // The same photo again is a new use (guideline 2); another photo replaces it.
    expect((await pick(savedDayId, first!)).status).toBe(200);
    expect((await pick(savedDayId, second!)).status).toBe(200);
    await settle();
    expect(offlineCoverPhotos.pings).toEqual([first!.downloadLocation, first!.downloadLocation, second!.downloadLocation]);
    expect(await db.select().from(savedDayCovers).where(eq(savedDayCovers.savedDayId, savedDayId))).toHaveLength(1);
    expect((await dayCover(savedDayId)) as TripCover).toMatchObject({ unsplashId: second!.id });

    const cleared = await clear(savedDayId);
    expect(await cleared.json()).toEqual({ cover: null });
    expect(await dayCover(savedDayId)).toBeNull();
    await settle();
    expect(offlineCoverPhotos.pings).toHaveLength(3);
  });

  it("refuses a candidate the cover source did not mint, and pings nothing", async () => {
    const savedDayId = await saveDay();
    const [first] = await candidates(savedDayId);
    const forged = { ...first!, photographerUrl: "https://evil.test/@ada" };
    const res = await pick(savedDayId, forged);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not-a-cover-candidate" });
    await settle();
    expect(offlineCoverPhotos.pings).toEqual([]);
  });

  it("503s search and pick where covers are not set up, so the picker can say so", async () => {
    const savedDayId = await saveDay();
    const [first] = await candidates(savedDayId);
    vi.stubEnv("EXTERNAL_DATA_OFFLINE", "false");
    serverConfig.unsplashAccessKey = "";
    for (const res of [await search(savedDayId), await pick(savedDayId, first!)]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "covers-unavailable" });
    }
  });

  it("429s once the author's Unsplash search quota is spent, and still takes a pick", async () => {
    vi.stubEnv("UNSPLASH_SEARCH_RATE_LIMIT_PER_USER_HOURLY", "2");
    const savedDayId = await saveDay();
    const [first] = await candidates(savedDayId);
    expect((await search(savedDayId)).status).toBe(200);
    expect((await search(savedDayId)).status).toBe(429);
    // The pick quota is its own (PR #352 review): searches spent do not cost the find.
    expect((await pick(savedDayId, first!)).status).toBe(200);
    await settle();
    expect(offlineCoverPhotos.pings).toEqual([first!.downloadLocation]);
  });

  it("429s a pick once the author's pick quota is spent, and pings nothing for it", async () => {
    vi.stubEnv("UNSPLASH_PICK_RATE_LIMIT_PER_USER_HOURLY", "1");
    const savedDayId = await saveDay();
    const [first, second] = await candidates(savedDayId);
    expect((await pick(savedDayId, first!)).status).toBe(200);
    expect((await pick(savedDayId, second!)).status).toBe(429);
    await settle();
    expect(offlineCoverPhotos.pings).toEqual([first!.downloadLocation]);
    expect((await dayCover(savedDayId)) as TripCover).toMatchObject({ unsplashId: first!.id });
  });
});

describe("the library cache", () => {
  // PR #354 review: the decision is the day's visibility AFTER the write. The
  // route's own check is earlier, so a publish in another tab in between left
  // the old card cached for a day; the setters now decide, and are called
  // here with no route in front of them.
  it("is cleared by a cover write on a public day, decided by the setter itself", async () => {
    const savedDayId = await saveDay();
    const [first] = await candidates(savedDayId);
    await publish(savedDayId);
    invalidated.mockClear();

    await setSavedDayCover(savedDayId, first!, AUTHOR);
    expect(invalidated).toHaveBeenCalledWith(savedDayId, AUTHOR);
    invalidated.mockClear();
    await clearSavedDayCover(savedDayId);
    expect(invalidated).toHaveBeenCalledWith(savedDayId, AUTHOR);
  });

  it("is left alone by a cover write on a private day, which no cached read holds", async () => {
    const savedDayId = await saveDay();
    const [first] = await candidates(savedDayId);
    invalidated.mockClear();
    await setSavedDayCover(savedDayId, first!, AUTHOR);
    await clearSavedDayCover(savedDayId);
    expect(invalidated).not.toHaveBeenCalled();
  });
});

describe("where the cover shows, and where it must not", () => {
  // PR #354 review: a row a later contract no longer accepts used to throw
  // out of the day read, a 500 over a decoration. Discover's cards already
  // dropped it; every read now does.
  it("drops a stored cover that no longer parses, and shows the day without it", async () => {
    const savedDayId = await saveDay();
    await publish(savedDayId);
    const [first] = await candidates(savedDayId);
    expect((await pick(savedDayId, first!)).status).toBe(200);
    // The witness: the cover reads as stored before the row is spoiled.
    expect(await dayCover(savedDayId)).toMatchObject({ unsplashId: first!.id });
    await db.update(savedDayCovers).set({ photographerName: "" }).where(eq(savedDayCovers.savedDayId, savedDayId));

    currentUserId = OTHER;
    expect(await dayCover(savedDayId)).toBeNull();
    expect(await (await coverRead(savedDayId)).json()).toEqual({ cover: null });
    expect((await card(savedDayId))?.cover).toBeNull();
  });

  it("rides the shared-day read, its cached page read, Discover and the profile — once published", async () => {
    const savedDayId = await saveDay();
    await publish(savedDayId);
    const [first] = await candidates(savedDayId);
    expect((await pick(savedDayId, first!)).status).toBe(200);

    currentUserId = OTHER;
    expect(await dayCover(savedDayId)).toMatchObject({ unsplashId: first!.id, photographerName: first!.photographerName });
    expect((await card(savedDayId))?.cover).toMatchObject({ unsplashId: first!.id, urls: first!.urls });
    expect((await dayPageView(savedDayId, null))?.view.cover).toMatchObject({ unsplashId: first!.id });
    const listed = await publishedDaysPage({ cities: [CITY] }, { limit: 10, offset: 0 });
    expect(listed.days.find((d) => d.savedDayId === savedDayId)?.cover?.unsplashId).toBe(first!.id);
    const profile = PublicProfileResponse.parse(
      await (await PROFILE(new Request("http://test/x", { headers: anonymous() }), { params: Promise.resolve({ userId: AUTHOR }) })).json(),
    );
    expect(profile.days.find((d) => d.savedDayId === savedDayId)?.cover?.unsplashId).toBe(first!.id);
  });

  it("is gone from every public read of a moderated day, and stays on its author's own", async () => {
    const savedDayId = await saveDay();
    await publish(savedDayId);
    const [first] = await candidates(savedDayId);
    expect((await pick(savedDayId, first!)).status).toBe(200);
    // The witness: before the moderator acts, a stranger sees the cover.
    currentUserId = OTHER;
    expect(await dayCover(savedDayId)).toMatchObject({ unsplashId: first!.id });
    expect((await card(savedDayId))?.cover).not.toBeNull();

    await db.update(savedDays).set({ moderatedAt: new Date() }).where(eq(savedDays.id, savedDayId));
    for (const reader of [OTHER, null]) {
      currentUserId = reader;
      expect(await dayCover(savedDayId)).toBe(404);
      expect((await coverRead(savedDayId)).status).toBe(404);
      expect(await card(savedDayId)).toBeUndefined();
    }
    expect(await dayPageView(savedDayId, null)).toBeNull();
    expect((await publishedDaysPage({ cities: [CITY] }, { limit: 10, offset: 0 })).days).toEqual([]);

    currentUserId = AUTHOR;
    expect(await dayCover(savedDayId)).toMatchObject({ unsplashId: first!.id });
  });

  it("is gone with its day when the author unpublishes or deletes it", async () => {
    const savedDayId = await saveDay();
    await publish(savedDayId);
    const [first] = await candidates(savedDayId);
    expect((await pick(savedDayId, first!)).status).toBe(200);

    expect((await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), at(savedDayId))).status).toBe(200);
    currentUserId = OTHER;
    expect(await dayCover(savedDayId)).toBe(404);
    expect((await coverRead(savedDayId)).status).toBe(404);

    currentUserId = AUTHOR;
    expect((await DELETE_DAY(new Request("http://test/x", { method: "DELETE" }), at(savedDayId))).status).toBe(200);
    expect(await dayCover(savedDayId)).toBe(404);
    expect((await search(savedDayId)).status).toBe(404);
    expect((await pick(savedDayId, first!)).status).toBe(404);
  });

  it("asks the cover port nothing on any read: the day, its cover, Discover, a profile, the page", async () => {
    const savedDayId = await saveDay();
    await publish(savedDayId);
    const [first] = await candidates(savedDayId);
    expect((await pick(savedDayId, first!)).status).toBe(200);
    // The witness: a pick does reach the port, so the spy is wired.
    expect(portCalls.mock.calls.length).toBeGreaterThan(0);
    portCalls.mockClear();

    for (const reader of [AUTHOR, OTHER, null]) {
      currentUserId = reader;
      expect(await dayCover(savedDayId)).not.toBeNull();
      expect((await coverRead(savedDayId)).status).toBe(200);
      expect((await card(savedDayId))?.cover).not.toBeNull();
      await PROFILE(new Request("http://test/x", { headers: anonymous() }), { params: Promise.resolve({ userId: AUTHOR }) });
      expect((await dayPageView(savedDayId, reader))?.view.cover).not.toBeNull();
    }
    expect(portCalls).not.toHaveBeenCalled();
  });
});
