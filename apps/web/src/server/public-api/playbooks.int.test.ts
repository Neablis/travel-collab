// **Playbooks over v1** (ADR-050), driven as real HTTP.
//
// Two claims worth attacking. Keeping several days produces ONE Playbook whose
// stops are indexed by their position in `dayIds`, not by the source trip's
// own numbering. And applying one is `insertSavedDay` over v1: N days appended
// in order, the stops carried field for field, fresh ids handed back in an
// order a caller can zip against `stops[]`, and all of it one history entry
// that one undo takes back.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { commandsFor } from "@tc/factories";
import type { SavedDay, TripDetail } from "@tc/contracts";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { db } from "@/server/db/client";
import { apiIdempotencyKeys, savedDays } from "@/server/db/schema";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));
// The real batch, spyable: a race lost at the append cannot be staged on demand
// against a real database, so one test fakes exactly that answer once.
vi.mock("@/server/commands", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/commands")>();
  return { ...real, executeTripCommandBatch: vi.fn(real.executeTripCommandBatch) };
});

const { GET: LIST_PLAYBOOKS, POST: KEEP } = await import("@/app/api/v1/playbooks/route");
const { GET: GET_PLAYBOOK, PATCH: PATCH_PLAYBOOK } = await import(
  "@/app/api/v1/playbooks/[playbookId]/route"
);
const { GET: LIST_LIBRARY, POST: SAVE_TO_LIBRARY } = await import("@/app/api/v1/library/route");
const { PATCH: PATCH_LIBRARY } = await import("@/app/api/v1/library/[savedDayId]/route");
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

/** The from-a-trip body: whole days, in the order given. */
const fromTrip = (tripId: string, name: string, dayIds: readonly (string | undefined)[]) => ({
  name,
  source: { tripId, days: dayIds.map((dayId) => ({ dayId })) },
});

type Written = { playbook: SavedDay; warnings: { code: string; stopIndex: number; title: string; message: string }[] };

