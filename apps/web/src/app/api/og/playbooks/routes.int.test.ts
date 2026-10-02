import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SavedDayVisibility } from "@tc/contracts";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail } from "@/server/projections";
import { saveDay, setSavedDayVisibility } from "@/server/savedDays";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { GET as genericImage } from "./route";
import { GET as dayImage } from "./day/[savedDayId]/route";
import { GET as dayMeta } from "./day/[savedDayId]/meta/route";
import { GET as profileImage } from "./profile/[userId]/route";
import { GET as profileMeta } from "./profile/[userId]/meta/route";
import { GET as cityImage } from "./city/[city]/route";
import { GET as cityMeta } from "./city/[city]/meta/route";

// The Playbooks preview routes (spec 2026-10-02 §2.7): every input answers a
// real 1200×630 PNG, and the `meta` sibling carries the words beside it. What
// the lookups decide is `server/og/playbooks.int.test.ts`; this is what leaves
// over HTTP.

const run = randomUUID().slice(0, 8);
const OWNER = `dev-og-pb-routes-${run}`;
// A space, so the `meta` test below proves the segment is decoded.
const CITY = `Osaka Bay ${run}`;
// What the library calls "Dana Reyes" (Mitchell, 2026-10-02).
const PUBLIC_NAME = "Dana R.";
const GENERIC = {
  title: "Playbooks on Caesura",
  description: "Days other people planned and rated. Find one for your city and drop it into your trip.",
};
const HOUR = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=604800";
const DAY = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

let published = "";
let privateDay = "";

const request = new Request("http://test/api/og/playbooks");
const withDay = (savedDayId: string) => ({ params: Promise.resolve({ savedDayId }) });
const withUser = (userId: string) => ({ params: Promise.resolve({ userId }) });
const withCity = (city: string) => ({ params: Promise.resolve({ city }) });

/** The width and height a PNG declares in its IHDR chunk. */
async function pngSize(response: Response): Promise<{ width: number; height: number }> {
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function seedDay(name: string, visibility: SavedDayVisibility): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, OWNER);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  const added = await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Castle at opening",
      timeWindow: { start: "09:00", end: "10:00" },
      location: { name: "The castle", city: CITY },
    },
    OWNER,
  );
  if (!added.ok) throw new Error("failed to seed a stop");
  const detail = await getTripDetail(tripId);
  if (detail === null) throw new Error("no trip");
  const saved = await saveDay({ name, dayIds: [dayId] }, detail, OWNER);
  if (!saved.ok) throw new Error(saved.error.message);
  await setSavedDayVisibility(saved.value.savedDayId, OWNER, visibility);
  return saved.value.savedDayId;
}

beforeAll(async () => {
  await entitleAccounts([OWNER]);
  await db
    .update(users)
    .set({ name: "Dana Reyes", displayName: "Dana Reyes", email: "dana@example.com" })
    .where(eq(users.id, OWNER));
  published = await seedDay("Castle and canals", SavedDayVisibility.enum.public);
  privateDay = await seedDay("Not for sharing", SavedDayVisibility.enum.private);
});

describe("the Playbooks preview images", () => {
  it.each([
    ["a published day", () => dayImage(request, withDay(published)), HOUR],
    ["a private day", () => dayImage(request, withDay(privateDay)), HOUR],
    ["a profile", () => profileImage(request, withUser(OWNER)), HOUR],
    ["a city with days", () => cityImage(request, withCity(CITY)), DAY],
    ["a city with none", () => cityImage(request, withCity(`Nowhere${run}`)), DAY],
    ["the generic card", () => genericImage(request), DAY],
    ["the board", () => genericImage(new Request("http://test/api/og/playbooks?board=1")), DAY],
  ])("draws %s as a 1200×630 PNG with its cache header", async (_state, call, cacheControl) => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(cacheControl);
    expect(await pngSize(response)).toEqual({ width: 1200, height: 630 });
  });
});

describe("GET /api/og/playbooks/day/:savedDayId/meta", () => {
  it("titles a published day with its name, by the author's public name", async () => {
    const response = await dayMeta(request, withDay(published));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(HOUR);
    expect(await response.json()).toEqual({ title: "Castle and canals", description: `${CITY} · 1 stop · by ${PUBLIC_NAME}` });
  });

  it("answers a private day with the generic words and a 200, naming nobody", async () => {
    const response = await dayMeta(request, withDay(privateDay));

    expect(response.status).toBe(200);
    const body = (await response.json()) as typeof GENERIC;
    expect(body).toEqual(GENERIC);
    expect(JSON.stringify(body)).not.toContain("Not for sharing");
  });
});

describe("GET /api/og/playbooks/profile/:userId/meta", () => {
  it("titles a profile by public name, never by the surname or address", async () => {
    const response = await profileMeta(request, withUser(OWNER));

    const body = (await response.json()) as typeof GENERIC;
    expect(body).toEqual({ title: `${PUBLIC_NAME}'s playbooks`, description: `1 playbook · knows ${CITY}` });
    for (const leak of ["Reyes", "dana@"]) expect(JSON.stringify(body)).not.toContain(leak);
  });
});

describe("GET /api/og/playbooks/city/:city/meta", () => {
  it("titles a city with published days, decoding the segment once", async () => {
    const response = await cityMeta(request, withCity(encodeURIComponent(CITY)));

    expect(response.headers.get("cache-control")).toBe(DAY);
    expect(await response.json()).toEqual({
      title: `${CITY} playbooks`,
      description: `1 day a traveler planned in ${CITY}`,
    });
  });

  it("prints no text a URL made up", async () => {
    const response = await cityMeta(request, withCity(encodeURIComponent("Free money, click here")));

    expect(await response.json()).toEqual(GENERIC);
  });
});

describe("the per-IP rate limit on the Playbooks preview routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // `app/api/og/routes.int.test.ts`'s construction: `Date` pinned mid-window,
  // so three requests cannot straddle a minute boundary and pass by accident.
  it.each([
    ["generic image", (req: Request) => genericImage(req)],
    ["day image", (req: Request) => dayImage(req, withDay(published))],
    ["day meta", (req: Request) => dayMeta(req, withDay(published))],
    ["profile image", (req: Request) => profileImage(req, withUser(OWNER))],
    ["profile meta", (req: Request) => profileMeta(req, withUser(OWNER))],
    ["city image", (req: Request) => cityImage(req, withCity(CITY))],
    ["city meta", (req: Request) => cityMeta(req, withCity(CITY))],
  ])("refuses the %s past the ceiling with an uncacheable 429, per IP", async (_route, call) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T12:00:30.000Z"));
    vi.stubEnv("LINK_PREVIEW_RATE_LIMIT_PER_IP_MINUTE", "2");
    const ip = `ip-${randomUUID()}`;
    const from = (address: string) =>
      new Request("http://test/api/og/playbooks", { headers: { "x-forwarded-for": `${address}, 10.0.0.1` } });

    expect((await call(from(ip))).status).toBe(200);
    expect((await call(from(ip))).status).toBe(200);
    const refused = await call(from(ip));

    expect(refused.status).toBe(429);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect((await call(from(`other-${ip}`))).status).toBe(200);
  });
});
