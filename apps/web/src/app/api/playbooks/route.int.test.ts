import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverResponse } from "@/lib/playbooks";
import { executeTripCommand } from "@/server/commands";

// Discover's day search (M11b link 5), against the real containment query.
//
// Every city these tests search for is MINTED FRESH, for `cities/route.int.
// test.ts`'s reason: the published library is global by construction, so a test
// asserting on a shared name like "Kyoto" would depend on what other tests and
// other runs left behind. A minted stem also makes "matched vs also" assertions
// exact rather than "at least".
const RUN = randomUUID().slice(0, 8);
const AUTHOR = `disc-author-${RUN}`;
const OTHER = `disc-other-${RUN}`;
const READER = `disc-reader-${RUN}`;

const city = (stem: string) => `${stem}${randomUUID().slice(0, 8)}`;

let currentUserId: string | null = AUTHOR;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");
const { POST: SAVE } = await import("../saved-days/route");
const { POST: PUBLISH, DELETE: UNPUBLISH } = await import(
  "../saved-days/[savedDayId]/publish/route"
);
const { POST: INSERT } = await import("../trips/[tripId]/saved-days/[savedDayId]/route");

type Stop = { city: string | null; costMinor?: number; currency?: string };

async function buildTrip(stops: Stop[]): Promise<{ tripId: string; dayId: string }> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, currentUserId!);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, currentUserId!);
  for (const [i, stop] of stops.entries()) {
    await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: `Stop ${i + 1}`,
        timeWindow: { start: `${String(i + 8).padStart(2, "0")}:00`, end: `${String(i + 9).padStart(2, "0")}:00` },
        ...(stop.city === null ? {} : { location: { name: `Place ${i}`, city: stop.city } }),
        ...(stop.costMinor === undefined
          ? {}
          : { cost: { amountMinor: stop.costMinor, currency: stop.currency ?? "USD" } }),
      },
      currentUserId!,
    );
  }
  return { tripId, dayId };
}

/** A saved day over `stops`, owned by whoever is signed in. Private until published. */
async function saveDay(name: string, stops: Stop[]): Promise<string> {
  const { tripId, dayId } = await buildTrip(stops);
  const res = await SAVE(
    new Request("http://test/x", { method: "POST", body: JSON.stringify({ name, tripId, dayId }) }),
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

async function unpublish(savedDayId: string): Promise<void> {
  const res = await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
    params: Promise.resolve({ savedDayId }),
  });
  expect(res.status).toBe(200);
}

/** Take a day into a brand-new DATED trip, so the add counts (link 4's rule). */
async function addToDatedTrip(savedDayId: string): Promise<string> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Target" }, currentUserId!);
  // `newDayIds` is required: SetTripDates mints the trip's days and the domain
  // is pure, so the ids come in with the command (contracts/trip.ts). Checked
  // rather than fired and forgotten — an undated trip is exactly the state the
  // add rule refuses to count, so a silently failed dating would make these
  // tests assert the rule while proving nothing.
  const dated = await executeTripCommand(
    {
      type: "SetTripDates",
      tripId,
      startDate: "2027-04-01",
      endDate: "2027-04-02",
      newDayIds: [randomUUID(), randomUUID()],
    },
    currentUserId!,
  );
  if (!dated.ok) throw new Error(`could not date the trip: ${dated.error.message}`);
  const res = await INSERT(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ tripId, savedDayId }),
  });
  expect(res.status).toBe(200);
  return tripId;
}

async function discover(qs: string): Promise<{ status: number; body: DiscoverResponse }> {
  const res = await GET(new Request(`http://test/api/playbooks?${qs}`));
  const body = (await res.json().catch(() => ({}))) as DiscoverResponse;
  return { status: res.status, body };
}

const names = (body: DiscoverResponse) => body.days.map((d) => d.name);

beforeEach(() => {
  currentUserId = AUTHOR;
});

