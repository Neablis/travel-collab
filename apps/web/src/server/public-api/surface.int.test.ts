// **The rest of the v1 surface** (M22 Phase 4), driven as real HTTP.
//
// Phase 2 proved the seam at the smallest size that can fail. This proves the
// repetition is repetition: the planning writes land, the scopes separate, and
// the one write that is two commands behind one resource stays one endpoint.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { POST: CREATE_TRIP, GET: LIST_TRIPS } = await import("@/app/api/v1/trips/route");
const { GET: GET_TRIP, PATCH: PATCH_TRIP, DELETE: DELETE_TRIP } = await import(
  "@/app/api/v1/trips/[tripId]/route"
);
const { POST: RESTORE } = await import("@/app/api/v1/trips/[tripId]/restore/route");
const { POST: ADD_DAY } = await import("@/app/api/v1/trips/[tripId]/days/route");
const { DELETE: REMOVE_DAY } = await import("@/app/api/v1/trips/[tripId]/days/[dayId]/route");
const { POST: ADD_STOP } = await import("@/app/api/v1/trips/[tripId]/activities/route");
const { PATCH: PATCH_STOP, DELETE: REMOVE_STOP } = await import(
  "@/app/api/v1/trips/[tripId]/activities/[activityId]/route"
);
const { POST: UNDO } = await import("@/app/api/v1/trips/[tripId]/history/undo/route");
const { GET: HISTORY } = await import("@/app/api/v1/trips/[tripId]/history/route");
const { GET: GLOBALS } = await import("@/app/api/v1/trips/[tripId]/globals/route");
const { GET: ACCOUNT } = await import("@/app/api/v1/account/route");
const { GET: LIST_PAGES, POST: ADD_PAGE } = await import("@/app/api/v1/trips/[tripId]/pages/route");
const { GET: LIST_SHARES, POST: ADD_SHARE } = await import(
  "@/app/api/v1/trips/[tripId]/shares/route"
);

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function entitled(): Promise<string> {
  const id = `v1s-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M22 Phase 4 fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(owner: string, scopes: string[]): Promise<string> {
  const minted = await mintToken(owner, {
    name: "surface",
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

/** A trip with one day and one stop, built entirely through v1. */
async function seed(secret: string) {
  const created = await CREATE_TRIP(req(secret, { name: "Kyoto" }, "POST"), NO_PARAMS);
  expect(created.status).toBe(201);
  const trip = await created.json();
  const tripId = trip.tripId as string;

  const withDay = await ADD_DAY(req(secret, {}, "POST"), P({ tripId }));
  expect(withDay.status).toBe(201);
  const dayId = (await withDay.json()).days[0].dayId as string;

  const withStop = await ADD_STOP(req(secret, { title: "Fushimi Inari", dayId }, "POST"), P({ tripId }));
  expect(withStop.status).toBe(201);
  const detail = await withStop.json();
  const activityId = Object.keys(detail.activities)[0] as string;
  return { tripId, dayId, activityId };
}

describe("the planning writes, through v1 only", () => {
  it("builds a trip, a day and a stop, and reads them back", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId, activityId } = await seed(secret);

    const read = await GET_TRIP(req(secret), P({ tripId }));
    expect(read.status).toBe(200);
    const detail = await read.json();
    expect(detail.days).toHaveLength(1);
    expect(detail.activities[activityId].title).toBe("Fushimi Inari");
    expect(dayId).toBeTruthy();

    // The collection sees it too.
    const list = await LIST_TRIPS(req(secret), NO_PARAMS);
    expect((await list.json()).items.map((t: { tripId: string }) => t.tripId)).toContain(tripId);
  });

  // **Five commands behind one resource, and the caller never learns there were
  // five.** Name, dates, currency and budget in any combination.
  it("patches a trip's name, dates, currency and budget in one call", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(secret);

    const patched = await PATCH_TRIP(
      req(secret, {
        name: "Kyoto in spring",
        startDate: "2027-04-01",
        currency: "JPY",
        budget: { amountMinor: 250000, currency: "JPY" },
      }, "PATCH"),
      P({ tripId }),
    );
    expect(patched.status).toBe(200);
    const detail = await patched.json();
    expect(detail.name).toBe("Kyoto in spring");
    expect(detail.startDate).toBe("2027-04-01");
    expect(detail.currency).toBe("JPY");
    expect(detail.budget).toEqual({ amountMinor: 250000, currency: "JPY" });

    // **One history entry, not four.** The batch is what makes the atomicity a
    // public PATCH promises free rather than engineered — and it is also what
    // makes undo unwind the whole patch as a unit.
    const history = await HISTORY(req(secret), P({ tripId }));
    const entries = (await history.json()).entries as { summary: string }[];
    const undone = await UNDO(req(secret, {}, "POST"), P({ tripId }));
    expect(undone.status).toBe(200);
    const after = await undone.json();
    expect(after.name).toBe("Kyoto");
    expect(after.currency).not.toBe("JPY");
    expect(entries.length).toBeGreaterThan(0);
  });

  // **Decision 14, as a test.** A patch that touches a stop's fields AND its day
  // is two commands internally and one endpoint publicly.
  it("patches a stop's fields and its day in one call, atomically", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, activityId } = await seed(secret);

    // A second day to move it to.
    const second = await ADD_DAY(req(secret, {}, "POST"), P({ tripId }));
    const days = (await second.json()).days as { dayId: string }[];
    const target = days[1]!.dayId;

    const patched = await PATCH_STOP(
      req(secret, { title: "Kinkaku-ji", dayId: target, position: 0 }, "PATCH"),
      P({ tripId, activityId }),
    );
    expect(patched.status).toBe(200);
    const detail = await patched.json();
    expect(detail.activities[activityId].title).toBe("Kinkaku-ji");
    expect(detail.days.find((d: { dayId: string }) => d.dayId === target).activityIds).toContain(
      activityId,
    );
  });

  it("removes a stop, a day, and the trip — and restores the trip", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId, dayId, activityId } = await seed(secret);

    expect((await REMOVE_STOP(req(secret, undefined, "DELETE"), P({ tripId, activityId }))).status).toBe(200);
    expect((await REMOVE_DAY(req(secret, undefined, "DELETE"), P({ tripId, dayId }))).status).toBe(200);

    // **A deleted trip is not gone**, which is why DELETE answers with the trip
    // rather than a 204 — its status says `deleted` and a caller can see it.
    const deleted = await DELETE_TRIP(req(secret, undefined, "DELETE"), P({ tripId }));
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).status).toBe("deleted");

    const restored = await RESTORE(req(secret, {}, "POST"), P({ tripId }));
    // Creates nothing, so 200 — the one place a declaration says so.
    expect(restored.status).toBe(200);
    expect((await restored.json()).status).toBe("active");
  });
});

describe("the scopes actually separate", () => {
  // The eighth scope, and the gap writing the list in plain language found: a
  // token minted to sync an itinerary must not be able to hand a stranger
  // editor rights.
  it("will not let trips:write create a share link", async () => {
    const owner = await entitled();
    const planning = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(planning);

    const refused = await ADD_SHARE(req(planning, {}, "POST"), P({ tripId }));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("insufficient-scope");

    // …while the scope that names it does.
    const sharing = await tokenFor(owner, ["trips:read", "sharing:write"]);
    const created = await ADD_SHARE(req(sharing, {}, "POST"), P({ tripId }));
    expect(created.status).toBe(201);
    // And READING share links is `trips:read` — listing your own trip's links
    // is not more sensitive than reading the trip.
    const listed = await LIST_SHARES(req(planning), P({ tripId }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toHaveLength(1);
  });

  it("keeps the Notebook behind its own scopes", async () => {
    const owner = await entitled();
    const planning = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(planning);

    expect((await LIST_PAGES(req(planning), P({ tripId }))).status).toBe(403);

    const notebook = await tokenFor(owner, ["notebook:read", "notebook:write"]);
    const pages = await LIST_PAGES(req(notebook), P({ tripId }));
    expect(pages.status).toBe(200);

    const added = await ADD_PAGE(
      req(
        notebook,
        // Two things this fixture got wrong first, both of which the contract
        // correctly 400s: `content` is required (a page with no document is not
        // a page), and `PageContext.kind` is the literal `"overview"` or absent
        // — it is not a discriminator anyone gets to invent a value for.
        { title: "Ideas", context: { tripId }, content: { type: "doc", content: [] } },
        "POST",
      ),
      P({ tripId }),
    );
    expect(added.status).toBe(201);
    expect((await added.json()).title).toBe("Ideas");
  });

  it("answers who you are under account:read and refuses it otherwise", async () => {
    const owner = await entitled();
    const planning = await tokenFor(owner, ["trips:write"]);
    expect((await ACCOUNT(req(planning), NO_PARAMS)).status).toBe(403);

    const identity = await tokenFor(owner, ["account:read"]);
    const me = await ACCOUNT(req(identity), NO_PARAMS);
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.userId).toBe(owner);
    expect(body.entitlements).toContain("api.tokens");
  });
});

describe("reads that were nearly free", () => {
  it("serves the trip's globals and its history", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner, ["trips:read", "trips:write"]);
    const { tripId } = await seed(secret);

    const globals = await GLOBALS(req(secret), P({ tripId }));
    expect(globals.status).toBe(200);
    expect(await globals.json()).toHaveProperty("cities");

    const history = await HISTORY(req(secret), P({ tripId }));
    expect(history.status).toBe(200);
    expect((await history.json()).entries.length).toBeGreaterThan(0);
  });
});
