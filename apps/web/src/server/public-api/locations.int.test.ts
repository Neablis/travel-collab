// **A v1 stop write resolves its location before the command runs**, driven as
// real HTTP against a real database with only the vendor mocked.
//
// `locations.test.ts` already covers the resolution order in isolation. What
// this file proves is the wiring the unit test cannot see: that the outcome
// reaches the caller as a response header through `route()`, that a lookup
// failure still creates the stop, and that a `location` the caller did not send
// costs nothing.
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { dailyPolicy, geocodeQuota, peekQuota } from "@/server/quota";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// The vendor seam (ADR-007), replaced wholesale. `defaultResolveDeps` holds
// `getGeocoder` itself, so mocking the module is what reaches it.
const forward = vi.fn(async () => [] as unknown[]);
const forwardAddress = vi.fn(async () => [] as unknown[]);
vi.mock("@/server/geocoding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocoding")>()),
  getGeocoder: () => ({ forward, forwardAddress }),
}));

const { POST: CREATE_TRIP } = await import("@/app/api/v1/trips/route");
const { POST: ADD_DAY } = await import("@/app/api/v1/trips/[tripId]/days/route");
const { POST: ADD_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/route");
const { PATCH: PATCH_STOP } = await import(
  "@/app/api/v1/trips/[tripId]/activities/[activityId]/route"
);
const { GET: GEOCODE } = await import("@/app/api/v1/trips/[tripId]/geocode/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function entitled(): Promise<string> {
  const id = `v1loc-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "v1 location resolution fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(owner: string, scopes: string[]): Promise<string> {
  const minted = await mintToken(owner, {
    name: "locations",
    scopes: scopes as Parameters<typeof mintToken>[1]["scopes"],
    tripIds: null,
    expiresInDays: 30,
  });
  expect(minted.ok).toBe(true);
  return minted.ok ? minted.created.secret : "";
}

const req = (secret: string, body?: unknown, method = "GET") =>
  new Request("http://localhost/x", {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A trip with one day and no stops, built entirely through v1. */
async function seed(secret: string) {
  const created = await CREATE_TRIP(req(secret, { name: "Heidelberg" }, "POST"), NO_PARAMS);
  expect(created.status).toBe(201);
  const tripId = (await created.json()).tripId as string;

  const withDay = await ADD_DAY(req(secret, {}, "POST"), P({ tripId }));
  expect(withDay.status).toBe(201);
  const dayId = (await withDay.json()).days[0].dayId as string;
  return { tripId, dayId };
}

async function caller() {
  const secret = await tokenFor(await entitled(), ["trips:read", "trips:write"]);
  return { secret, ...(await seed(secret)) };
}

const HEIDELBERG = {
  lat: 49.41,
  lng: 8.69,
  canonicalName: "Hauptstraße 5, Heidelberg",
  countryCode: "DE",
  city: "Heidelberg",
};

beforeEach(() => {
  forward.mockReset();
  forwardAddress.mockReset();
  forward.mockResolvedValue([]);
  forwardAddress.mockResolvedValue([]);
});

describe("v1 stop writes resolve their location", () => {
  it("POST with an address and no coordinates stores geocoded coordinates and the address, and says so", async () => {
    const { secret, tripId, dayId } = await caller();
    forwardAddress.mockResolvedValueOnce([HEIDELBERG]);
    const address = {
      countryCode: "DE",
      lines: ["Hauptstraße 5"],
      locality: "Heidelberg",
      postalCode: "69117",
    };

    const res = await ADD_STOP(
      req(secret, { title: "Dinner", dayId, location: { name: "Dinner", address } }, "POST"),
      P({ tripId }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Geocode-Outcome")).toBe("address");
    const detail = await res.json();
    const stop = Object.values(detail.activities)[0] as { location: Record<string, unknown> };
    expect(stop.location).toMatchObject({ name: "Dinner", lat: 49.41, lng: 8.69, address });
    expect(forward).not.toHaveBeenCalled();
  });

  it("POST with coordinates never calls the geocoder", async () => {
    const { secret, tripId } = await caller();

    const res = await ADD_STOP(
      req(secret, { title: "Pin", location: { name: "Pin", lat: 35, lng: 135 } }, "POST"),
      P({ tripId }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Geocode-Outcome")).toBe("provided");
    expect(res.headers.get("Geocode-Outcome-End")).toBeNull();
    expect(forward).not.toHaveBeenCalled();
    expect(forwardAddress).not.toHaveBeenCalled();
  });

  // A geocoding failure never fails a stop write (plan, Global Constraints).
  it("a geocode miss still creates the stop, without coordinates, flagged no-match", async () => {
    const { secret, tripId } = await caller();
    forward.mockResolvedValueOnce([]);

    const res = await ADD_STOP(
      req(secret, { title: "Mystery", location: { name: "Nowhere-at-all" } }, "POST"),
      P({ tripId }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Geocode-Outcome")).toBe("no-match");
    const stop = Object.values((await res.json()).activities)[0] as {
      location: Record<string, unknown>;
    };
    expect(stop.location.lat).toBeUndefined();
  });

  // M24 decision (Mitchell, 2026-09-25): `Geocode-Outcome` keeps meaning the
  // outcome for `location`, and a transit stop's `endLocation` answers in its
  // own header — sent only when the body carried one.
  it("POST with an endLocation resolves it too and answers in Geocode-Outcome-End, leaving Geocode-Outcome to `location`", async () => {
    const { secret, tripId, dayId } = await caller();
    forward.mockResolvedValueOnce([HEIDELBERG]);

    const res = await ADD_STOP(
      req(
        secret,
        {
          title: "Train to Heidelberg",
          dayId,
          kind: "transit",
          mode: "train",
          location: { name: "Frankfurt Hbf", lat: 50.107, lng: 8.663 },
          endLocation: { name: "Heidelberg Hbf" },
        },
        "POST",
      ),
      P({ tripId }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("Geocode-Outcome")).toBe("provided");
    expect(res.headers.get("Geocode-Outcome-End")).toBe("name");
    const stop = Object.values((await res.json()).activities)[0] as Record<string, unknown>;
    expect(stop).toMatchObject({ mode: "train", endLocation: { name: "Heidelberg Hbf", lat: 49.41, lng: 8.69 } });
  });

  it("a stop with no location sends no Geocode-Outcome header and spends nothing", async () => {
    const { secret, tripId } = await caller();

    const res = await ADD_STOP(req(secret, { title: "Free time" }, "POST"), P({ tripId }));

    expect(res.status).toBe(201);
    expect(res.headers.get("Geocode-Outcome")).toBeNull();
    expect(forward).not.toHaveBeenCalled();
    expect(forwardAddress).not.toHaveBeenCalled();
  });

  it("PATCH with a new name-only location geocodes it; PATCH location:null clears without a lookup", async () => {
    const { secret, tripId, dayId } = await caller();
    const created = await ADD_STOP(req(secret, { title: "Somewhere", dayId }, "POST"), P({ tripId }));
    expect(created.status).toBe(201);
    const activityId = Object.keys((await created.json()).activities)[0] as string;

    forward.mockResolvedValueOnce([HEIDELBERG]);
    const patched = await PATCH_STOP(
      req(secret, { location: { name: "Heidelberg Castle" } }, "PATCH"),
      P({ tripId, activityId }),
    );
    expect(patched.status).toBe(200);
    expect(patched.headers.get("Geocode-Outcome")).toBe("name");
    expect((await patched.json()).activities[activityId].location).toMatchObject({
      name: "Heidelberg Castle",
      lat: 49.41,
      lng: 8.69,
    });

    const cleared = await PATCH_STOP(
      req(secret, { location: null }, "PATCH"),
      P({ tripId, activityId }),
    );
    expect(cleared.status).toBe(200);
    expect(cleared.headers.get("Geocode-Outcome")).toBeNull();
    expect(forward).toHaveBeenCalledTimes(1);
  });

  // The lookup already happened and was already charged, so the header is
  // still the truth about the location even though the write did not land.
  // This is also the path Task 5's `Retry-After` rides on: `route()` carries
  // `responseHeaders` onto a deliberate `PublicApiError` refusal.
  it("a stop the domain refuses still reports the outcome of the lookup it already paid for", async () => {
    const { secret, tripId } = await caller();
    forward.mockResolvedValueOnce([HEIDELBERG]);

    const res = await ADD_STOP(
      req(
        secret,
        { title: "Orphan", dayId: randomUUID(), location: { name: "Heidelberg Castle" } },
        "POST",
      ),
      P({ tripId }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get("Geocode-Outcome")).toBe("name");
    expect(forward).toHaveBeenCalledTimes(1);
  });

  // The refine on `Location` is body validation, so it is refused before
  // anything is charged or looked up.
  it("a mismatched countryCode/address is a 400 before any lookup", async () => {
    const { secret, tripId } = await caller();

    const res = await ADD_STOP(
      req(
        secret,
        {
          title: "X",
          location: { name: "X", countryCode: "FR", address: { countryCode: "GB", lines: ["1 A St"] } },
        },
        "POST",
      ),
      P({ tripId }),
    );

    expect(res.status).toBe(400);
    expect(forwardAddress).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  // M24. A leg on a stop that is not transit is refused by the command schema,
  // and the body alone decides it — so nothing is looked up or charged for a
  // write that could never land. The quota row is read as well as the mock,
  // because the charge comes before the vendor call.
  it("POST with a travel leg on a non-transit stop is a 400 before any lookup or charge", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId } = await seed(secret);

    const res = await ADD_STOP(
      req(
        secret,
        { title: "Walk", dayId, mode: "walk", location: { name: "Old Bridge" }, endLocation: { name: "Castle" } },
        "POST",
      ),
      P({ tripId }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("mode is only allowed on a transit stop");
    expect(res.headers.get("Geocode-Outcome")).toBeNull();
    expect(res.headers.get("Geocode-Outcome-End")).toBeNull();
    expect(forward).not.toHaveBeenCalled();
    expect(forwardAddress).not.toHaveBeenCalled();
    expect((await peekQuota(dailyPolicy(geocodeQuota()), owner)).used).toBe(0);
  });

  // PATCH can decide it up front only when the body states the kind itself; a
  // body without `kind` depends on the stored stop and is the decider's.
  it("PATCH stating a non-transit kind beside a travel leg is a 400 before any lookup or charge", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId } = await seed(secret);
    const created = await ADD_STOP(req(secret, { title: "Somewhere", dayId }, "POST"), P({ tripId }));
    expect(created.status).toBe(201);
    const activityId = Object.keys((await created.json()).activities)[0] as string;

    const res = await PATCH_STOP(
      req(secret, { kind: "hold", location: { name: "Old Bridge" }, endLocation: { name: "Castle" } }, "PATCH"),
      P({ tripId, activityId }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("endLocation is only allowed on a transit stop");
    expect(res.headers.get("Geocode-Outcome")).toBeNull();
    expect(res.headers.get("Geocode-Outcome-End")).toBeNull();
    expect(forward).not.toHaveBeenCalled();
    expect((await peekQuota(dailyPolicy(geocodeQuota()), owner)).used).toBe(0);
  });
});

// **The same lookup, exposed** (plan Task 5, decision 7). Trip-scoped because
// `route()` refuses a trip-scoped token on an endpoint with no trip, and that is
// the credential an agent building one trip holds. What this file proves that a
// unit test cannot: a candidate comes back `Location`-shaped and is accepted by
// `POST /activities` unchanged, and the quota refusal reaches the caller as a
// 429 with `Retry-After`.
describe("GET /v1/trips/{tripId}/geocode", () => {
  let owner = "";
  let secret = "";
  let tripId = "";

  beforeAll(async () => {
    owner = await entitled();
    secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    ({ tripId } = await seed(secret));
  });

  const geocodeReq = (token: string, qs: string) =>
    new Request(`http://localhost/x?${qs}`, { headers: { authorization: `Bearer ${token}` } });

  it("returns Location-shaped candidates that POST /activities accepts unchanged", async () => {
    forward.mockResolvedValueOnce([HEIDELBERG]);

    const res = await GEOCODE(geocodeReq(secret, "q=Heidelberg&countryCode=DE"), P({ tripId }));

    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results[0]).toEqual({
      name: "Hauptstraße 5, Heidelberg",
      lat: 49.41,
      lng: 8.69,
      countryCode: "DE",
      city: "Heidelberg",
    });
    expect(forward).toHaveBeenCalledWith(
      "Heidelberg",
      expect.objectContaining({ limit: 5, countryCode: "DE" }),
    );

    const stop = await ADD_STOP(req(secret, { title: "Castle", location: results[0] }, "POST"), P({ tripId }));
    expect(stop.status).toBe(201);
    expect(stop.headers.get("Geocode-Outcome")).toBe("provided");
  });

  it("works with a trip-scoped token (the kind an agent is usually handed)", async () => {
    const minted = await mintToken(owner, {
      name: "agent",
      scopes: ["trips:write"],
      tripIds: [tripId],
      expiresInDays: 30,
    });
    expect(minted.ok).toBe(true);
    forward.mockResolvedValueOnce([HEIDELBERG]);

    const res = await GEOCODE(geocodeReq(minted.ok ? minted.created.secret : "", "q=Heidelberg"), P({ tripId }));

    expect(res.status).toBe(200);
  });

  it("a read-only token is refused: looking up spends the operator's allowance", async () => {
    const readOnly = await tokenFor(owner, ["trips:read"]);

    const res = await GEOCODE(geocodeReq(readOnly, "q=Heidelberg"), P({ tripId }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("insufficient-scope");
    expect(forward).not.toHaveBeenCalled();
  });

  it("empty q is a 400 and spends nothing", async () => {
    const res = await GEOCODE(geocodeReq(secret, "q="), P({ tripId }));

    expect(res.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  // `Location.name` maxes at 200 and a vendor's `display_name` does not — a
  // full Nominatim label routinely runs past it. Without the truncation the
  // response fails its own schema on the way out and `route()` answers 500, so
  // one long label from the vendor would break a lookup that worked.
  it("truncates a vendor label longer than Location.name allows, instead of 500ing", async () => {
    forward.mockResolvedValueOnce([{ ...HEIDELBERG, canonicalName: "H".repeat(250) }]);

    const res = await GEOCODE(geocodeReq(secret, "q=Heidelberg"), P({ tripId }));

    expect(res.status).toBe(200);
    expect((await res.json()).results[0].name).toBe("H".repeat(200));
  });

  it("a vendor failure is a 503, not a 500", async () => {
    forward.mockRejectedValueOnce(new Error("locationiq is down"));

    const res = await GEOCODE(geocodeReq(secret, "q=Heidelberg"), P({ tripId }));

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("service-unavailable");
  });

  it("a spent geocode quota is a 429 with Retry-After", async () => {
    // `envCeiling` reads the env var per call and `consumeQuota` refuses on
    // `count > ceiling` after incrementing, so "1" means exactly one lookup.
    const fresh = await entitled();
    const token = await tokenFor(fresh, ["trips:read", "trips:write"]);
    const { tripId: freshTrip } = await seed(token);
    forward.mockResolvedValue([HEIDELBERG]);

    vi.stubEnv("GEOCODE_RATE_LIMIT_PER_USER_DAILY", "1");
    try {
      expect((await GEOCODE(geocodeReq(token, "q=Heidelberg"), P({ tripId: freshTrip }))).status).toBe(200);

      const res = await GEOCODE(geocodeReq(token, "q=Heidelberg"), P({ tripId: freshTrip }));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).not.toBeNull();
      expect(forward).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
