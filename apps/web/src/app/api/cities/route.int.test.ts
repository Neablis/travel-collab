import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CityMatch } from "@/lib/cities";
import { executeTripCommand } from "@/server/commands";

// City search (M11b link 2), against the real index.
//
// The index is global by construction — it aggregates every published day in
// the database — so nothing here can assert on a shared name like "Kyoto"
// without depending on what other tests and other runs have left behind. Every
// city these tests search for is therefore minted fresh (see `city` below),
// which is the same answer KI-57 reached for ids and the reason no truncation
// is needed.
const RUN = randomUUID().slice(0, 8);
const AUTHOR = `cities-author-${RUN}`;
const READER = `cities-reader-${RUN}`;

// A city name nothing else in the index can collide with — per TEST, not per
// run, because these tests publish days and the index is cumulative: two tests
// sharing a name would make the second one's expected count a function of
// whether the first had run. Capitalised on purpose; the search is
// case-insensitive and one test asserts that.
const city = (stem: string) => `${stem}ish${randomUUID().slice(0, 8)}`;

let currentUserId = AUTHOR;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");
const { POST: SAVE } = await import("../saved-days/route");
const { POST: PUBLISH } = await import("../saved-days/[savedDayId]/publish/route");

/** A saved day touching `cities`, owned by whoever is signed in. */
async function saveDayIn(cities: string[]): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, currentUserId);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, currentUserId);
  for (const [i, city] of cities.entries()) {
    await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: `Stop in ${city}`,
        timeWindow: { start: `0${i + 8}:00`, end: `0${i + 9}:00` },
        location: { name: `Somewhere in ${city}`, city },
      },
      currentUserId,
    );
  }
  const res = await SAVE(
    new Request("http://test/x", {
      method: "POST",
      body: JSON.stringify({ name: `Day ${randomUUID()}`, tripId, dayId }),
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
}

async function publish(savedDayId: string): Promise<void> {
  const res = await PUBLISH(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ savedDayId }),
  });
  expect(res.status).toBe(200);
}

async function search(q: string): Promise<{ status: number; cities: CityMatch[] }> {
  const res = await GET(new Request(`http://test/api/cities?q=${encodeURIComponent(q)}`));
  const body = (await res.json().catch(() => ({}))) as { cities?: CityMatch[] };
  return { status: res.status, cities: body.cities ?? [] };
}

beforeEach(() => {
  currentUserId = AUTHOR;
});

describe("GET /api/cities", () => {
  it("401s when unauthenticated", async () => {
    currentUserId = "";
    const res = await GET(new Request("http://test/api/cities?q=Kyoto"));
    expect(res.status).toBe(401);
  });

  // Geocode's shape, deliberately: an empty box is not a search for everything,
  // and the short-circuit is before any work.
  it("answers an empty or blank query with an empty list, not everything", async () => {
    const savedDayId = await saveDayIn([city("Kyoto")]);
    await publish(savedDayId);

    expect(await search("")).toEqual({ status: 200, cities: [] });
    expect(await search("   ")).toEqual({ status: 200, cities: [] });
  });

  it("returns a matching city with how many published days touch it", async () => {
    const kyoto = city("Kyoto");
    await publish(await saveDayIn([kyoto]));
    await publish(await saveDayIn([kyoto, city("Kobe")]));

    const { status, cities } = await search(kyoto);
    expect(status).toBe(200);
    expect(cities).toEqual([{ city: kyoto, days: 2 }]);
  });

  it("matches on a prefix, case-insensitively, and not on a substring", async () => {
    const kyoto = city("Kyoto");
    await publish(await saveDayIn([kyoto]));

    expect((await search(kyoto.toLowerCase())).cities).toEqual([{ city: kyoto, days: 1 }]);
    // The tail is inside the name, but it is not what anybody is typing towards.
    expect((await search(kyoto.slice(1))).cities).toEqual([]);
  });

  // The "no city matches" state PR3 renders: a real 200 with nothing in it,
  // distinguishable from a failure.
  it("answers an unmatched query with an empty list and a 200", async () => {
    expect(await search(`nowhere-${RUN}`)).toEqual({ status: 200, cities: [] });
  });

  // A public index must not report a number only a private day explains.
  it("counts only published days, and a private day leaks no city at all", async () => {
    const kyoto = city("Kyoto");
    await saveDayIn([kyoto]); // left private
    expect((await search(kyoto)).cities).toEqual([]);

    await publish(await saveDayIn([kyoto]));
    expect((await search(kyoto)).cities).toEqual([{ city: kyoto, days: 1 }]);
  });

  it("unpublishing takes the day back out of the count", async () => {
    const kyoto = city("Kyoto");
    const savedDayId = await saveDayIn([kyoto]);
    await publish(savedDayId);
    expect((await search(kyoto)).cities).toEqual([{ city: kyoto, days: 1 }]);

    const { DELETE: UNPUBLISH } = await import("../saved-days/[savedDayId]/publish/route");
    await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ savedDayId }),
    });
    expect((await search(kyoto)).cities).toEqual([]);
  });

  it("serves another signed-in account the same index — it is a public one", async () => {
    const kyoto = city("Kyoto");
    await publish(await saveDayIn([kyoto]));
    currentUserId = READER;
    expect((await search(kyoto)).cities).toEqual([{ city: kyoto, days: 1 }]);
  });

  // A city called "100%" is a search for that city, not a wildcard for every
  // city in the index.
  it("treats LIKE metacharacters in the query as literal text", async () => {
    await publish(await saveDayIn([city("Kyoto")]));
    expect((await search("%")).cities).toEqual([]);
    expect((await search("_")).cities).toEqual([]);
  });
});