describe("POST /v1/playbooks keeps several days as one Playbook", () => {
  it("indexes stops by position in dayIds, skipping and reordering the source's days", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const { tripId, dayIds } = await sourceTrip(owner);
    const source = await tripOf(owner, tripId);

    // Day 3 then day 1: non-contiguous, and out of the trip's own order.
    const res = await keep(secret, fromTrip(tripId, "Ends first", [dayIds[2], dayIds[0]]));
    expect(res.status).toBe(201);
    const { playbook } = (await res.json()) as Written;

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

});

// **A trip-confined token may keep days of the trips it names, and nothing
// else** (KI-2026-09-24-a). Both creates declare `trip: { body }`, so the wrapper
// reads the trip out of the parsed body and runs the same two gates a
// `/trips/{tripId}` path gets. A body naming no trip is tripless, and a
// confined token is refused on it as on `GET /v1/account`.
describe("a trip-confined token writing the library", () => {
  const INLINE = { name: "Inline", days: [{ stops: [inlineStop("Somewhere")] }] };

  it("keeps days of the trip it names, through both creates", async () => {
    const owner = await entitled();
    const { tripId: named, dayIds: namedDays } = await sourceTrip(owner);
    const confined = await tokenFor(owner, [named]);

    const playbook = await keep(confined, fromTrip(named, "Home", [namedDays[0]]));
    expect(playbook.status, "POST /v1/playbooks").toBe(201);
    expect(((await playbook.json()) as Written).playbook.sourceTripId).toBe(named);

    const saved = await SAVE_TO_LIBRARY(
      req(confined, { tripId: named, dayId: namedDays[1], name: "Home" }, "POST"),
      NO_PARAMS,
    );
    expect(saved.status, "POST /v1/library").toBe(201);
    expect(((await saved.json()) as SavedDay).sourceTripId).toBe(named);
  });

  it("is refused a trip it does not name", async () => {
    const owner = await entitled();
    const { tripId: named } = await sourceTrip(owner);
    const { tripId: other, dayIds: otherDays } = await sourceTrip(owner);
    const confined = await tokenFor(owner, [named]);

    const playbook = await keep(confined, fromTrip(other, "Nope", [otherDays[0]]));
    expect(playbook.status, "POST /v1/playbooks").toBe(403);
    expect((await playbook.json()).error.code).toBe("trip-out-of-scope");

    const saved = await SAVE_TO_LIBRARY(
      req(confined, { tripId: other, dayId: otherDays[0], name: "Nope" }, "POST"),
      NO_PARAMS,
    );
    expect(saved.status, "POST /v1/library").toBe(403);
    expect((await saved.json()).error.code).toBe("trip-out-of-scope");
  });

  // An inline Playbook names no trip, so from a confined token it is a
  // widening. The account-wide half shows the refusal is the confinement and
  // not the body.
  it("is refused a body that names no trip", async () => {
    const owner = await entitled();
    const { tripId: named } = await sourceTrip(owner);
    const confined = await tokenFor(owner, [named]);

    const res = await keep(confined, INLINE);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("trip-out-of-scope");

    expect((await keep(await tokenFor(owner), INLINE)).status).toBe(201);
  });
});

describe("POST /v1/trips/{tripId}/playbook-applications", () => {
  async function threeDayPlaybook(owner: string, secret: string): Promise<SavedDay> {
    const { tripId, dayIds } = await sourceTrip(owner);
    const res = await keep(secret, fromTrip(tripId, "Three days", dayIds));
    expect(res.status).toBe(201);
    return ((await res.json()) as Written).playbook;
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

// ---- ADR-050, Pass A --------------------------------------------------------

/** A stop as an inline body writes one: `SavedStop` without `dayIndex`. */
function inlineStop(title: string, over: Record<string, unknown> = {}) {
  return {
    title,
    timeWindow: { start: "09:00", end: "10:00" },
    location: { name: title, city: "Kyoto", countryCode: "JP" },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: { amountMinor: 1200, currency: "USD" },
    ...over,
  };
}

async function patch(secret: string, playbookId: string, body: unknown): Promise<Response> {
  return PATCH_PLAYBOOK(req(secret, body, "PATCH"), P({ playbookId }));
}

async function inline(secret: string, body: unknown): Promise<Written> {
  const res = await keep(secret, body);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as Written;
}

describe("POST /v1/playbooks from part of a trip", () => {
  /** Three days, three stops a day — enough for "some, out of order" to mean something. */
  async function wideTrip(owner: string) {
    const tripId = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Wide" }, owner)).ok).toBe(true);
    const windows = [
      { start: "09:00", end: "10:00" },
      { start: "10:00", end: "11:00" },
      { start: "11:00", end: "12:00" },
    ];
    for (const command of commandsFor("threeDayTrip", tripId, { activitiesPerDay: 3, timeWindows: windows })) {
      const result = await executeTripCommand(command, owner);
      if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
    }
    return tripOf(owner, tripId);
  }

  it("keeps only the named activities, in the trip's order rather than the order given", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const trip = await wideTrip(owner);
    const [first, second] = trip.days;
    const title = (id: string) => trip.activities[id]!.title;
    const [a0, , a2] = first!.activityIds;

    const { playbook } = await inline(secret, {
      name: "Bookends",
      source: {
        tripId: trip.tripId,
        // Reversed on purpose: the trip ran a0 before a2, so that is the order kept.
        days: [{ dayId: first!.dayId, activityIds: [a2, a0] }, { dayId: second!.dayId }],
      },
    });

    expect(playbook.dayCount).toBe(2);
    expect(playbook.stops.map((s) => [s.dayIndex, s.title])).toEqual([
      [0, title(a0!)],
      [0, title(a2!)],
      ...second!.activityIds.map((id) => [1, title(id)]),
    ]);
  });

  it("refuses an activity that is not on the day it was named with, naming it, and keeps nothing", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const trip = await wideTrip(owner);
    const foreign = trip.days[1]!.activityIds[0]!;

    const res = await keep(secret, {
      name: "Wrong day",
      source: { tripId: trip.tripId, days: [{ dayId: trip.days[0]!.dayId, activityIds: [foreign] }] },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(body.error.message).toContain(foreign);
    const listed = await LIST_PLAYBOOKS(req(secret), NO_PARAMS);
    expect((await listed.json()).items).toEqual([]);
  });

  it("strips a calendar-date anchor from a kept stop and says so, keeping the weekday one", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const trip = await wideTrip(owner);
    const day = trip.days[0]!;
    const pinned = day.activityIds[1]!;
    const weekday = { kind: "dayOfWeek", days: ["tue"] } as const;
    const updated = await executeTripCommand(
      {
        type: "UpdateActivity",
        tripId: trip.tripId,
        activityId: pinned,
        anchors: [{ kind: "dateRange", from: "2027-06-01", to: "2027-06-03" }, weekday],
      },
      owner,
    );
    expect(updated.ok).toBe(true);

    const { playbook, warnings } = await inline(secret, fromTrip(trip.tripId, "Tuesdays", [day.dayId]));
    expect(playbook.stops[1]!.anchors).toEqual([weekday]);
    expect(warnings).toEqual([
      expect.objectContaining({ code: "date-anchor-removed", stopIndex: 1, title: trip.activities[pinned]!.title }),
    ]);
  });
});

describe("POST /v1/playbooks written inline", () => {
  it("round-trips its stops and day count, an empty middle day included", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);

    const { playbook, warnings } = await inline(secret, {
      name: "Rest in the middle",
      summary: "Two busy days either side of nothing.",
      days: [{ stops: [inlineStop("Arrive"), inlineStop("Dinner")] }, { stops: [] }, { stops: [inlineStop("Leave")] }],
    });

    expect(warnings).toEqual([]);
    expect(playbook).toMatchObject({
      dayCount: 3,
      version: 1,
      summary: "Two busy days either side of nothing.",
      visibility: "private",
      // No `sourceName`, so the Playbook credits itself; the id names no trip.
      sourceTripName: "Rest in the middle",
      cities: ["Kyoto"],
    });
    expect(playbook.stops.map((s) => [s.dayIndex, s.title])).toEqual([
      [0, "Arrive"],
      [0, "Dinner"],
      [2, "Leave"],
    ]);
    expect(playbook.stops[0]).toEqual({ ...inlineStop("Arrive"), dayIndex: 0, mode: null, endLocation: null });

    const read = await GET_PLAYBOOK(req(secret), P({ playbookId: playbook.savedDayId }));
    expect(await read.json()).toEqual(playbook);
  });

  it("strips a calendar-date anchor with a warning, and keeps weekday and time-of-day ones", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const keptAnchors = [
      { kind: "dayOfWeek", days: ["sat", "sun"] },
      { kind: "timeOfDay", window: { start: "06:00", end: "08:00" } },
    ];

    const { playbook, warnings } = await inline(secret, {
      name: "Market mornings",
      days: [
        {
          stops: [
            inlineStop("Coffee"),
            inlineStop("Flea market", {
              anchors: [{ kind: "dateRange", from: "2027-05-03", to: "2027-05-05" }, ...keptAnchors],
            }),
          ],
        },
      ],
    });

    expect(playbook.stops[1]!.anchors).toEqual(keptAnchors);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "date-anchor-removed", stopIndex: 1, title: "Flea market" });
    expect(warnings[0]!.message).toContain("2027-05-03");
  });

  it(`refuses more than 500 stops`, async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const res = await keep(secret, {
      name: "Too much",
      days: [{ stops: Array.from({ length: 501 }, (_, i) => inlineStop(`Stop ${i}`)) }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("at most 500 stops");
  });

  it("refuses a stop no apply could write — an empty or over-long title, over-long notes", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    for (const stop of [
      inlineStop(""),
      inlineStop("x".repeat(201)),
      inlineStop("Fine", { notes: "n".repeat(2001) }),
    ]) {
      const res = await keep(secret, { name: "Unwritable", days: [{ stops: [stop] }] });
      expect(res.status).toBe(400);
    }
    expect(await db.select().from(savedDays).where(eq(savedDays.ownerId, owner))).toEqual([]);
  });

  it("refuses a travel leg on a non-transit stop, naming the rule", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const res = await keep(secret, {
      name: "Unwritable",
      days: [{ stops: [inlineStop("Walk", { endLocation: { name: "Castle" } })] }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("endLocation is only allowed on a transit stop");
    expect(await db.select().from(savedDays).where(eq(savedDays.ownerId, owner))).toEqual([]);
  });
});

describe("PATCH /v1/playbooks/{playbookId}", () => {
  async function kyotoPlaybook(secret: string): Promise<SavedDay> {
    return (await inline(secret, { name: "Kyoto", days: [{ stops: [inlineStop("Temple"), inlineStop("Tea")] }] }))
      .playbook;
  }

  it("renames under expectedVersion, bumping version by exactly one and moving nothing else", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const before = await kyotoPlaybook(secret);

    const res = await patch(secret, before.savedDayId, { name: "Kyoto, slowly", expectedVersion: 1 });
    expect(res.status).toBe(200);
    const { playbook: after } = (await res.json()) as Written;
    expect(after).toEqual({ ...before, name: "Kyoto, slowly", version: 2 });

    // A visibility flip is not a content change: no version needed, none bumped.
    const published = await patch(secret, before.savedDayId, { visibility: "public" });
    expect(published.status).toBe(200);
    expect(((await published.json()) as Written).playbook).toMatchObject({ visibility: "public", version: 2 });
  });

  it("refuses a stale expectedVersion with 409 and the current version, and writes nothing", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await kyotoPlaybook(secret);
    expect((await patch(secret, playbook.savedDayId, { summary: "First", expectedVersion: 1 })).status).toBe(200);

    const res = await patch(secret, playbook.savedDayId, { name: "Lost update", expectedVersion: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.details).toEqual({ currentVersion: 2 });

    const read = (await (await GET_PLAYBOOK(req(secret), P({ playbookId: playbook.savedDayId }))).json()) as SavedDay;
    expect(read).toMatchObject({ name: "Kyoto", summary: "First", version: 2 });
  });

  it("refuses to replace the days of a published Playbook, but renames it", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await kyotoPlaybook(secret);
    expect((await patch(secret, playbook.savedDayId, { visibility: "public" })).status).toBe(200);

    const res = await patch(secret, playbook.savedDayId, {
      days: [{ stops: [inlineStop("Something else")] }],
      expectedVersion: 1,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("This playbook is published. Unpublish it before editing its days.");

    const renamed = await patch(secret, playbook.savedDayId, { name: "Still Kyoto", expectedVersion: 1 });
    expect(renamed.status).toBe(200);
    const after = ((await renamed.json()) as Written).playbook;
    expect(after.stops).toEqual(playbook.stops);
    expect(after.version).toBe(2);
  });

  it("recomputes cities, countries and day count when the days are replaced", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await kyotoPlaybook(secret);

    const res = await patch(secret, playbook.savedDayId, {
      days: [
        { stops: [inlineStop("Colosseum", { location: { name: "Colosseum", city: "Rome", countryCode: "IT" } })] },
        { stops: [] },
      ],
      expectedVersion: 1,
    });
    expect(res.status).toBe(200);
    const after = ((await res.json()) as Written).playbook;
    expect(after).toMatchObject({ cities: ["Rome"], dayCount: 2, version: 2 });
    expect(after.stops.map((s) => s.title)).toEqual(["Colosseum"]);
    const [row] = await db
      .select({ countries: savedDays.countries })
      .from(savedDays)
      .where(eq(savedDays.id, playbook.savedDayId));
    expect(row!.countries).toEqual(["IT"]);
  });

  // M24. `SavedDaySequence` refuses a travel leg on a non-transit stop; the
  // caller is told which rule it broke, not only that the days were refused.
  it("refuses days holding a travel leg on a non-transit stop, naming the rule", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await kyotoPlaybook(secret);

    const res = await patch(secret, playbook.savedDayId, {
      days: [{ stops: [inlineStop("Walk", { mode: "walk" })] }],
      expectedVersion: 1,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("mode is only allowed on a transit stop");
  });

  it("requires expectedVersion for content, and at least one field", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await kyotoPlaybook(secret);
    expect((await patch(secret, playbook.savedDayId, { name: "No version" })).status).toBe(400);
    expect((await patch(secret, playbook.savedDayId, {})).status).toBe(400);
  });
});