describe("GET /api/playbooks", () => {
  it("refuses an anonymous read", async () => {
    currentUserId = null;
    const { status } = await discover("city=Kyoto");
    expect(status).toBe(401);
  });

  // The exit-gate line: "a query for one city returns a day that contains it
  // AMONG OTHERS, with the matched city filled and the rest outlined".
  it("matches a day on ANY city it contains, and says which one matched", async () => {
    const kyoto = city("kyo");
    const uji = city("uji");
    const name = `Kyoto and Uji ${RUN}`;
    const id = await saveDay(name, [{ city: kyoto }, { city: uji }]);
    await publish(id);

    currentUserId = READER;
    const { body } = await discover(`city=${kyoto}`);
    const day = body.days.find((d) => d.name === name);
    expect(day).toBeDefined();
    // Filled vs outlined is `matchedCities` against `cities`; the card renders
    // the difference, and this is the data that difference is drawn from.
    expect(day!.matchedCities).toEqual([kyoto]);
    expect(day!.cities).toEqual([kyoto, uji]);
  });

  // Containment is EXACT, and this pins it as a decision rather than an
  // oversight: `cities && ARRAY[...]` is what the GIN index serves and it does
  // not case-fold. Every city name the UI sends came back from
  // `GET /api/cities`, so the two ends agree because the names travel from the
  // index rather than from a keyboard.
  it("matches a city exactly, so a card's chips keep the day's own spelling", async () => {
    const stem = city("Kyo");
    const name = `Cased ${RUN}`;
    await publish(await saveDay(name, [{ city: stem }]));

    currentUserId = READER;
    const { body } = await discover(`city=${stem.toUpperCase()}`);
    expect(names(body)).not.toContain(name);
    const exact = await discover(`city=${stem}`);
    expect(names(exact.body)).toContain(name);
  });

  it("ranks matched-city count before the chosen sort", async () => {
    const a = city("aa");
    const b = city("bb");
    const one = `One match ${RUN}`;
    const two = `Two matches ${RUN}`;
    // The ONE-city day is added to a dated trip so its `adds` is higher. If the
    // sort ran first it would come out on top; matched-city count is what has
    // to override it.
    const oneId = await saveDay(one, [{ city: a }]);
    const twoId = await saveDay(two, [{ city: a }, { city: b }]);
    await publish(oneId);
    await publish(twoId);
    currentUserId = OTHER;
    await addToDatedTrip(oneId);

    currentUserId = READER;
    const { body } = await discover(`city=${a}&city=${b}&sort=most-added`);
    const ours = names(body).filter((n) => n === one || n === two);
    expect(ours).toEqual([two, one]);
    expect(body.days.find((d) => d.name === one)!.adds).toBe(1);
  });

  // §15's sibling chips: "cities present in the current result set but absent
  // from the query, with counts".
  it("surfaces sibling cities from the matched set, never the queried one", async () => {
    const a = city("sa");
    const sib = city("sb");
    await publish(await saveDay(`Sib one ${RUN}`, [{ city: a }, { city: sib }]));
    await publish(await saveDay(`Sib two ${RUN}`, [{ city: a }, { city: sib }]));

    currentUserId = READER;
    const { body } = await discover(`city=${a}`);
    expect(body.siblings.find((s) => s.city === a)).toBeUndefined();
    expect(body.siblings.find((s) => s.city === sib)).toEqual({ city: sib, days: 2 });
  });

  // An empty query is not a search for nothing — it is the "busy right now" row.
  //
  // Asserted in the `yours` scope with an owner used by no other test in this
  // file. The chip row is capped at 12 and ordered by day count, and the
  // published library is cumulative across every test and every run — so in the
  // `everyone` scope a two-day city genuinely may not make the cut, and an
  // assertion that it does would be an assertion about the rest of the suite.
  // The path under test (empty query ⇒ no subtraction ⇒ busiest first) is the
  // same one either way.
  it("answers an empty query with the busiest cities rather than no chips", async () => {
    currentUserId = `disc-busy-${RUN}`;
    const busy = city("busy");
    const quiet = city("quiet");
    await publish(await saveDay(`Busy one ${RUN}`, [{ city: busy }]));
    await publish(await saveDay(`Busy two ${RUN}`, [{ city: busy }, { city: quiet }]));

    const { body } = await discover("scope=yours");
    expect(body.siblings).toEqual([
      { city: busy, days: 2 },
      { city: quiet, days: 1 },
    ]);
  });

  // The exit-gate box, the Discover half: publishing makes a day findable by
  // ANOTHER signed-in account, unpublishing takes it back out of their results.
  it("shows a published day to another account and hides it again on unpublish", async () => {
    const only = city("pub");
    const name = `Published ${RUN}`;
    const id = await saveDay(name, [{ city: only }]);

    currentUserId = READER;
    expect(names((await discover(`city=${only}`)).body)).not.toContain(name);

    currentUserId = AUTHOR;
    await publish(id);
    currentUserId = READER;
    expect(names((await discover(`city=${only}`)).body)).toContain(name);

    currentUserId = AUTHOR;
    await unpublish(id);
    currentUserId = READER;
    expect(names((await discover(`city=${only}`)).body)).not.toContain(name);
  });

  it("shows YOUR private day in the Yours scope and nobody else's anywhere", async () => {
    const only = city("mine");
    const name = `Private ${RUN}`;
    await saveDay(name, [{ city: only }]);

    expect(names((await discover(`city=${only}&scope=yours`)).body)).toContain(name);
    expect(names((await discover(`city=${only}&scope=everyone`)).body)).not.toContain(name);

    currentUserId = READER;
    expect(names((await discover(`city=${only}&scope=yours`)).body)).not.toContain(name);
  });

  // "Saved" is the adds ledger, and it is not a grant: an author who withdraws
  // a day takes it out of the results of everyone who took it, too.
  it("lists days you have taken, and drops one whose author unpublished it", async () => {
    const only = city("saved");
    const name = `Taken ${RUN}`;
    const id = await saveDay(name, [{ city: only }]);
    await publish(id);

    currentUserId = READER;
    await addToDatedTrip(id);
    expect(names((await discover(`scope=saved&city=${only}`)).body)).toContain(name);

    currentUserId = AUTHOR;
    await unpublish(id);
    currentUserId = READER;
    expect(names((await discover(`scope=saved&city=${only}`)).body)).not.toContain(name);
  });

  it("filters on budget per person, and reports the currency it compared in", async () => {
    const only = city("bud");
    const cheap = `Cheap ${RUN}`;
    const dear = `Dear ${RUN}`;
    await publish(await saveDay(cheap, [{ city: only, costMinor: 1_000 }]));
    await publish(await saveDay(dear, [{ city: only, costMinor: 20_000 }]));

    currentUserId = READER;
    const under = await discover(`city=${only}&budget=under`);
    expect(names(under.body)).toContain(cheap);
    expect(names(under.body)).not.toContain(dear);
    expect(under.body.budgetCurrency).toBe("USD");

    const over = await discover(`city=${only}&budget=over`);
    expect(names(over.body)).toEqual([dear]);
    expect(over.body.days[0]!.budgetPerPerson).toEqual({ amountMinor: 20_000, currency: "USD" });
  });

  // A day with nothing priced is not "under" any budget — it does not say what
  // it costs, and answering "cheap" for it would be inventing a number.
  it("leaves an unpriced day out of every band except Any", async () => {
    const only = city("unp");
    const name = `Unpriced ${RUN}`;
    await publish(await saveDay(name, [{ city: only }]));

    currentUserId = READER;
    expect(names((await discover(`city=${only}&budget=any`)).body)).toContain(name);
    expect(names((await discover(`city=${only}&budget=under`)).body)).not.toContain(name);
    expect((await discover(`city=${only}`)).body.days[0]!.budgetPerPerson).toBeNull();
  });

  // A link written against §15's four sorts, or from the future, shows results
  // rather than a broken page — and never reaches a query as a raw string.
  it("falls back on an unrecognised sort, scope or budget instead of failing", async () => {
    const only = city("fall");
    const name = `Fallback ${RUN}`;
    await publish(await saveDay(name, [{ city: only }]));

    currentUserId = READER;
    const { status, body } = await discover(
      `city=${only}&sort=highest-rated&scope=galaxy&budget=free&month=99`,
    );
    expect(status).toBe(200);
    expect(names(body)).toContain(name);
  });

  it("derives the card's facts from the day's stops", async () => {
    const only = city("fact");
    const name = `Facts ${RUN}`;
    await publish(
      await saveDay(name, [
        { city: only, costMinor: 2_500 },
        { city: null },
        { city: only, costMinor: 4_000 },
      ]),
    );

    currentUserId = READER;
    const day = (await discover(`city=${only}`)).body.days.find((d) => d.name === name)!;
    expect(day.stopCount).toBe(3);
    expect(day.window).toEqual({ start: "08:00", end: "11:00" });
    expect(day.budgetPerPerson).toEqual({ amountMinor: 6_500, currency: "USD" });
    // The day touches one city, twice — `citiesOfStops` collapses duplicates,
    // so this is "how many cities", not "how many placed stops".
    expect(day.cities).toEqual([only]);
    expect(day.isMine).toBe(false);
  });

  // `truncated` is the only thing standing between a reader and a silently
  // short page: there is no pagination, and the page's answer to it is "narrow
  // the cities". It used to report ONLY the 200-row candidate window, so a
  // query matching 25 to 199 days returned 24 cards flagged as the complete set
  // (CodeRabbit, PR 102). 25 days is one over the page.
  it("says a page is truncated when more days matched than fit on it", async () => {
    currentUserId = `disc-many-${RUN}`;
    const only = city("many");
    for (let i = 0; i < 25; i += 1) {
      await publish(await saveDay(`Many ${i} ${RUN}`, [{ city: only }]));
    }

    const { body } = await discover(`city=${only}`);
    expect(body.days).toHaveLength(24);
    expect(body.truncated).toBe(true);

    // …and it is not simply always true: the same query narrowed to a city with
    // one day is a complete answer and says so.
    const single = city("one");
    await publish(await saveDay(`Single ${RUN}`, [{ city: single }]));
    const exact = await discover(`city=${single}`);
    expect(exact.body.days).toHaveLength(1);
    expect(exact.body.truncated).toBe(false);
  });

  it("marks your own day as yours in the everyone scope", async () => {
    const only = city("own");
    const name = `Own ${RUN}`;
    await publish(await saveDay(name, [{ city: only }]));
    const day = (await discover(`city=${only}`)).body.days.find((d) => d.name === name)!;
    expect(day.isMine).toBe(true);
  });
});
