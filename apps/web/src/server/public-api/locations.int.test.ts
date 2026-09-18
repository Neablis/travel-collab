// **A v1 stop write resolves its location before the command runs**, driven as
// real HTTP against a real database with only the vendor mocked.
//
// `locations.test.ts` already covers the resolution order in isolation. What
// this file proves is the wiring the unit test cannot see: that the outcome
// reaches the caller as a response header through `route()`, that a lookup
// failure still creates the stop, and that a `location` the caller did not send
// costs nothing.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";

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
});