describe("reading Playbooks", () => {
  it("reads another person's published Playbook, and 404s their private one", async () => {
    const author = await entitled();
    const authorSecret = await tokenFor(author);
    const shared = (await inline(authorSecret, { name: "Shared", days: [{ stops: [inlineStop("A")] }] })).playbook;
    const kept = (await inline(authorSecret, { name: "Kept", days: [{ stops: [inlineStop("B")] }] })).playbook;
    expect((await patch(authorSecret, shared.savedDayId, { visibility: "public" })).status).toBe(200);

    const reader = await tokenFor(await entitled());
    const open = await GET_PLAYBOOK(req(reader), P({ playbookId: shared.savedDayId }));
    expect(open.status).toBe(200);
    expect(((await open.json()) as SavedDay).savedDayId).toBe(shared.savedDayId);
    const closed = await GET_PLAYBOOK(req(reader), P({ playbookId: kept.savedDayId }));
    expect(closed.status).toBe(404);

    // `?visibility=` filters your own list, and only your own.
    const url = (v: string) => new Request(`http://localhost/x?visibility=${v}`, { headers: { authorization: `Bearer ${authorSecret}` } });
    const pub = (await (await LIST_PLAYBOOKS(url("public"), NO_PARAMS)).json()).items.map((d: SavedDay) => d.savedDayId);
    const priv = (await (await LIST_PLAYBOOKS(url("private"), NO_PARAMS)).json()).items.map((d: SavedDay) => d.savedDayId);
    expect(pub).toEqual([shared.savedDayId]);
    expect(priv).toEqual([kept.savedDayId]);
  });
});

