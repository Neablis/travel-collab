import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { rateLimitCounters } from "@/server/db/schema";

// Real Postgres (the quota counter is the whole point of this file), fake
// everything the route would otherwise reach out to: no session, no
// LOCATIONIQ_API_KEY, no vendor call.
let currentUserId = "geo-user";
let forwardCalls = 0;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

vi.mock("@/server/geocoding", () => ({
  getGeocoder: () => ({
    forward: async () => {
      forwardCalls += 1;
      return [{ lat: 41.9, lng: 12.5, canonicalName: "Rome, Italy" }];
    },
  }),
}));

const { GET } = await import("./route");

const req = (q: string) => new Request(`http://test/api/geocode?q=${encodeURIComponent(q)}`);

beforeEach(async () => {
  // Only this table — see quota.int.test.ts.
  await db.delete(rateLimitCounters);
  currentUserId = "geo-user";
  forwardCalls = 0;
  vi.unstubAllEnvs();
});

describe("GET /api/geocode", () => {
  it("serves a normal single search", async () => {
    const res = await GET(req("Rome"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      results: [{ lat: 41.9, lng: 12.5, canonicalName: "Rome, Italy" }],
    });
  });

  it("still 401s before it charges anyone's quota", async () => {
    currentUserId = "";
    expect((await GET(req("Rome"))).status).toBe(401);
    expect(await db.select().from(rateLimitCounters)).toHaveLength(0);
  });

  // L4: any signed-in account could burn the LocationIQ daily quota.
  it("refuses the request past the per-user ceiling, and stops calling the vendor", async () => {
    vi.stubEnv("GEOCODE_RATE_LIMIT_PER_USER_DAILY", "2");
    expect((await GET(req("Rome"))).status).toBe(200);
    expect((await GET(req("Milan"))).status).toBe(200);

    const refused = await GET(req("Naples"));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(forwardCalls).toBe(2);

    // The ceiling is per user, not per deployment.
    currentUserId = "someone-else";
    expect((await GET(req("Naples"))).status).toBe(200);
  });

  it("does not charge the quota for an empty query, which contacts no vendor", async () => {
    const res = await GET(new Request("http://test/api/geocode?q=%20%20"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
    expect(await db.select().from(rateLimitCounters)).toHaveLength(0);
  });
});
