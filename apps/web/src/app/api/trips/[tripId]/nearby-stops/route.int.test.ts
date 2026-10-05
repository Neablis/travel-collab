import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NearbyStopsResponse, SavedStop, type NearbyStop } from "@tc/contracts";
import { locationFactory } from "@tc/factories";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";
import { newSavedDayRow } from "@/server/savedDays";

// M34's gate box: the route returns another person's published stop in the
// day's city, and never a private, deleted or moderated day's stop or the
// reader's own; a non-member gets the trip-access refusal. Against real
// Postgres, because every one of those exclusions is a WHERE clause.
//
// The trip is built through the real command path; the library rows are
// written directly, as `playbooks.places.int.test.ts` writes them — what the
// query reads is the columns, not how a day came to be published.
//
// The city is minted per run: the library is global across the int lane, and a
// shared name like "Kyoto" would rank other files' days.
const RUN = randomUUID().slice(0, 8);
const CITY = `Nearbytown${RUN}`;
const READER = `nearby-reader-${RUN}`;
const AUTHOR = `nearby-author-${RUN}`;
const STRANGER = `nearby-stranger-${RUN}`;

let currentUserId = READER;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");

const ids: string[] = [];
let tripId: string;
let dayId: string;

/** A published day by `ownerId` with one stop called `title` in `city`; `columns` override the published state. */
async function libraryDay(
  ownerId: string,
  title: string,
  columns: Partial<typeof savedDays.$inferInsert> = {},
  city = CITY,
): Promise<string> {
  const row = newSavedDayRow({
    ownerId,
    name: `${title}'s day`,
    stops: [
      SavedStop.parse({
        title,
        timeWindow: { start: "10:00", end: "11:30" },
        location: locationFactory.build({ name: title, city, lat: 10, lng: 10, precision: "venue" }),
        notes: null,
        anchors: [],
        kind: "planned",
        tags: ["outdoors"],
        cost: null,
      }),
    ],
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, visibility: "public", publishedAt: new Date(), ...columns });
  ids.push(row.id);
  return row.id;
}

async function nearby(query = `dayId=${dayId}`): Promise<{ status: number; stops: NearbyStop[] }> {
  const res = await GET(new Request(`http://test/api/trips/${tripId}/nearby-stops?${query}`), {
    params: Promise.resolve({ tripId }),
  });
  if (res.status !== 200) return { status: res.status, stops: [] };
  return { status: 200, stops: NearbyStopsResponse.parse(await res.json()).stops };
}

beforeAll(async () => {
  tripId = randomUUID();
  dayId = randomUUID();
  const run = async (command: Parameters<typeof executeTripCommand>[0]) => {
    const result = await executeTripCommand(command, READER);
    if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result)}`);
  };
  await run({ type: "CreateTrip", tripId, name: "Nearby" });
  await run({ type: "AddDay", tripId, dayId });
  await run({
    type: "AddActivity",
    tripId,
    activityId: randomUUID(),
    dayId,
    title: "Hotel",
    location: locationFactory.build({ name: "Hotel", city: CITY }),
  });
});

beforeEach(() => {
  currentUserId = READER;
});

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("GET /api/trips/:tripId/nearby-stops", () => {
  it("returns another person's published stop in the day's city, as the contract shapes it", async () => {
    const savedDayId = await libraryDay(AUTHOR, "Published temple");
    const { status, stops } = await nearby();
    expect(status).toBe(200);
    expect(stops).toEqual([
      expect.objectContaining({
        title: "Published temple",
        kind: "planned",
        tags: ["outdoors"],
        lengthMinutes: 90,
        savedDayId,
        savedDayName: "Published temple's day",
        playbookCount: 1,
      }),
    ]);
  });

  // D6, each exclusion its own row so a regression names the clause it lost.
  it.each([
    ["a private day", AUTHOR, { visibility: "private" as const }],
    ["a deleted day", AUTHOR, { deletedAt: new Date() }],
    ["a moderated day", AUTHOR, { moderatedAt: new Date() }],
    ["the reader's own public day", READER, {}],
  ])("never returns a stop from %s", async (_label, ownerId, columns) => {
    const title = `Hidden ${randomUUID().slice(0, 6)}`;
    const control = `Shown ${randomUUID().slice(0, 6)}`;
    await libraryDay(ownerId, title, columns);
    await libraryDay(AUTHOR, control);
    const { status, stops } = await nearby();
    expect(status).toBe(200);
    // The control is what makes the absence mean something: an empty answer
    // would pass `not.toContain` too.
    expect(stops.map((s) => s.title)).toContain(control);
    expect(stops.map((s) => s.title)).not.toContain(title);
  });

  // Held twice — the query's `cities &&` and the ranking's city rule (D1) — so
  // this goes red only when both go. Either alone still answers correctly.
  it("does not return a public day in another city", async () => {
    const title = `Elsewhere ${randomUUID().slice(0, 6)}`;
    const control = `Shown ${randomUUID().slice(0, 6)}`;
    await libraryDay(AUTHOR, title, {}, `Othertown${RUN}`);
    await libraryDay(AUTHOR, control);
    const { stops } = await nearby();
    expect(stops.map((s) => s.title)).toContain(control);
    expect(stops.map((s) => s.title)).not.toContain(title);
  });

  it("refuses a non-member as trip access does", async () => {
    currentUserId = STRANGER;
    expect((await nearby()).status).toBe(403);
  });

  it("refuses half a point, and an empty one", async () => {
    expect((await nearby(`dayId=${dayId}&lat=10`)).status).toBe(400);
    expect((await nearby(`lat=&lng=`)).status).toBe(400);
  });
});