describe("/v1/library is unchanged by Pass A", () => {
  it("PATCH still takes only { visibility }: a name alone is refused, and a name beside it is ignored", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = (await inline(secret, { name: "Library day", days: [{ stops: [inlineStop("A")] }] })).playbook;
    const lib = (body: unknown) => PATCH_LIBRARY(req(secret, body, "PATCH"), P({ savedDayId: playbook.savedDayId }));

    expect((await lib({ name: "Renamed" })).status).toBe(400);
    const res = await lib({ visibility: "public", name: "Renamed" });
    expect(res.status).toBe(200);
    const day = await res.json();
    expect(day.name).toBe("Library day");
    // The library's DTO is the one it published: no `version`, no `summary`.
    expect(Object.keys(day)).not.toContain("version");
    expect(Object.keys(day)).not.toContain("summary");
    const listed = (await (await LIST_LIBRARY(req(secret), NO_PARAMS)).json()).items[0];
    expect(Object.keys(listed)).not.toContain("version");
  });
});

// ---- ADR-050, Pass B --------------------------------------------------------

type Applied = {
  tripId: string;
  playbookId: string;
  playbookVersion: number;
  dayIds: string[];
  createdDayIds: string[];
  activityIds: string[];
  historySeq: number;
  warnings: Record<string, unknown>[];
};

