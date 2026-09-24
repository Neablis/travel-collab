import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverResponse } from "@/lib/playbooks";
import { eq } from "drizzle-orm";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";
import { putReview } from "@/server/reviews";

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
    new Request("http://test/x", { method: "POST", body: JSON.stringify({ name, tripId, dayIds: [dayId] }) }),
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

/** Take a day into a brand-new DATED trip. */
async function addToDatedTrip(savedDayId: string): Promise<string> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Target" }, currentUserId!);
  // `newDayIds` is required: SetTripDates mints the trip's days and the domain
  // is pure, so the ids come in with the command (contracts/trip.ts). Checked
  // rather than fired and forgotten — the dating is no longer what makes the add
  // count (the clause was dropped 2026-09-08), but these tests read a trip that
  // has days in it, and a silently failed dating would leave them reading an
  // empty one.
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

  // M12 link 5: the two sorts that waited for reviews. The counters are written
  // through the database because the review write path is not built yet. Three
  // days whose order differs under every sort: "rated" beats "popular" on
  // rating and loses on count, and the unrated day must come LAST on
  // highest-rated — `desc` alone would put its null first.
  it("sorts highest-rated with unrated days last, and most-reviewed by count", async () => {
    const c = city("rate");
    const rated = `Rated ${RUN}`;
    const popular = `Popular ${RUN}`;
    const unrated = `Unrated ${RUN}`;
    const ids = {
      [rated]: await saveDay(rated, [{ city: c }]),
      [popular]: await saveDay(popular, [{ city: c }]),
      [unrated]: await saveDay(unrated, [{ city: c }]),
    };
    for (const id of Object.values(ids)) await publish(id);
    await db.update(savedDays).set({ rating: 4.8, reviewCount: 2 }).where(eq(savedDays.id, ids[rated]!));
    await db.update(savedDays).set({ rating: 3.5, reviewCount: 9 }).where(eq(savedDays.id, ids[popular]!));

    currentUserId = READER;
    const highest = (await discover(`city=${c}&sort=highest-rated`)).body;
    expect(names(highest)).toEqual([rated, popular, unrated]);
    expect(highest.days.map((d) => [d.rating, d.reviewCount])).toEqual([[4.8, 2], [3.5, 9], [null, 0]]);
    expect(names((await discover(`city=${c}&sort=most-reviewed`)).body)).toEqual([popular, rated, unrated]);
  });

  // §15's fourth filter (M12 D9). Rated through the real write path, so the
  // floor is tested against counters the reviews produced rather than numbers
  // written beside them. Inclusive at the boundary — a 4.0 day is "4+ stars" —
  // and every floor above `any` drops the unrated day; an unknown floor falls
  // back to `any`, like every other parameter here.
  it("floors on the average rating, inclusively, and drops unrated days", async () => {
    const c = city("floor");
    const days: Record<string, number[]> = {
      [`Four and a half ${RUN}`]: [5, 4],
      [`Four ${RUN}`]: [4],
      [`Three ${RUN}`]: [3],
      [`Unrated ${RUN}`]: [],
    };
    for (const [name, stars] of Object.entries(days)) {
      const id = await saveDay(name, [{ city: c }]);
      await publish(id);
      for (const [i, s] of stars.entries()) await putReview(id, `floor-reviewer-${RUN}-${i}`, { stars: s, note: null });
    }

    currentUserId = READER;
    const floored = async (rating: string) =>
      names((await discover(`city=${c}&sort=highest-rated&rating=${rating}`)).body);
    const [half, four, three, unrated] = Object.keys(days);
    expect(await floored("4.5")).toEqual([half]);
    expect(await floored("4")).toEqual([half, four]);
    expect(await floored("3")).toEqual([half, four, three]);
    expect(await floored("any")).toEqual([half, four, three, unrated]);
    expect(await floored("five-stars")).toEqual([half, four, three, unrated]);
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

  // A chip counted the whole MATCH while the page showed the BAND, so with a
  // band on it promised days the page below it did not hold (KI-2026-08-31).
  // The band cannot be a SQL predicate — a day's total is a sum over its priced
  // stops, and ADR-029 says `stops` is a value that is never queried into — so
  // the chips are counted in application code over the same in-band set the
  // cards are drawn from.
  it("counts a sibling chip inside the budget band, not across the whole match", async () => {
    const a = city("ba");
    const sib = city("bb");
    // Three days touch both cities. One is under $200; the other two are not,
    // so `budget=under200` must leave the chip reading 1 rather than 3.
    await publish(await saveDay(`Band cheap ${RUN}`, [{ city: a, costMinor: 1_000 }, { city: sib }]));
    await publish(await saveDay(`Band dear ${RUN}`, [{ city: a, costMinor: 150_000 }, { city: sib }]));
    await publish(await saveDay(`Band dearer ${RUN}`, [{ city: a, costMinor: 250_000 }, { city: sib }]));

    currentUserId = READER;
    const { body } = await discover(`city=${a}&budget=under200`);
    expect(body.days).toHaveLength(1);
    expect(body.siblings.find((s) => s.city === sib)).toEqual({ city: sib, days: 1 });

    // And the unbanded read still sees all three, so this is the band being
    // honoured rather than the chips being counted over the page.
    const any = await discover(`city=${a}`);
    expect(any.body.days).toHaveLength(3);
    expect(any.body.siblings.find((s) => s.city === sib)).toEqual({ city: sib, days: 3 });
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

  // `Everyone` is a SUPERSET of the other two, not "the public half" (Mitchell,
  // 2026-09-01: "Everyone tab for playbooks should also include my trips, it's
  // an 'Everyone' superset"). It was public-only, which made the widest option
  // of the segment narrower than `Yours`: your own private day appeared under
  // `Yours` and vanished under `Everyone`, which reads as the filter losing it.
  //
  // The half that must NOT change is the other one: somebody else's private day
  // is still unreachable in every scope.
  it("shows YOUR private day in both Yours and Everyone, and nobody else's anywhere", async () => {
    const only = city("mine");
    const name = `Private ${RUN}`;
    await saveDay(name, [{ city: only }]);

    expect(names((await discover(`city=${only}&scope=yours`)).body)).toContain(name);
    expect(names((await discover(`city=${only}&scope=everyone`)).body)).toContain(name);

    currentUserId = READER;
    expect(names((await discover(`city=${only}&scope=yours`)).body)).not.toContain(name);
    expect(names((await discover(`city=${only}&scope=everyone`)).body)).not.toContain(name);
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

  it("filters on a day's total cost, and reports the currency it compared in", async () => {
    const only = city("bud");
    const cheap = `Cheap ${RUN}`;
    const dear = `Dear ${RUN}`;
    await publish(await saveDay(cheap, [{ city: only, costMinor: 1_000 }]));
    await publish(await saveDay(dear, [{ city: only, costMinor: 150_000 }]));

    currentUserId = READER;
    const under = await discover(`city=${only}&budget=under200`);
    expect(names(under.body)).toContain(cheap);
    expect(names(under.body)).not.toContain(dear);
    expect(under.body.budgetCurrency).toBe("USD");

    const over = await discover(`city=${only}&budget=over1000`);
    expect(names(over.body)).toEqual([dear]);
    expect(over.body.days[0]!.totalCost).toEqual({ amountMinor: 150_000, currency: "USD" });
  });

  // The four bands' edges are $200/$500/$1,000 (Mitchell, Vercel toolbar
  // comment on `/playbooks` at 411px, 2026-09-01 — see `BudgetBand` in
  // lib/playbooks.ts for the mutually-exclusive-ranges reading). Each band's
  // lower edge is inclusive and its upper edge is exclusive, so a day priced
  // at EXACTLY one of the three edges belongs to the band ABOVE it, not the
  // one below — pinned here at all three, since that is a decision a query
  // string alone does not make visible.
  it("puts a day priced at exactly $200, $500 or $1,000 in the band above, not below", async () => {
    const only = city("edge");
    const at200 = `AtTwoHundred ${RUN}`;
    const at500 = `AtFiveHundred ${RUN}`;
    const at1000 = `AtOneThousand ${RUN}`;
    await publish(await saveDay(at200, [{ city: only, costMinor: 20_000 }]));
    await publish(await saveDay(at500, [{ city: only, costMinor: 50_000 }]));
    await publish(await saveDay(at1000, [{ city: only, costMinor: 100_000 }]));

    currentUserId = READER;
    expect(names((await discover(`city=${only}&budget=under200`)).body)).toEqual([]);
    expect(names((await discover(`city=${only}&budget=200to500`)).body)).toEqual([at200]);
    expect(names((await discover(`city=${only}&budget=500to1000`)).body)).toEqual([at500]);
    expect(names((await discover(`city=${only}&budget=over1000`)).body)).toEqual([at1000]);
  });

  // A day with nothing priced is not "under" any budget — it does not say what
  // it costs, and answering "cheap" for it would be inventing a number.
  it("leaves an unpriced day out of every band except Any", async () => {
    const only = city("unp");
    const name = `Unpriced ${RUN}`;
    await publish(await saveDay(name, [{ city: only }]));

    currentUserId = READER;
    expect(names((await discover(`city=${only}&budget=any`)).body)).toContain(name);
    expect(names((await discover(`city=${only}&budget=under200`)).body)).not.toContain(name);
    expect((await discover(`city=${only}`)).body.days[0]!.totalCost).toBeNull();
  });

  // A link written against §15's four sorts, or from the future, shows results
  // rather than a broken page — and never reaches a query as a raw string.
  // `budget=mid` is also, deliberately, an "unrecognised" value now: it was
  // the old three-band enum's middle option, and the new four-band enum has
  // no member by that name (see `BudgetBand` in lib/playbooks.ts) — a stale
  // link should fall back to `any` rather than silently landing on whichever
  // new band happens to occupy that string.
  it("falls back on an unrecognised sort, scope or budget instead of failing", async () => {
    const only = city("fall");
    const name = `Fallback ${RUN}`;
    await publish(await saveDay(name, [{ city: only }]));

    currentUserId = READER;
    const { status, body } = await discover(
      `city=${only}&sort=loudest&scope=galaxy&budget=mid&season=harvest`,
    );
    expect(status).toBe(200);
    expect(names(body)).toContain(name);
  });

  // **The season filter is cut** (M26 link 2, SPEC §33.2). It filtered on the
  // month a day was run, and §33.2's rule — a place is a tab, a question is a
  // chip, a property of the list rides the sentence about the list — left it
  // nowhere to live. The predicate is gone from `server/playbooks.ts` and the
  // param is gone from the route.
  //
  // This test is the old one INVERTED rather than deleted. A filter removed
  // with nothing asserting its absence is one that quietly comes back: the
  // SQL is still shaped to take another `and` clause, `seasonOfMonth` is still
  // exported, and `?season=` is still a URL anyone can type. Asserting that
  // all four values return the same day is what makes a reland fail loudly
  // here instead of silently narrowing Discover in production.
  //
  // **The concept is not cut.** `SEASON_MONTHS` and `seasonOfMonth` stay —
  // `pnpm content:verify` prints season occupancy and is a separate consumer.
  //
  // This needs none of the `created_at` UTC-rollover care the filtering
  // version needed (CodeRabbit, PR 104). That machinery existed only to work
  // out which season was the day's own; with the predicate gone, every season
  // answers alike, so there is no month-boundary race left to lose.
  it("ignores season entirely — every season returns the same day", async () => {
    const only = city("season");
    const name = `Seasonal ${RUN}`;
    await publish(await saveDay(name, [{ city: only }]));

    currentUserId = READER;
    for (const season of ["spring", "summer", "fall", "winter"]) {
      expect(names((await discover(`city=${only}&season=${season}`)).body), season).toContain(name);
    }
    // And no season at all is the same answer, not a different one.
    expect(names((await discover(`city=${only}`)).body)).toContain(name);
  });

  // `sharedDayCount` is what decides whether Discover shows the leaderboard
  // link at all ("Who shares the most should be hidden when nothing to share").
  // It must ignore every filter on the query — a Hakone search that matches
  // nothing is not an empty library — which is exactly what a count derived
  // from `days.length` would get wrong.
  it("reports the whole library's published count, unaffected by the query", async () => {
    const only = city("count");
    await publish(await saveDay(`Counted ${RUN}`, [{ city: only }]));

    currentUserId = READER;
    const matching = await discover(`city=${only}`);
    expect(matching.body.days.length).toBeGreaterThan(0);
    expect(matching.body.sharedDayCount).toBeGreaterThanOrEqual(matching.body.days.length);

    // A query that matches nothing at all, in the same library.
    const empty = await discover(`city=${city("nomatch")}`);
    expect(empty.body.days).toHaveLength(0);
    expect(empty.body.sharedDayCount).toBe(matching.body.sharedDayCount);
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
    expect(day.totalCost).toEqual({ amountMinor: 6_500, currency: "USD" });
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

  // KI-2026-09-23-h: the results sentence read `days.length`, so a query
  // matching 30 days said "24 shared days". `matchCount` is how many days the
  // same filters match, not how many fit on the page.
  it("counts every matching day, not just the page", async () => {
    currentUserId = `disc-count-${RUN}`;
    const only = city("count");
    for (let i = 0; i < 30; i += 1) {
      await publish(await saveDay(`Count ${i} ${RUN}`, [{ city: only }]));
    }
    const { body } = await discover(`city=${only}`);
    expect(body.days).toHaveLength(24);
    expect(body.matchCount).toBe(30);
    expect(body.matchCountExact).toBe(true);

    // A complete answer counts exactly what it shows.
    const single = city("countone");
    await publish(await saveDay(`Count single ${RUN}`, [{ city: single }]));
    const exact = await discover(`city=${single}`);
    expect(exact.body.matchCount).toBe(1);
    expect(exact.body.matchCountExact).toBe(true);
  });

  // Past the 200-row candidate window the count cannot come from the rows that
  // were read — it is a count under the same WHERE, filters included. Rows are
  // inserted directly: 205 trips through the routes would take minutes.
  it("counts past the candidate window, under the same filters", async () => {
    const owner = `disc-window-${RUN}`;
    currentUserId = owner;
    const only = city("window");
    const createdAt = new Date("2026-06-01T12:00:00.000Z");
    await db.insert(savedDays).values(
      Array.from({ length: 205 }, (_, i) => ({
        id: randomUUID(),
        ownerId: owner,
        name: `Window ${i} ${RUN}`,
        stops: [],
        cities: [only],
        // Five are two-day sequences, so `length=two-three` narrows the count to them.
        dayCount: i < 5 ? 2 : 1,
        visibility: "private" as const,
        sourceTripId: randomUUID(),
        sourceTripName: "Source",
        createdAt,
      })),
    );

    const all = await discover(`city=${only}&scope=yours`);
    expect(all.body.days).toHaveLength(24);
    expect(all.body.truncated).toBe(true);
    expect(all.body.matchCount).toBe(205);
    expect(all.body.matchCountExact).toBe(true);

    const narrowed = await discover(`city=${only}&scope=yours&length=two-three`);
    expect(narrowed.body.matchCount).toBe(5);

    // The budget band runs in application code over the window, so past the
    // window the count is a floor and says so rather than claiming exactness.
    // These rows carry no priced stops, so no band admits any of them.
    const banded = await discover(`city=${only}&scope=yours&budget=under200`);
    expect(banded.body.days).toHaveLength(0);
    expect(banded.body.matchCountExact).toBe(false);
    expect(banded.body.matchCount).toBe(0);
  });

  it("marks your own day as yours in the everyone scope", async () => {
    const only = city("own");
    const name = `Own ${RUN}`;
    await publish(await saveDay(name, [{ city: only }]));
    const day = (await discover(`city=${only}`)).body.days.find((d) => d.name === name)!;
    expect(day.isMine).toBe(true);
  });
});
