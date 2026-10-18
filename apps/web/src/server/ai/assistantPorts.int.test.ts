import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { SavedStop, type ActivityTag, type TripDetail } from "@tc/contracts";
import { PLACE_PAGE_SIZE, slugify } from "@/lib/playbookUrls";
import type { PlaybookDiscoverSearch } from "@/server/assistant/admission";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";
import { newSavedDayRow } from "@/server/savedDays";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail, listTripSummariesVisibleTo } from "@/server/projections";
import { withEffectiveMembersByTrip } from "@/server/access/members";
import { readAccountTrips, readPlaybookList } from "./assistantPorts";

// M45 D9: a playbook list page's assistant reads the list on screen, and
// nothing past it. Each list kind against real rows, in places minted per run:
// the published library is global, so a shared city would count other files'
// days.

const run = randomUUID().slice(0, 6);
const READER = `list-reader-${run}`;
const OTHER = `list-other-${run}`;
const ids: string[] = [];

/** `count` stops, each tagged `tags`: four nightlife stops make a Late-night day. */
const stops = (count: number, tags: ActivityTag[]): SavedStop[] =>
  Array.from({ length: count }, (_, i) =>
    SavedStop.parse({ title: `Stop ${i}`, timeWindow: null, location: null, notes: null, anchors: [], kind: "planned", tags, cost: null }),
  );

// Written directly, as `playbooks.tags.int.test.ts` does: what matters is the
// columns the reads read.
async function day(city: string, { owner = OTHER, tags = [] as ActivityTag[], publishedAt = new Date() } = {}): Promise<string> {
  const row = newSavedDayRow({
    ownerId: owner,
    name: `Day ${ids.length}`,
    stops: tags.length === 0 ? [] : stops(4, tags),
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: publishedAt,
  });
  await db.insert(savedDays).values({ ...row, cities: [city], visibility: "public", publishedAt });
  ids.push(row.id);
  return row.id;
}

const ago = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12) - minutes * 60_000);

const listed = async (page: Parameters<typeof readPlaybookList>[0]) =>
  (await readPlaybookList(page, READER)).map((d) => d.savedDayId);

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("readPlaybookList", () => {
  it("reads Discover by the screen's whole search: its tab, its sort and its page", async () => {
    const city = `Listdiscover${run}`;
    const older = await day(city, { owner: READER, publishedAt: ago(10) });
    const newer = await day(city, { owner: READER, publishedAt: ago(5) });
    const theirs = await day(city, { publishedAt: ago(1) });
    const search: PlaybookDiscoverSearch = {
      cities: [city],
      countries: [],
      scope: "yours",
      sort: "newest",
      budget: "any",
      length: "any",
      rating: "any",
      tag: "any",
      after: null,
    };

    expect(await listed({ kind: "discover", search })).toEqual([newer, older]);
    expect(await listed({ kind: "discover", search: { ...search, after: newer } })).toEqual([older]);
    expect(await listed({ kind: "discover", search: { ...search, scope: "everyone" } })).toEqual([theirs, newer, older]);
  });

  it("reads a city's page at its ?page=N, and no other city's days", async () => {
    const city = `Listcity${run}`;
    const here: string[] = [];
    for (let i = 0; i <= PLACE_PAGE_SIZE; i++) here.push(await day(city));
    await day(`Listelsewhere${run}`);

    const first = await listed({ kind: "city", slug: slugify(city), page: 1 });
    const second = await listed({ kind: "city", slug: slugify(city), page: 2 });
    expect(first).toHaveLength(PLACE_PAGE_SIZE);
    expect(second).toHaveLength(1);
    expect([...first, ...second].sort()).toEqual([...here].sort());
  });

  it("reads a tag's page in one city's page, or across the library", async () => {
    const city = `Listtag${run}`;
    const late = await day(city, { tags: ["nightlife"] });
    await day(city, { tags: ["meal"] });
    const lateElsewhere = await day(`Listtagelsewhere${run}`, { tags: ["nightlife"] });

    expect(await listed({ kind: "tag", tag: "nightlife", city: slugify(city), page: 1 })).toEqual([late]);
    // Across the library, the page runs past this run's days, so only
    // membership is this test's.
    const everywhere: string[] = [];
    for (let page = 1; !everywhere.includes(late) || !everywhere.includes(lateElsewhere); page++) {
      const next = await listed({ kind: "tag", tag: "nightlife", city: null, page });
      if (next.length === 0) break;
      everywhere.push(...next);
    }
    expect(everywhere).toEqual(expect.arrayContaining([late, lateElsewhere]));
  });
});

// The account read behind the cross-trip tools. It read one trip_details row
// per trip (Sentry's N+1) and now reads them in one statement, so it is held to
// the old answer and to a statement count that does not grow with the trips.
describe("readAccountTrips", () => {
  async function seedTrips(userId: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      const tripId = randomUUID();
      await executeTripCommand({ type: "CreateTrip", tripId, name: `Trip ${i}` }, userId);
      await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, userId);
    }
  }

  /** How many selects `readAccountTrips` issues for `userId`. */
  async function selectsFor(userId: string) {
    const select = vi.spyOn(db, "select");
    try {
      await readAccountTrips(userId);
      return select.mock.calls.length;
    } finally {
      select.mockRestore();
    }
  }

  it("answers what a detail read per trip answered, in the list's order", async () => {
    const userId = `account-${run}-${randomUUID()}`;
    await seedTrips(userId, 3);
    const listedTrips = await listTripSummariesVisibleTo(userId);
    const oneByOne = await Promise.all(listedTrips.map((row) => getTripDetail(row.tripId)));
    const before = await withEffectiveMembersByTrip(db, oneByOne.filter((d): d is TripDetail => d !== null));

    const trips = await readAccountTrips(userId);
    expect(trips).toHaveLength(3);
    expect(trips).toEqual(before);
  });

  it("issues as many selects for three trips as for one", async () => {
    const [one, three] = [`account-${run}-${randomUUID()}`, `account-${run}-${randomUUID()}`];
    await seedTrips(one, 1);
    await seedTrips(three, 3);
    expect(await selectsFor(three)).toBe(await selectsFor(one));
  });
});