const applyReq = (secret: string, body: unknown, key?: string) =>
  new Request("http://localhost/api/v1/trips/x/playbook-applications", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...(key === undefined ? {} : { "Idempotency-Key": key }),
    },
    body: JSON.stringify(body),
  });

async function headSeq(secret: string, tripId: string): Promise<number> {
  const history = (await (await HISTORY(req(secret), P({ tripId }))).json()) as { entries: { toSeq: number }[] };
  return history.entries[0]!.toSeq;
}

/** A trip with `n` days, the first holding one 09:00–10:00 stop. */
async function tripWithDays(owner: string, n: number): Promise<{ tripId: string; dayIds: string[]; busy: string }> {
  const tripId = await emptyTrip(owner);
  const dayIds = Array.from({ length: n }, () => randomUUID());
  for (const dayId of dayIds) {
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId }, owner)).ok).toBe(true);
  }
  const busy = randomUUID();
  const added = await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: busy,
      dayId: dayIds[0]!,
      title: "Already here",
      timeWindow: { start: "09:30", end: "10:30" },
    },
    owner,
  );
  expect(added.ok).toBe(true);
  return { tripId, dayIds, busy };
}

/** Three Playbook days, one stop each, the middle one at 13:00 so it overlaps nothing. */
async function threeStopPlaybook(secret: string): Promise<SavedDay> {
  return (
    await inline(secret, {
      name: "Three",
      days: [
        { stops: [inlineStop("One")] },
        { stops: [inlineStop("Two", { timeWindow: { start: "13:00", end: "14:00" } })] },
        { stops: [inlineStop("Three", { timeWindow: { start: "15:00", end: "16:00" } })] },
      ],
    })
  ).playbook;
}

