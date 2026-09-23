// **Playbooks over v1** (ADR-050), driven as real HTTP.
//
// Two claims worth attacking. Keeping several days produces ONE Playbook whose
// stops are indexed by their position in `dayIds`, not by the source trip's
// own numbering. And applying one is `insertSavedDay` over v1: N days appended
// in order, the stops carried field for field, fresh ids handed back in an
// order a caller can zip against `stops[]`, and all of it one history entry
// that one undo takes back.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { commandsFor } from "@tc/factories";
import type { SavedDay, TripDetail } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { acceptInvite, createInvite } from "@/server/access/invites";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { GET: LIST_PLAYBOOKS, POST: KEEP } = await import("@/app/api/v1/playbooks/route");
const { GET: GET_PLAYBOOK, PATCH: PATCH_PLAYBOOK } = await import(
  "@/app/api/v1/playbooks/[playbookId]/route"
);
const { GET: LIST_LIBRARY } = await import("@/app/api/v1/library/route");
const { POST: APPLY } = await import("@/app/api/v1/trips/[tripId]/playbook-applications/route");
const { GET: GET_TRIP } = await import("@/app/api/v1/trips/[tripId]/route");
const { GET: HISTORY } = await import("@/app/api/v1/trips/[tripId]/history/route");
const { POST: UNDO } = await import("@/app/api/v1/trips/[tripId]/history/undo/route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const EVERYTHING = ["trips:read", "trips:write", "library:read", "library:write"];

async function entitled(): Promise<string> {
  const id = `v1p-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "ADR-050 playbooks fixture.",
    expiresAt: null,
  });
  return id;
}

async function tokenFor(owner: string, tripIds: string[] | null = null): Promise<string> {
  const minted = await mintToken(owner, {
    name: "playbooks",
    scopes: EVERYTHING as Parameters<typeof mintToken>[1]["scopes"],
    tripIds,
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

/** A dated three-day trip, two stops a day, with windows, costs and places. */
async function sourceTrip(owner: string): Promise<{ tripId: string; dayIds: string[] }> {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, owner)).ok).toBe(true);
  for (const command of commandsFor("threeDayTrip", tripId)) {
    const result = await executeTripCommand(command, owner);
    if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
  }
  const detail = await tripOf(owner, tripId);
  return { tripId, dayIds: detail.days.map((d) => d.dayId) };
}

async function tripOf(owner: string, tripId: string): Promise<TripDetail> {
  const res = await GET_TRIP(req(await tokenFor(owner)), P({ tripId }));
  expect(res.status).toBe(200);
  return (await res.json()) as TripDetail;
}

async function emptyTrip(owner: string, name = "Destination"): Promise<string> {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name }, owner)).ok).toBe(true);
  return tripId;
}

async function keep(secret: string, body: unknown): Promise<Response> {
  return KEEP(req(secret, body, "POST"), NO_PARAMS);
}

describe("POST /v1/playbooks keeps several days as one Playbook", () => {
  it("indexes stops by position in dayIds, skipping and reordering the source's days", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const { tripId, dayIds } = await sourceTrip(owner);
    const source = await tripOf(owner, tripId);

    // Day 3 then day 1: non-contiguous, and out of the trip's own order.
    const res = await keep(secret, { tripId, name: "Ends first", dayIds: [dayIds[2], dayIds[0]] });
    expect(res.status).toBe(201);
    const playbook = (await res.json()) as SavedDay;

    expect(playbook.dayCount).toBe(2);
    const titlesOf = (dayId: string) =>
      source.days.find((d) => d.dayId === dayId)!.activityIds.map((id) => source.activities[id]!.title);
    expect(playbook.stops.map((s) => [s.dayIndex, s.title])).toEqual([
      ...titlesOf(dayIds[2]!).map((t) => [0, t]),
      ...titlesOf(dayIds[0]!).map((t) => [1, t]),
    ]);

    // The same row through both views, because it is one row.
    const one = await GET_PLAYBOOK(req(secret), P({ playbookId: playbook.savedDayId }));
    expect(one.status).toBe(200);
    expect(await one.json()).toEqual(playbook);
    const library = await LIST_LIBRARY(req(secret), NO_PARAMS);
    expect((await library.json()).items.map((d: SavedDay) => d.savedDayId)).toContain(playbook.savedDayId);
    const listed = await LIST_PLAYBOOKS(req(secret), NO_PARAMS);
    expect((await listed.json()).items.map((d: SavedDay) => d.savedDayId)).toContain(playbook.savedDayId);
  });

  // The hand gate's reason to exist: the trip is in the body, not the path.
  // Today `route()` refuses every confined token on a tripless endpoint before
  // the handler runs, so the named trip is refused too — the same answer
  // `POST /v1/library` gives.
  it("refuses a trip-confined token, including for a trip it does not name", async () => {
    const owner = await entitled();
    const { tripId: named, dayIds: namedDays } = await sourceTrip(owner);
    const { tripId: other, dayIds: otherDays } = await sourceTrip(owner);
    const confined = await tokenFor(owner, [named]);

    const elsewhere = await keep(confined, { tripId: other, name: "Nope", dayIds: [otherDays[0]] });
    expect(elsewhere.status, "a trip the token does not name").toBe(403);
    expect((await elsewhere.json()).error.code).toBe("trip-out-of-scope");

    const home = await keep(confined, { tripId: named, name: "Nope", dayIds: [namedDays[0]] });
    expect(home.status, "the trip the token names").toBe(403);
    expect((await home.json()).error.code).toBe("trip-out-of-scope");
  });
});

describe("POST /v1/trips/{tripId}/playbook-applications", () => {
  async function threeDayPlaybook(owner: string, secret: string): Promise<SavedDay> {
    const { tripId, dayIds } = await sourceTrip(owner);
    const res = await keep(secret, { tripId, name: "Three days", dayIds });
    expect(res.status).toBe(201);
    return (await res.json()) as SavedDay;
  }

  it("appends the days in order with every stop's fields, as one undoable entry", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeDayPlaybook(owner, secret);

    const target = await emptyTrip(owner);
    const existing = randomUUID();
    expect((await executeTripCommand({ type: "AddDay", tripId: target, dayId: existing }, owner)).ok).toBe(true);
    const historyBefore = (await (await HISTORY(req(secret), P({ tripId: target }))).json()).entries.length;

    const res = await APPLY(req(secret, { playbookId: playbook.savedDayId }, "POST"), P({ tripId: target }));
    expect(res.status).toBe(201);
    const applied = (await res.json()) as {
      tripId: string;
      playbookId: string;
      dayIds: string[];
      activityIds: string[];
      historySeq: number;
    };
    expect(applied.tripId).toBe(target);
    expect(applied.playbookId).toBe(playbook.savedDayId);
    expect(applied.dayIds).toHaveLength(playbook.dayCount);
    expect(applied.activityIds).toHaveLength(playbook.stops.length);

    const after = await tripOf(owner, target);
    // Appended after the trip's own day, in the Playbook's order.
    expect(after.days.map((d) => d.dayId)).toEqual([existing, ...applied.dayIds]);
    // A dateless trip stays dateless: nothing of the source's calendar came across.
    expect(after.startDate).toBeNull();
    // `activityIds[i]` IS `stops[i]`, on the day its `dayIndex` names.
    for (const [i, stop] of playbook.stops.entries()) {
      const id = applied.activityIds[i]!;
      const activity = after.activities[id]!;
      expect(activity, `stop ${i}`).toBeDefined();
      expect(
        { title: activity.title, timeWindow: activity.timeWindow, location: activity.location, cost: activity.cost },
        `stop ${i}`,
      ).toEqual({ title: stop.title, timeWindow: stop.timeWindow, location: stop.location, cost: stop.cost });
      expect(after.days.find((d) => d.activityIds.includes(id))!.dayId, `stop ${i}`).toBe(
        applied.dayIds[stop.dayIndex],
      );
    }

    const history = (await (await HISTORY(req(secret), P({ tripId: target }))).json()) as {
      entries: { toSeq: number }[];
    };
    expect(history.entries).toHaveLength(historyBefore + 1);
    expect(history.entries[0]!.toSeq).toBe(applied.historySeq);

    const undone = await UNDO(req(secret, {}, "POST"), P({ tripId: target }));
    expect(undone.status).toBe(200);
    const restored = await tripOf(owner, target);
    expect(restored.days.map((d) => d.dayId)).toEqual([existing]);
    expect(Object.keys(restored.activities)).toEqual([]);
  });

  it("mints fresh ids each time, so one Playbook can go into one trip twice", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeDayPlaybook(owner, secret);
    const target = await emptyTrip(owner);

    const apply = async () => {
      const res = await APPLY(req(secret, { playbookId: playbook.savedDayId }, "POST"), P({ tripId: target }));
      expect(res.status).toBe(201);
      return (await res.json()) as { dayIds: string[]; activityIds: string[] };
    };
    const first = await apply();
    const second = await apply();
    const all = [...first.dayIds, ...first.activityIds, ...second.dayIds, ...second.activityIds];
    expect(new Set(all).size).toBe(all.length);
    expect((await tripOf(owner, target)).days).toHaveLength(2 * playbook.dayCount);
  });

  it("answers 404 for somebody else's private Playbook, and changes nothing", async () => {
    const author = await entitled();
    const playbook = await threeDayPlaybook(author, await tokenFor(author));

    const taker = await entitled();
    const secret = await tokenFor(taker);
    const target = await emptyTrip(taker);

    const res = await APPLY(req(secret, { playbookId: playbook.savedDayId }, "POST"), P({ tripId: target }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not-found");
    expect((await tripOf(taker, target)).days).toEqual([]);

    // Published, the same id is applicable — so the 404 was about visibility.
    const published = await PATCH_PLAYBOOK(
      req(await tokenFor(author), { visibility: "public" }, "PATCH"),
      P({ playbookId: playbook.savedDayId }),
    );
    expect(published.status).toBe(200);
    const again = await APPLY(req(secret, { playbookId: playbook.savedDayId }, "POST"), P({ tripId: target }));
    expect(again.status).toBe(201);
  });

  it("refuses a viewer on the destination trip with 403, and changes nothing", async () => {
    const owner = await entitled();
    const target = await emptyTrip(owner);

    const guest = await entitled();
    const invite = await createInvite(target, owner, { role: "viewer", email: null });
    await acceptInvite(invite.token, guest);
    const secret = await tokenFor(guest);
    const playbook = await threeDayPlaybook(guest, secret);

    const res = await APPLY(req(secret, { playbookId: playbook.savedDayId }, "POST"), P({ tripId: target }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect((await tripOf(owner, target)).days).toEqual([]);
  });
});
