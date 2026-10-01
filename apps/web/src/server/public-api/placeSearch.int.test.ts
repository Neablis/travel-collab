// **`GET /v1/geocode` — the tripless place search** (Mitchell, 2026-09-30),
// driven as real HTTP through `route()` against a real database, with only the
// vendor mocked.
//
// What this file proves is the spend: who may search (`places:read`, an
// account-wide token), which counters a search charges (the token's own day AND
// the account's geocode day), that a search for nothing charges neither, and
// that the per-token ceiling refuses on its own.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { dailyPolicy, geocodeQuota, peekQuota, placeSearchTokenQuota } from "@/server/quota";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// The vendor seam (ADR-007), replaced wholesale — never the real LocationIQ.
const forward = vi.fn(async () => [] as unknown[]);
const forwardAddress = vi.fn(async () => [] as unknown[]);
vi.mock("@/server/geocoding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocoding")>()),
  getGeocoder: () => ({ forward, forwardAddress }),
}));

const { GET: SEARCH } = await import("@/app/api/v1/geocode/route");
const { POST: CREATE_TRIP } = await import("@/app/api/v1/trips/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };

const KYOTO = {
  lat: 34.9858,
  lng: 135.7588,
  canonicalName: "Kyoto Station, Shimogyo Ward, Kyoto, Japan",
  countryCode: "JP",
  city: "Kyoto",
  area: "Shimogyo",
};

async function entitled(): Promise<string> {
  const id = `v1place-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "v1 place search fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(owner: string, scopes: string[], tripIds: string[] | null = null) {
  const minted = await mintToken(owner, {
    name: "place search",
    scopes: scopes as Parameters<typeof mintToken>[1]["scopes"],
    tripIds,
    expiresInDays: 30,
  });
  if (!minted.ok) throw new Error(`mint refused: ${minted.reason}`);
  return { secret: minted.created.secret, tokenId: minted.created.token.tokenId };
}

const search = (secret: string, query: string) =>
  SEARCH(
    new Request(`http://localhost/api/v1/geocode?${query}`, { headers: { authorization: `Bearer ${secret}` } }),
    NO_PARAMS,
  );

const geocodeUsed = async (owner: string) => (await peekQuota(dailyPolicy(geocodeQuota()), owner)).used;
const tokenUsed = async (tokenId: string) => (await peekQuota(dailyPolicy(placeSearchTokenQuota()), tokenId)).used;

beforeEach(() => {
  forward.mockReset();
  forwardAddress.mockReset();
  forward.mockResolvedValue([KYOTO]);
  vi.unstubAllEnvs();
});

describe("GET /v1/geocode", () => {
  it("answers up to five candidate locations, and charges the token's day and the account's geocode day once each", async () => {
    const owner = await entitled();
    const { secret, tokenId } = await tokenFor(owner, ["places:read"]);

    const res = await search(secret, "q=Kyoto%20Station&countryCode=JP");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        {
          name: "Kyoto Station, Shimogyo Ward, Kyoto, Japan",
          lat: 34.9858,
          lng: 135.7588,
          countryCode: "JP",
          city: "Kyoto",
          area: "Shimogyo",
        },
      ],
    });
    expect(forward).toHaveBeenCalledWith("Kyoto Station", { limit: 5, countryCode: "JP" });
    expect(await geocodeUsed(owner)).toBe(1);
    expect(await tokenUsed(tokenId)).toBe(1);
  });

  it("refuses a token without places:read, before any lookup or charge", async () => {
    const owner = await entitled();
    const { secret } = await tokenFor(owner, ["trips:read", "trips:write"]);

    const res = await search(secret, "q=Kyoto");

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({ code: "insufficient-scope", details: { required: "places:read" } });
    expect(forward).not.toHaveBeenCalled();
    expect(await geocodeUsed(owner)).toBe(0);
  });

  // Tripless, so a token confined to named trips is refused like on every
  // other tripless endpoint; it has the trip-scoped search for its own trips.
  it("refuses a token confined to specific trips", async () => {
    const owner = await entitled();
    const writer = await tokenFor(owner, ["trips:write"]);
    const created = await CREATE_TRIP(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { authorization: `Bearer ${writer.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Kyoto" }),
      }),
      NO_PARAMS,
    );
    const { tripId } = (await created.json()) as { tripId: string };
    const { secret } = await tokenFor(owner, ["places:read"], [tripId]);

    const res = await search(secret, "q=Kyoto");

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("trip-out-of-scope");
    expect(forward).not.toHaveBeenCalled();
  });

  it("answers an empty q with no results, no lookup and no charge", async () => {
    const owner = await entitled();
    const { secret, tokenId } = await tokenFor(owner, ["places:read"]);

    for (const query of ["q=", "q=%20%20"]) {
      const res = await search(secret, query);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    }

    expect(forward).not.toHaveBeenCalled();
    expect(await geocodeUsed(owner)).toBe(0);
    expect(await tokenUsed(tokenId)).toBe(0);
  });

  it("refuses past the per-token ceiling with a 429 and Retry-After, and the owner's other token still searches", async () => {
    // `consumeQuota` refuses on `count > ceiling` after incrementing, so "1"
    // means exactly one search per token.
    vi.stubEnv("PLACE_SEARCH_RATE_LIMIT_PER_TOKEN_DAILY", "1");
    const owner = await entitled();
    const first = await tokenFor(owner, ["places:read"]);
    const second = await tokenFor(owner, ["places:read"]);

    expect((await search(first.secret, "q=Kyoto")).status).toBe(200);
    const refused = await search(first.secret, "q=Kyoto");

    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).not.toBeNull();
    expect((await refused.json()).error).toMatchObject({ code: "rate-limited", message: expect.stringContaining("token") });
    expect(forward).toHaveBeenCalledTimes(1);
    // Per token, not per person: the owner's allowance is not what ran out.
    expect(await geocodeUsed(owner)).toBe(1);
    expect((await search(second.secret, "q=Kyoto")).status).toBe(200);
  });

  it("still counts against the account's own geocode allowance, across every token it holds", async () => {
    vi.stubEnv("GEOCODE_RATE_LIMIT_PER_USER_DAILY", "1");
    const owner = await entitled();
    const first = await tokenFor(owner, ["places:read"]);
    const second = await tokenFor(owner, ["places:read"]);

    expect((await search(first.secret, "q=Kyoto")).status).toBe(200);
    const refused = await search(second.secret, "q=Kyoto");

    expect(refused.status).toBe(429);
    expect((await refused.json()).error.message).toContain("account");
    expect(forward).toHaveBeenCalledTimes(1);
  });
});