describe("POST /v1/trips/{tripId}/playbook-applications — preconditions", () => {
  it("refuses a stale Playbook version with 409 and the current one, and writes nothing", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    expect((await patch(secret, playbook.savedDayId, { name: "Renamed", expectedVersion: 1 })).status).toBe(200);
    const { tripId } = await tripWithDays(owner, 1);
    const before = await tripOf(owner, tripId);

    const res = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId, version: 1 }), P({ tripId }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.details).toEqual({ currentVersion: 2 });
    expect(await tripOf(owner, tripId)).toEqual(before);

    const ok = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId, version: 2 }), P({ tripId }));
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as Applied).playbookVersion).toBe(2);
  });

  it("refuses a stale expectedTripSeq with 409 and the current seq, and writes nothing", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const { tripId } = await tripWithDays(owner, 1);
    const seq = await headSeq(secret, tripId);
    const before = await tripOf(owner, tripId);

    const res = await APPLY(
      applyReq(secret, { playbookId: playbook.savedDayId, expectedTripSeq: seq - 1 }),
      P({ tripId }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.details).toEqual({ currentSeq: seq });
    expect(await tripOf(owner, tripId)).toEqual(before);
    expect(await headSeq(secret, tripId)).toBe(seq);
  });

  it("applies when expectedTripSeq is current, and the answer's historySeq is the next precondition", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const { tripId } = await tripWithDays(owner, 1);

    const res = await APPLY(
      applyReq(secret, { playbookId: playbook.savedDayId, expectedTripSeq: await headSeq(secret, tripId) }),
      P({ tripId }),
    );
    expect(res.status).toBe(201);
    const applied = (await res.json()) as Applied;
    const again = await APPLY(
      applyReq(secret, { playbookId: playbook.savedDayId, expectedTripSeq: applied.historySeq }),
      P({ tripId }),
    );
    expect(again.status).toBe(201);
  });
});

