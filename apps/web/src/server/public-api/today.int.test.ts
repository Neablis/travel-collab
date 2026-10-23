// **The trip under way, over the API** (M52 decision 21), driven as real HTTP:
// `GET /v1/trips?active=true` and `GET /v1/trips/{tripId}/today`, both on the
// phase and the stops `tripNow` gives, at one frozen instant.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tripNow } from "@tc/pages";
import type { TripDetail } from "@tc/contracts";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { db } from "@/server/db/client";
import { grantMembership } from "@/server/access/members";
import { buildTripGlobals } from "@/server/tripGlobals";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));
// The active scan reads `MAX_PAGE_LIMIT` rows a batch; at 2, a dozen trips
// reach its batch cap. The wrapper's own `?limit=` bound keeps the real one.
vi.mock("@/server/public-api/route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/public-api/route")>()),
  MAX_PAGE_LIMIT: 2,
}));

const { POST: CREATE_TRIP, GET: LIST_TRIPS } = await import("@/app/api/v1/trips/route");
const { POST: ADD_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/route");
const { GET: TODAY } = await import("@/app/api/v1/trips/[tripId]/today/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

// 20:00 on 9 March in UTC, which is already 09:00 on 10 March in Tonga (UTC+13
// all year, so no daylight saving moves the case).
const AT = Date.parse("2027-03-09T20:00:00.000Z");
const NUKUALOFA = { name: "Nuku'alofa", lat: -21.1394, lng: -175.2049 };
const HONOLULU = { name: "Honolulu", lat: 21.3069, lng: -157.8583 };

async function entitled(): Promise<string> {
  const id = `v1t-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M52 part 10 fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(owner: string): Promise<string> {
  const minted = await mintToken(owner, { name: "today", scopes: ["trips:read", "trips:write"], tripIds: null, expiresInDays: 30 });
  expect(minted.ok).toBe(true);
  return minted.ok ? minted.created.secret : "";
}

const req = (secret: string, body?: unknown, method = "GET", url = "http://localhost/x") =>
  new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function trip(secret: string, name: string, dates: { startDate?: string; endDate?: string } = {}): Promise<TripDetail> {
  const res = await CREATE_TRIP(req(secret, { name: `${name} ${RUN}`, ...dates }, "POST"), NO_PARAMS);
  expect(res.status).toBe(201);
  return res.json();
}

async function stop(secret: string, tripId: string, body: Record<string, unknown>): Promise<TripDetail> {
  const res = await ADD_STOP(req(secret, body, "POST"), P({ tripId }));
  expect(res.status).toBe(201);
  return res.json();
}

async function listed(secret: string, query: string): Promise<{ ids: string[]; nextCursor: string | null }> {
  const res = await LIST_TRIPS(req(secret, undefined, "GET", `http://localhost/x${query}`), NO_PARAMS);
  expect(res.status).toBe(200);
  const page = await res.json();
  return { ids: (page.items as { tripId: string }[]).map((t) => t.tripId), nextCursor: page.nextCursor };
}

const listedIds = async (secret: string, query: string) => (await listed(secret, query)).ids;

const today = (secret: string, tripId: string, query = "") =>
  TODAY(req(secret, undefined, "GET", `http://localhost/x${query}`), P({ tripId }));

let owner: string;
let secret: string;
let trips: Record<"underway" | "planning" | "soon" | "ended" | "undated" | "tonga", TripDetail>;
let stops: Record<"dinner" | "bar" | "walk", string>;

beforeAll(async () => {
  // Only `Date`: the database driver's own timers keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AT);
  owner = await entitled();
  secret = await tokenFor(owner);
  const underway = await trip(secret, "Lisbon", { startDate: "2027-03-08", endDate: "2027-03-12" });
  const day = underway.days[1]!.dayId;
  // Out of order on purpose: `stops` keeps the day's order, `now`/`next` are by time.
  const added = [
    await stop(secret, underway.tripId, { title: "Walk", dayId: day }),
    await stop(secret, underway.tripId, { title: "Bar", dayId: day, timeWindow: { start: "21:30", end: "23:00" } }),
    await stop(secret, underway.tripId, { title: "Dinner", dayId: day, timeWindow: { start: "19:00", end: "21:00" } }),
  ].at(-1)!;
  const byTitle = (title: string) => Object.values(added.activities).find((a) => a.title === title)!.activityId;
  stops = { dinner: byTitle("Dinner"), bar: byTitle("Bar"), walk: byTitle("Walk") };

  const tonga = await trip(secret, "Tonga", { startDate: "2027-03-10", endDate: "2027-03-11" });
  await stop(secret, tonga.tripId, { title: "Market", dayId: tonga.days[0]!.dayId, location: NUKUALOFA });

  trips = {
    underway: added,
    planning: await trip(secret, "Kyoto", { startDate: "2027-04-01", endDate: "2027-04-05" }),
    soon: await trip(secret, "Rome", { startDate: "2027-03-11", endDate: "2027-03-13" }),
    ended: await trip(secret, "Oslo", { startDate: "2027-03-01", endDate: "2027-03-05" }),
    undated: await trip(secret, "Someday"),
    tonga,
  };
  // A timed stop ahead, which `tripNow` gives as next even before the trip.
  await stop(secret, trips.soon.tripId, { title: "Forum", dayId: trips.soon.days[0]!.dayId, timeWindow: { start: "10:00", end: "12:00" } });
});

afterAll(() => {
  vi.useRealTimers();
});

describe("GET /v1/trips?active=true", () => {
  it("lists the trips under way and none planning, soon, ended or undated", async () => {
    const active = await listedIds(secret, "?active=true");
    expect(active.sort()).toEqual([trips.underway.tripId, trips.tonga.tripId].sort());
  });

  it("counts a trip under way by its own zone, where UTC is still the day before", async () => {
    // On UTC's calendar the Tonga trip starts tomorrow, which is *soon*.
    expect(await listedIds(secret, "?active=true")).toContain(trips.tonga.tripId);
  });

  it("counts a trip under way by its own zone, where UTC is already the day after", async () => {
    // 05:00 on 10 March in UTC is 19:00 on 9 March in Honolulu (UTC-10 all
    // year), the trip's last day there.
    vi.setSystemTime(Date.parse("2027-03-10T05:00:00.000Z"));
    try {
      const alone = await tokenFor(await entitled());
      const oahu = await trip(alone, "Oahu", { startDate: "2027-03-08", endDate: "2027-03-09" });
      await stop(alone, oahu.tripId, { title: "Harbor", dayId: oahu.days[1]!.dayId, location: HONOLULU });
      expect(await listedIds(alone, "?active=true")).toEqual([oahu.tripId]);
    } finally {
      vi.setSystemTime(AT);
    }
  });

  it("pages the active trips with the list's own cursor, to a null cursor at the end", async () => {
    const first = await listed(secret, "?active=true&limit=1");
    expect(first.ids).toHaveLength(1);
    const second = await listed(secret, `?active=true&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect([...first.ids, ...second.ids].sort()).toEqual([trips.underway.tripId, trips.tonga.tripId].sort());
    const third = await listed(secret, `?active=true&limit=1&cursor=${encodeURIComponent(second.nextCursor!)}`);
    expect(third).toEqual({ ids: [], nextCursor: null });
  });

  it("stops a scan at its batch cap with a cursor that resumes it, skipping nothing", async () => {
    const many = await tokenFor(await entitled());
    // Oldest, so the list reaches it last: after a dozen trips not under way.
    vi.setSystemTime(AT - 60_000);
    const lisbon = await trip(many, "Lisbon again", { startDate: "2027-03-08", endDate: "2027-03-12" });
    vi.setSystemTime(AT);
    for (let i = 0; i < 12; i++) await trip(many, `Later ${i}`, { startDate: "2027-04-01", endDate: "2027-04-02" });

    const capped = await listed(many, "?active=true");
    expect(capped.ids).toEqual([]);
    expect(capped.nextCursor).not.toBeNull();
    expect(await listed(many, `?active=true&cursor=${encodeURIComponent(capped.nextCursor!)}`)).toEqual({
      ids: [lisbon.tripId],
      nextCursor: null,
    });
  });

  it("lists every trip without the filter, as before", async () => {
    expect(await listedIds(secret, "?active=false")).toHaveLength(6);
    expect(await listedIds(secret, "")).toHaveLength(6);
  });
});

describe("GET /v1/trips/{tripId}/today", () => {
  it("answers today's stops in order, and the same now and next as tripNow", async () => {
    const res = await today(secret, trips.underway.tripId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      date: "2027-03-09",
      timeZone: "UTC",
      phase: "underway",
      dayId: trips.underway.days[1]!.dayId,
      now: stops.dinner,
      next: stops.bar,
    });
    expect(body.stops.map((s: { activityId: string }) => s.activityId)).toEqual([stops.walk, stops.bar, stops.dinner]);
    expect(body.stops[1]).toMatchObject({ title: "Bar", timeWindow: { start: "21:30", end: "23:00" } });

    const detail = trips.underway;
    const expected = tripNow(detail, buildTripGlobals(detail), { at: AT, deviceZone: "UTC" });
    expect([body.now, body.next]).toEqual([expected.current?.activityId, expected.next?.activityId]);
  });

  it("reads a day with no zone of its own on the asker's zone, and refuses one that is not a zone", async () => {
    const res = await today(secret, trips.underway.tripId, "?timeZone=Pacific%2FTongatapu");
    expect(await res.json()).toMatchObject({ date: "2027-03-10", timeZone: "Pacific/Tongatapu", dayId: trips.underway.days[2]!.dayId, stops: [] });
    expect((await today(secret, trips.underway.tripId, "?timeZone=Mars%2FOlympus")).status).toBe(400);
  });

  it("answers off the trip's days with its phase and no stops, and nothing next before it starts", async () => {
    const res = await today(secret, trips.soon.tripId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ phase: "soon", dayId: null, stops: [], now: null, next: null });
  });

  it("answers a viewer", async () => {
    const viewer = await entitled();
    await grantMembership(db, { tripId: trips.underway.tripId, userId: viewer, role: "viewer", invitedBy: owner, now: new Date().toISOString() });
    const res = await today(await tokenFor(viewer), trips.underway.tripId);
    expect(res.status).toBe(200);
    expect((await res.json()).now).toBe(stops.dinner);
  });

  it("refuses a non-member as the rest of the API does", async () => {
    const res = await today(await tokenFor(await entitled()), trips.underway.tripId);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });
});
