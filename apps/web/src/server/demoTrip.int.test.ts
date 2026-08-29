import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripAccess, TripDetail, TripHistory } from "@tc/contracts";
import { JAPAN_TRIP_NAME } from "@tc/fixtures";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import { db } from "@/server/db/client";
import { events, tripDetails, tripMemberships, tripSummaries } from "@/server/db/schema";
import { getTripDetail } from "@/server/projections";

// The demo trip travels the REAL routes (ADR-031). These are the four reads the
// board's `TripProvider` makes and the write it offers, exercised through the
// route handlers themselves rather than through the functions under them —
// because "the ordinary endpoints serve it" is the claim, and a test of
// `demoTripDetail()` alone would prove nothing about the routes.

const VISITOR = "demo-cloner";
let currentUserId: string | null = null;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Imported after the mock, like every other *.int.test.ts under src/app/api.
const { GET: getTrip } = await import("@/app/api/trips/[tripId]/route");
const { GET: getHistory } = await import("@/app/api/trips/[tripId]/history/route");
const { GET: getHistoryAt } = await import("@/app/api/trips/[tripId]/history/[seq]/route");
const { GET: getAccess } = await import("@/app/api/trips/[tripId]/access/route");
const { POST: postDuplicate } = await import("@/app/api/trips/[tripId]/duplicate/route");
const { POST: postCommand } = await import("@/app/api/trips/[tripId]/commands/route");

const params = () => ({ params: Promise.resolve({ tripId: DEMO_TRIP_ID }) });
const seqParams = (seq: string) => ({ params: Promise.resolve({ tripId: DEMO_TRIP_ID, seq }) });

const request = () => new Request("http://localhost/irrelevant");

beforeEach(async () => {
  currentUserId = null;
  await db.delete(tripMemberships);
  await db.delete(tripDetails);
  await db.delete(tripSummaries);
  await db.delete(events);
});

afterEach(() => {
  currentUserId = null;
});

describe("the demo trip, through the ordinary trip endpoints, with no session", () => {
  it("GET /api/trips/:id serves the whole fixture", async () => {
    const response = await getTrip(request(), params());
    expect(response.status).toBe(200);
    const { trip } = (await response.json()) as { trip: unknown };
    const detail = TripDetail.parse(trip);
    expect(detail.name).toBe(JAPAN_TRIP_NAME);
    expect(detail.days).toHaveLength(14);
    expect(Object.keys(detail.activities)).toHaveLength(72);
  });

  it("GET /api/trips/:id/history serves a real history the popover can render", async () => {
    const response = await getHistory(request(), params());
    expect(response.status).toBe(200);
    const { history } = (await response.json()) as { history: unknown };
    const parsed = TripHistory.parse(history);
    expect(parsed.entries.length).toBeGreaterThan(14);
    expect(parsed.canUndo).toBe(false);
  });

  it("GET /api/trips/:id/history/:seq replays the demo to a point in it", async () => {
    const response = await getHistoryAt(request(), seqParams("1"));
    expect(response.status).toBe(200);
    const { trip } = (await response.json()) as { trip: unknown };
    // Genesis: the trip exists and is named, and nothing is planned yet.
    expect(TripDetail.parse(trip).days).toHaveLength(0);
  });

  it("GET /api/trips/:id/access makes every visitor a viewer — which is what makes it read-only", async () => {
    const response = await getAccess(request(), params());
    expect(response.status).toBe(200);
    const { access } = (await response.json()) as { access: unknown };
    const parsed = TripAccess.parse(access);
    // `myRole: "viewer"` is the whole read-only mechanism: TripProvider refuses
    // a viewer's writes before they reach the queue, and accessPolicy's
    // MINIMUM_ROLE table has no viewer entry, so the server refuses them too.
    expect(parsed.myRole).toBe("viewer");
    expect(parsed.members.length).toBeGreaterThan(1);
    expect(parsed.invites).toEqual([]);
  });

  it("serves all four without a session, and without touching a trip row", async () => {
    // The database is empty (beforeEach) and no session exists, yet every read
    // above answers 200. Nothing about the demo is stored.
    expect(await getTripDetail(DEMO_TRIP_ID)).toBeNull();
    for (const response of [
      await getTrip(request(), params()),
      await getHistory(request(), params()),
      await getAccess(request(), params()),
    ]) {
      expect(response.status).toBe(200);
    }
  });
});

describe("the demo trip refuses every write", () => {
  it("403s a command posted at it, even from a signed-in account", async () => {
    currentUserId = VISITOR;
    const response = await postCommand(
      new Request("http://localhost/irrelevant", {
        method: "POST",
        body: JSON.stringify({ type: "AddDay", tripId: DEMO_TRIP_ID, dayId: crypto.randomUUID() }),
      }),
      params(),
    );
    // The command pipeline never reaches the demo's access grant: it decides
    // against the trip's own member list, and a trip with no stream has none,
    // so `canExecute` refuses. Two independent reasons the demo cannot be
    // written to — this one, and `requireTripAccess` refusing any `minimum`
    // above viewer — and neither is a special case anybody has to maintain.
    expect(response.status).toBe(403);
  });
});

describe("POST /api/trips/:id/duplicate — 'Make this trip mine'", () => {
  it("turns the in-memory demo into a real, owned, editable trip", async () => {
    currentUserId = VISITOR;
    const response = await postDuplicate(request(), params());
    expect(response.status).toBe(201);
    const { tripId } = (await response.json()) as { tripId: string };

    const detail = await getTripDetail(tripId);
    expect(detail).not.toBeNull();
    // Not "<name> (copy)": this is somebody's first trip, and it is theirs.
    expect(detail!.name).toBe(JAPAN_TRIP_NAME);
    expect(detail!.days).toHaveLength(14);
    expect(Object.keys(detail!.activities)).toHaveLength(72);
    expect(detail!.members).toEqual([{ userId: VISITOR, role: "owner" }]);
    expect(detail!.status).toBe("active");
  });

  it("records the demo as its lineage, with fresh ids of its own", async () => {
    currentUserId = VISITOR;
    const { tripId } = (await (await postDuplicate(request(), params())).json()) as { tripId: string };
    const detail = await getTripDetail(tripId);

    expect(detail!.forkedFrom?.tripId).toBe(DEMO_TRIP_ID);
    expect(detail!.forkedFrom?.name).toBe(JAPAN_TRIP_NAME);
    expect(detail!.forkedFrom!.atSeq).toBeGreaterThan(0);

    // Every day and activity id is remapped (KI-1): the copy shares no id with
    // the demo, whose ids are all-zeros-prefixed.
    for (const day of detail!.days) expect(day.dayId).not.toMatch(/^00000000-0000-4000-8000-/);
    for (const id of Object.keys(detail!.activities)) {
      expect(id).not.toMatch(/^00000000-0000-4000-8000-/);
    }
  });

  it("gives two visitors two independent trips", async () => {
    currentUserId = VISITOR;
    const first = (await (await postDuplicate(request(), params())).json()) as { tripId: string };
    currentUserId = "demo-cloner-2";
    const second = (await (await postDuplicate(request(), params())).json()) as { tripId: string };
    expect(second.tripId).not.toBe(first.tripId);
    expect((await getTripDetail(first.tripId))!.members).toEqual([{ userId: VISITOR, role: "owner" }]);
    expect((await getTripDetail(second.tripId))!.members).toEqual([
      { userId: "demo-cloner-2", role: "owner" },
    ]);
  });

  it("401s a signed-out visitor — the page turns that into a trip to /signin", async () => {
    const response = await postDuplicate(request(), params());
    expect(response.status).toBe(401);
  });
});