describe("POST /v1/trips/{tripId}/playbook-applications — startingAt", () => {
  it("merges onto existing days, appends only the overflow, and one undo restores the trip exactly", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    // Days A, B, C; start on B, so Playbook days 0 and 1 land on B and C and
    // day 2 is the only one added.
    const { tripId, dayIds } = await tripWithDays(owner, 3);
    const before = await tripOf(owner, tripId);
    const entriesBefore = (await (await HISTORY(req(secret), P({ tripId }))).json()).entries.length;

    const res = await APPLY(
      applyReq(secret, { playbookId: playbook.savedDayId, placement: { mode: "startingAt", dayId: dayIds[1] } }),
      P({ tripId }),
    );
    expect(res.status).toBe(201);
    const applied = (await res.json()) as Applied;
    expect(applied.createdDayIds).toHaveLength(1);
    expect(applied.dayIds).toEqual([dayIds[1], dayIds[2], applied.createdDayIds[0]]);

    const after = await tripOf(owner, tripId);
    expect(after.days.map((d) => d.dayId)).toEqual([...dayIds, applied.createdDayIds[0]]);
    for (const [i, stop] of playbook.stops.entries()) {
      const landed = after.days.find((d) => d.activityIds.includes(applied.activityIds[i]!))!;
      expect(landed.dayId, stop.title).toBe(applied.dayIds[stop.dayIndex]);
    }
    // What was on day A is where it was.
    expect(after.days[0]!.activityIds).toEqual(before.days[0]!.activityIds);

    const entries = (await (await HISTORY(req(secret), P({ tripId }))).json()).entries;
    expect(entries).toHaveLength(entriesBefore + 1);
    expect(entries[0].toSeq).toBe(applied.historySeq);

    expect((await UNDO(req(secret, {}, "POST"), P({ tripId }))).status).toBe(200);
    const restored = await tripOf(owner, tripId);
    expect({ days: restored.days, activities: restored.activities, conflicts: restored.conflicts }).toEqual({
      days: before.days,
      activities: before.activities,
      conflicts: before.conflicts,
    });
  });

  it("answers a stale expectedTripSeq with 409 even when the day it names has since been removed", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const { tripId, dayIds } = await tripWithDays(owner, 2);
    const seq = await headSeq(secret, tripId);
    expect((await executeTripCommand({ type: "RemoveDay", tripId, dayId: dayIds[1]! }, owner)).ok).toBe(true);

    const res = await APPLY(
      applyReq(secret, {
        playbookId: playbook.savedDayId,
        placement: { mode: "startingAt", dayId: dayIds[1] },
        expectedTripSeq: seq,
      }),
      P({ tripId }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.details).toEqual({ currentSeq: await headSeq(secret, tripId) });
  });

  it("refuses a day that is not in the trip with 400, and writes nothing", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const { tripId } = await tripWithDays(owner, 1);
    const seq = await headSeq(secret, tripId);

    const res = await APPLY(
      applyReq(secret, { playbookId: playbook.savedDayId, placement: { mode: "startingAt", dayId: randomUUID() } }),
      P({ tripId }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid-request");
    expect(await headSeq(secret, tripId)).toBe(seq);
  });
});

describe("POST /v1/trips/{tripId}/playbook-applications — Idempotency-Key", () => {
  it("replays the same body with Idempotent-Replayed, and the trip gains the days once", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const tripId = await emptyTrip(owner);
    const key = randomUUID();

    const first = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }));
    expect(first.status).toBe(201);
    expect(first.headers.get("Idempotent-Replayed")).toBeNull();
    const second = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }));
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
    expect((await tripOf(owner, tripId)).days).toHaveLength(3);
  });

  it("refuses the same key with a different body with 400", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const tripId = await emptyTrip(owner);
    const key = randomUUID();

    expect((await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }))).status).toBe(201);
    const res = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId, version: 1 }, key), P({ tripId }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Idempotency-Key reused with a different request.");
    expect((await tripOf(owner, tripId)).days).toHaveLength(3);
  });

  it("does not replay one user's key for another", async () => {
    const author = await entitled();
    const authorSecret = await tokenFor(author);
    const playbook = await threeStopPlaybook(authorSecret);
    expect((await patch(authorSecret, playbook.savedDayId, { visibility: "public" })).status).toBe(200);
    const target = await emptyTrip(author);
    // The other user is an editor on the same trip, sending the same body.
    const editor = await entitled();
    const invite = await createInvite(target, author, { role: "editor", email: null });
    await acceptInvite(invite.token, editor);
    const key = randomUUID();

    const a = await APPLY(applyReq(authorSecret, { playbookId: playbook.savedDayId }, key), P({ tripId: target }));
    const b = await APPLY(
      applyReq(await tokenFor(editor), { playbookId: playbook.savedDayId }, key),
      P({ tripId: target }),
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("Idempotent-Replayed")).toBeNull();
    expect((await tripOf(author, target)).days).toHaveLength(6);
  });

  it("does not keep a 409 from a race lost at the append: the retry with the same key runs", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const tripId = await emptyTrip(owner);
    const key = randomUUID();
    vi.mocked(executeTripCommandBatch).mockResolvedValueOnce({
      ok: false,
      error: { code: "concurrency-conflict", message: "Lost the race." },
    });

    const lost = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }));
    expect(lost.status).toBe(409);
    const retried = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }));
    expect(retried.status).toBe(201);
    expect(retried.headers.get("Idempotent-Replayed")).toBeNull();
    expect((await tripOf(owner, tripId)).days).toHaveLength(3);
  });

  it("keeps a 500 raised after the apply committed: the retry replays it and applies nothing twice", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const tripId = await emptyTrip(owner);
    const key = randomUUID();
    const real = (await vi.importActual<typeof import("@/server/commands")>("@/server/commands"))
      .executeTripCommandBatch;
    // The real batch commits; only its answer is made unusable afterwards.
    vi.mocked(executeTripCommandBatch).mockImplementationOnce(async (...args) => {
      const result = await real(...args);
      return result.ok ? { ...result, history: { ...result.history, entries: [] } } : result;
    });

    const broken = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }));
    expect(broken.status).toBe(500);
    const retried = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }));
    expect(retried.status).toBe(500);
    expect(retried.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await tripOf(owner, tripId)).days).toHaveLength(3);
  });

  it("keeps a 409 for a stale expectedTripSeq: the same key replays it", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const { tripId } = await tripWithDays(owner, 1);
    const stale = { playbookId: playbook.savedDayId, expectedTripSeq: (await headSeq(secret, tripId)) - 1 };
    const key = randomUUID();

    expect((await APPLY(applyReq(secret, stale, key), P({ tripId }))).status).toBe(409);
    const again = await APPLY(applyReq(secret, stale, key), P({ tripId }));
    expect(again.status).toBe(409);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("runs again once the key is more than 24 hours old", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const tripId = await emptyTrip(owner);
    const key = randomUUID();
    expect((await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }))).status).toBe(201);

    await db
      .update(apiIdempotencyKeys)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(and(eq(apiIdempotencyKeys.userId, owner), eq(apiIdempotencyKeys.key, key)));

    const again = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }, key), P({ tripId }));
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotent-Replayed")).toBeNull();
    expect((await tripOf(owner, tripId)).days).toHaveLength(6);
  });
});

