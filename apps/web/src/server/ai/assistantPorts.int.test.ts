import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { SavedStop, type ActivityTag } from "@tc/contracts";
import { PLACE_PAGE_SIZE, slugify } from "@/lib/playbookUrls";
import type { PlaybookDiscoverSearch } from "@/server/assistant/admission";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";
import { newSavedDayRow } from "@/server/savedDays";
import { readPlaybookList } from "./assistantPorts";

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
