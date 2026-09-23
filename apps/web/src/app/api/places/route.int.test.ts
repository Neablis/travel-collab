import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { locationFactory } from "@tc/factories";
import type { PlaceMatch } from "@/lib/cities";
import type { DiscoverResponse } from "@/lib/playbooks";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";

// Place search (M12 link 7), against the real index and the real save path —
// so `countries` here is whatever `newSavedDayRow` derived, not a value the
// test wrote.
//
// **Countries cannot be minted fresh the way `cities/route.int.test.ts` mints
// city names** — there are only so many ISO codes, and the index is cumulative
// across every file in the run. So every country count below is a DELTA from a
// reading taken inside the same test. The int lane runs files one at a time
// (`fileParallelism: false`), which is what makes a delta exact.
const RUN = randomUUID().slice(0, 8);
const AUTHOR = `places-author-${RUN}`;

let currentUserId = AUTHOR;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");
const { GET: DISCOVER } = await import("../playbooks/route");
const { POST: SAVE } = await import("../saved-days/route");
const { POST: PUBLISH } = await import("../saved-days/[savedDayId]/publish/route");

type Place = { city: string; countryCode: string };

/** A saved day with one timed stop per place, in order, owned by whoever is signed in. */
async function saveDayAt(places: Place[]): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, currentUserId);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, currentUserId);
  for (const [i, { city, countryCode }] of places.entries()) {
    await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: `Stop in ${city}`,
        timeWindow: { start: `${String(i + 8).padStart(2, "0")}:00`, end: `${String(i + 9).padStart(2, "0")}:00` },
        location: locationFactory.build({ name: `Somewhere in ${city}`, city, countryCode }),
      },
      currentUserId,
    );
  }
  const res = await SAVE(
    new Request("http://test/x", {
      method: "POST",
      body: JSON.stringify({ name: `Day ${randomUUID()}`, tripId, dayIds: [dayId] }),
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

async function search(q: string): Promise<{ status: number; places: PlaceMatch[] }> {
  const res = await GET(new Request(`http://test/api/places?q=${encodeURIComponent(q)}`));
  const body = (await res.json().catch(() => ({}))) as { places?: PlaceMatch[] };
  return { status: res.status, places: body.places ?? [] };
}

/** How many published days the index says touch country `code`, 0 when it is absent. */
async function countryDays(q: string, code: string): Promise<number> {
  const hit = (await search(q)).places.find((p) => p.kind === "country" && p.countryCode === code);
  return hit?.days ?? 0;
}

async function discover(query: string): Promise<string[]> {
  const res = await DISCOVER(new Request(`http://test/api/playbooks?${query}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as DiscoverResponse).days.map((d) => d.savedDayId);
}

beforeEach(() => {
  currentUserId = AUTHOR;
});

describe("GET /api/places", () => {
  it("401s when unauthenticated", async () => {
    currentUserId = "";
    const res = await GET(new Request("http://test/api/places?q=Mex"));
    expect(res.status).toBe(401);
  });

  it("answers an empty or blank query with an empty list, not everything", async () => {
    expect(await search("")).toEqual({ status: 200, places: [] });
    expect(await search("   ")).toEqual({ status: 200, places: [] });
  });

  // The exit gate's box: "a country's day count equals the published days that
  // touch it, counted once per day however many of that country's cities the
  // day visits". Three stops in two Mexican cities, one of them twice, is one
  // day — a count of 3 (stop-hits) or 2 (city-hits) is the defect.
  it("counts a multi-city day once for its country", async () => {
    const before = await countryDays("Mexico", "MX");
    await publish(
      await saveDayAt([
        { city: "Mexico City", countryCode: "MX" },
        { city: "Puebla", countryCode: "MX" },
        { city: "Mexico City", countryCode: "MX" },
      ]),
    );
    expect(await countryDays("Mexico", "MX")).toBe(before + 1);

    await publish(await saveDayAt([{ city: "Oaxaca", countryCode: "MX" }]));
    expect(await countryDays("Mexico", "MX")).toBe(before + 2);
  });

  // The index is public, so only published, live, unmoderated days count — the
  // `searchCities` rule, plus moderation (D5).
  it("does not count a private day or a moderated one", async () => {
    const before = await countryDays("Monaco", "MC");
    await saveDayAt([{ city: "Monte Carlo", countryCode: "MC" }]); // left private
    expect(await countryDays("Monaco", "MC")).toBe(before);

    const moderated = await saveDayAt([{ city: "Monte Carlo", countryCode: "MC" }]);
    await publish(moderated);
    expect(await countryDays("Monaco", "MC")).toBe(before + 1);
    await db.update(savedDays).set({ moderatedAt: new Date() }).where(eq(savedDays.id, moderated));
    expect(await countryDays("Monaco", "MC")).toBe(before);
  });

  // Matched on the name, never on the code (see `searchPlaces`): `mc` is not a
  // prefix of "Monaco", so it must not find Monaco.
  it("matches a country by its name's prefix, case-insensitively, and not by its code", async () => {
    await publish(await saveDayAt([{ city: "Monte Carlo", countryCode: "MC" }]));
    const country = (q: string) =>
      search(q).then((r) => r.places.filter((p) => p.kind === "country" && p.countryCode === "MC"));
    expect(await country("mona")).toEqual([{ kind: "country", countryCode: "MC", name: "Monaco", days: expect.any(Number) }]);
    expect(await country("mc")).toEqual([]);
  });

  // The collision link 7 is about. `Mexic` must offer the country and the city
  // as two DIFFERENT, labelled things — and choosing each must filter Discover
  // differently: the country's set holds a day the city's does not.
  it("offers the country Mexico and the city Mexico City for `Mexic`, and each filters Discover differently", async () => {
    const inTheCity = await saveDayAt([
      { city: "Mexico City", countryCode: "MX" },
      { city: "Puebla", countryCode: "MX" },
    ]);
    const elsewhereInMexico = await saveDayAt([{ city: "Oaxaca", countryCode: "MX" }]);
    await publish(inTheCity);
    await publish(elsewhereInMexico);

    const { status, places } = await search("Mexic");
    expect(status).toBe(200);
    const country = places.find((p) => p.kind === "country");
    const city = places.find((p) => p.kind === "city" && p.city === "Mexico City");
    expect(country).toMatchObject({ kind: "country", countryCode: "MX", name: "Mexico" });
    expect(city).toMatchObject({ kind: "city", city: "Mexico City" });
    // A country's days are a superset of its cities', so it leads the list.
    expect(places.indexOf(country!)).toBeLessThan(places.indexOf(city!));

    const byCity = await discover(`city=${encodeURIComponent("Mexico City")}`);
    const byCountry = await discover("country=MX");
    expect(byCity).toContain(inTheCity);
    expect(byCity).not.toContain(elsewhereInMexico);
    expect(byCountry).toContain(inTheCity);
    expect(byCountry).toContain(elsewhereInMexico);
  });

  it("puts an exact country name first", async () => {
    await publish(await saveDayAt([{ city: "Mexico City", countryCode: "MX" }]));
    const { places } = await search("mexico");
    expect(places[0]).toMatchObject({ kind: "country", countryCode: "MX" });
  });
});

describe("GET /api/playbooks?country=", () => {
  // Every other parameter's rule: an unusable value stops narrowing rather
  // than breaking the page. Measured against a fresh city so "stops narrowing"
  // has a set to compare with.
  it("uppercases a code and drops one that is not two letters", async () => {
    const city = `Guadalajara${RUN}`;
    const day = await saveDayAt([{ city, countryCode: "MX" }]);
    await publish(day);

    // Beside a city the day is NOT in, so a dropped `mx` would leave a filter
    // this day fails, rather than an unfiltered browse it would pass anyway.
    expect(await discover(`city=Nowhere${RUN}&country=mx`)).toContain(day);
    expect(await discover(`city=${city}&country=Mexico`)).toEqual(await discover(`city=${city}`));
  });

  // D7: a day matches ANY selected place, and each selected place it touches
  // counts one towards `matched_count`, whichever kind. Asking for one city and
  // two countries: a day across both countries scores two, a day in the city
  // scores one — so the two-country day leads, although the city day is newer
  // and would win the most-added tiebreak (`created_at desc`). A day touching
  // none of the three is not in the set at all. Belize and Guatemala because
  // no other test here publishes there; `scope=yours` keeps the set to this
  // author's days.
  it("ORs cities with countries and ranks by places matched across both kinds", async () => {
    const tag = `Tlaxcala${RUN}`;
    const twoCountries = await saveDayAt([
      { city: `Belmopan${RUN}`, countryCode: "BZ" },
      { city: `Flores${RUN}`, countryCode: "GT" },
    ]);
    const oneCity = await saveDayAt([{ city: tag, countryCode: "PE" }]);
    const neither = await saveDayAt([{ city: `Lima${RUN}`, countryCode: "PE" }]);
    for (const id of [twoCountries, oneCity, neither]) await publish(id);

    const ids = await discover(`city=${tag}&country=BZ&country=GT&scope=yours`);
    expect(ids).toEqual([twoCountries, oneCity]);
  });
});