describe("POST /v1/trips/{tripId}/playbook-applications — warnings", () => {
  it("reports a time overlap the apply introduced, and keeps the stop", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const playbook = await threeStopPlaybook(secret);
    const { tripId, dayIds, busy } = await tripWithDays(owner, 1);

    const res = await APPLY(
      applyReq(secret, { playbookId: playbook.savedDayId, placement: { mode: "startingAt", dayId: dayIds[0] } }),
      P({ tripId }),
    );
    expect(res.status).toBe(201);
    const applied = (await res.json()) as Applied;
    // "One" is 09:00–10:00 and lands beside "Already here" at 09:30–10:30.
    const one = applied.activityIds[0]!;
    expect(applied.warnings).toEqual([
      expect.objectContaining({
        code: "conflict",
        activityIds: expect.arrayContaining([one, busy]),
        conflictId: expect.stringContaining("time-overlap"),
      }),
    ]);
    expect((await tripOf(owner, tripId)).activities[one]).toBeDefined();
  });

  it("warns when a weekday-anchored stop lands on a dated day that is another weekday", async () => {
    const owner = await entitled();
    const secret = await tokenFor(owner);
    const tripId = await emptyTrip(owner);
    // 2027-06-07 is a Monday.
    const dated = await executeTripCommand(
      { type: "SetTripDates", tripId, startDate: "2027-06-07", endDate: "2027-06-07", newDayIds: [randomUUID()] },
      owner,
    );
    expect(dated.ok).toBe(true);
    const { playbook } = await inline(secret, {
      name: "Sundays",
      days: [{ stops: [inlineStop("Market", { anchors: [{ kind: "dayOfWeek", days: ["sun"] }] })] }],
    });

    const res = await APPLY(applyReq(secret, { playbookId: playbook.savedDayId }), P({ tripId }));
    expect(res.status).toBe(201);
    const applied = (await res.json()) as Applied;
    expect(applied.warnings).toContainEqual(
      expect.objectContaining({ code: "weekday-mismatch", activityId: applied.activityIds[0] }),
    );
  });
});
