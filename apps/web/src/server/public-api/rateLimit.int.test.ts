// **Token traffic is rate limited; session traffic is not** (Decision 8).
//
// Separate from `route.int.test.ts` because it mocks `consumeQuota`, and a file
// that mocks the quota module cannot also assert the real paths around it.
//
// **The ceiling itself is not exercised by making 1,000 calls.** That would be a
// slow test of `quota.ts`, which has its own. What matters here is the seam: the
// wrapper charges a token's bucket and not a session's, and it renders the two
// refusals — 429 and the fail-closed 503 — with the headers a caller needs.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { executeTripCommand } from "@/server/commands";
import type { QuotaDecision } from "@/server/quota";

let decision: QuotaDecision = { allowed: true };
const consumeQuota = vi.fn(async () => decision);
vi.mock("@/server/quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/quota")>()),
  consumeQuota: (...args: unknown[]) => consumeQuota(...(args as [])),
}));

// Counts calls without replacing behaviour: the success-path tests below still
// need the real gate to answer, so this delegates rather than stubs.
const tripAccessCalls = vi.fn();
vi.mock("@/server/access/trip-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/access/trip-access")>();
  return {
    ...actual,
    tripAccessFor: (...args: Parameters<typeof actual.tripAccessFor>) => {
      tripAccessCalls(...args);
      return actual.tripAccessFor(...args);
    },
  };
});

let sessionUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (sessionUserId === null ? null : { user: { id: sessionUserId } })),
}));

const { GET: GET_TRIP } = await import("@/app/api/v1/trips/[tripId]/route");

const RUN = randomUUID().slice(0, 8);

async function entitledWithTrip() {
  const id = `v1rl-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M22 rate-limit fixture.",
    expiresAt: null,
  });
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, id)).ok).toBe(true);
  const minted = await mintToken(id, {
    name: "rl",
    scopes: ["trips:read"],
    tripIds: null,
    expiresInDays: 30,
  });
  return { id, tripId, secret: minted.ok ? minted.created.secret : "" };
}

const get = (tripId: string, secret?: string) => [
  new Request("http://localhost/x", {
    headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
  }),
  { params: Promise.resolve({ tripId }) },
] as const;

describe("the rate limit keys on the token", () => {
  it("charges a token's bucket, and charges nothing for a session", async () => {
    const { id, tripId, secret } = await entitledWithTrip();
    decision = { allowed: true };

    consumeQuota.mockClear();
    expect((await GET_TRIP(...get(tripId, secret))).status).toBe(200);
    expect(consumeQuota).toHaveBeenCalledOnce();

    // **Session traffic is untouched**, because it keys on a token id a session
    // does not have. The frontend's own calls must not eat an API allowance.
    consumeQuota.mockClear();
    sessionUserId = id;
    try {
      expect((await GET_TRIP(...get(tripId))).status).toBe(200);
      expect(consumeQuota).not.toHaveBeenCalled();
    } finally {
      sessionUserId = null;
    }
  });

  it("answers 429 with Retry-After when the caller is over their ceiling", async () => {
    const { tripId, secret } = await entitledWithTrip();
    decision = { allowed: false, reason: "user", retryAfterSeconds: 42 };
    const res = await GET_TRIP(...get(tripId, secret));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect((await res.json()).error.code).toBe("rate-limited");
  });

  // **Fail closed when the counter store itself is down.** A rate limiter that
  // opens under load is not a rate limiter — `quota.ts` already made this call
  // and the wrapper inherits it rather than re-deciding.
  it("answers 503, not 200, when the counter store fails", async () => {
    const { tripId, secret } = await entitledWithTrip();
    decision = { allowed: false, reason: "unavailable", retryAfterSeconds: 60 };
    const res = await GET_TRIP(...get(tripId, secret));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await res.json()).error.code).toBe("service-unavailable");
  });

  // The charge happens BEFORE the work, so a request that is refused costs the
  // database nothing beyond the counter.
  it("refuses before touching the trip", async () => {
    const { tripId, secret } = await entitledWithTrip();
    decision = { allowed: false, reason: "global", retryAfterSeconds: 5 };
    tripAccessCalls.mockClear();
    const res = await GET_TRIP(...get(tripId, secret));
    expect(res.status).toBe(429);
    // A 429 body is the envelope, never a trip.
    expect(await res.json()).not.toHaveProperty("tripId");
    // **The actual claim.** "Never a trip in the body" holds for any 429 the
    // wrapper renders, including one rendered after two membership queries had
    // already run — so it could not tell a limiter that charges first from one
    // that charges last. The gate itself is what must not have been reached.
    expect(tripAccessCalls).not.toHaveBeenCalled();
  });
});
