import { randomUUID } from "node:crypto";
import { expect, it, describe, vi } from "vitest";
import type { LeaderboardResponse, PublicProfileResponse } from "@/lib/playbooks";
import { executeTripCommand } from "@/server/commands";

// The leaderboard (M11b link 7) and the public profile (link 8), against the
// real ledger.
//
// The board is global by construction — it ranks everyone who has ever had a
// day taken — so nothing here asserts a POSITION. It asserts the two things the
// gate actually names: the numbers are the ledger's, and this run's two people
// sit in the ledger's order relative to each other. Cities are minted for
// `route.int.test.ts`'s reason.
const RUN = randomUUID().slice(0, 8);
const POPULAR = `board-popular-${RUN}`;
const QUIET = `board-quiet-${RUN}`;
const TAKER = `board-taker-${RUN}`;

const city = (stem: string) => `${stem}${randomUUID().slice(0, 8)}`;

let currentUserId: string | null = POPULAR;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET: BOARD } = await import("./route");
const { GET: PROFILE } = await import("../profile/[userId]/route");
const { GET: DISCOVER } = await import("../route");
const { POST: SAVE } = await import("../../saved-days/route");
const { POST: PUBLISH } = await import("../../saved-days/[savedDayId]/publish/route");
const { POST: INSERT } = await import("../../trips/[tripId]/saved-days/[savedDayId]/route");

async function saveDay(name: string, cityName: string): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, currentUserId!);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, currentUserId!);
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: `Stop in ${cityName}`,
      timeWindow: { start: "09:00", end: "10:00" },
      location: { name: `Place in ${cityName}`, city: cityName },
    },
    currentUserId!,
  );
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

/** Take a day into a fresh DATED trip, so the add counts (link 4's rule). */
async function take(savedDayId: string): Promise<void> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Target" }, currentUserId!);
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
}

async function board(): Promise<{ status: number; body: LeaderboardResponse }> {
  const res = await BOARD();
  return { status: res.status, body: (await res.json()) as LeaderboardResponse };
}

async function profile(userId: string): Promise<PublicProfileResponse> {
  const res = await PROFILE(new Request("http://test/x"), {
    params: Promise.resolve({ userId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PublicProfileResponse;
}

// The whole scenario, built once: two authors whose numbers could be swapped
// without either of them being obviously wrong (2 days/1 add vs 1 day/2 adds).
const CITY = city("board");
let popularDay: string;

{
  currentUserId = POPULAR;
  popularDay = await saveDay(`Popular ${RUN}`, CITY);
  await publish(popularDay);
  const quietOfPopular = await saveDay(`Also popular ${RUN}`, CITY);
  await publish(quietOfPopular);

  currentUserId = QUIET;
  const quietDay = await saveDay(`Quiet ${RUN}`, CITY);
  await publish(quietDay);

  // Two different people take the popular day into two different dated trips —
  // two ledger rows. The quiet author's day is taken by nobody.
  currentUserId = TAKER;
  await take(popularDay);
  currentUserId = QUIET;
  await take(popularDay);

  // The author taking their OWN day into their OWN dated trip: link 4's third
  // negative case, and the one that would inflate a board that counted raw
  // inserts. Present here so the board's number is proof the rule held.
  currentUserId = POPULAR;
  await take(popularDay);
}

describe("GET /api/playbooks/board", () => {
  it("refuses an anonymous read", async () => {
    currentUserId = null;
    expect((await board()).status).toBe(401);
    currentUserId = POPULAR;
  });

  it("counts the LEDGER, not raw inserts, and ranks on it", async () => {
    currentUserId = TAKER;
    const { body } = await board();
    const popular = body.authors.find((a) => a.userId === POPULAR)!;
    const quiet = body.authors.find((a) => a.userId === QUIET)!;

    // Three inserts happened against the popular day; two of them counted. The
    // author's own add is the one that did not.
    expect(popular.adds).toBe(2);
    expect(quiet.adds).toBe(0);
    // Days SHARED is the published count, and it is deliberately not the
    // ranking: the person with more days is not the person with more adds here,
    // so a board that ranked on post volume would order these two the other way.
    expect(popular.daysShared).toBe(2);
    expect(quiet.daysShared).toBe(1);

    const order = body.authors.map((a) => a.userId);
    expect(order.indexOf(POPULAR)).toBeLessThan(order.indexOf(QUIET));
  });

  it("tells the reader which row is theirs, without moving it", async () => {
    currentUserId = QUIET;
    const { body } = await board();
    expect(body.meUserId).toBe(QUIET);
    // Never pinned: the quiet author has fewer adds than the popular one and
    // stays below them on their OWN view of the board.
    const order = body.authors.map((a) => a.userId);
    expect(order.indexOf(POPULAR)).toBeLessThan(order.indexOf(QUIET));
  });

  it("ranks on adds sorted descending, over every row it returns", async () => {
    currentUserId = TAKER;
    const { body } = await board();
    const adds = body.authors.map((a) => a.adds);
    // The witness. "Already sorted" is true of a single row and of any run of
    // equal values, so without a floor this held whatever the board returned,
    // including one row (CodeRabbit, PR 102). The floors are what this run's
    // own seed guarantees rather than a guess: POPULAR sits at 2 adds and QUIET
    // at 0, so there are at least two rows carrying at least two values.
    expect(adds.length, "a one-row board is sorted by accident").toBeGreaterThan(1);
    expect(new Set(adds).size, "an all-equal board is sorted by accident").toBeGreaterThan(1);
    expect(adds).toEqual([...adds].sort((x, y) => y - x));
  });
});

describe("GET /api/playbooks/profile/:userId", () => {
  it("refuses an anonymous read", async () => {
    currentUserId = null;
    const res = await PROFILE(new Request("http://test/x"), {
      params: Promise.resolve({ userId: POPULAR }),
    });
    expect(res.status).toBe(401);
    currentUserId = POPULAR;
  });

  // The exit-gate box: "a profile's day count and adds AGREE with the same
  // person's numbers in Discover — checked against a seed where they could
  // disagree." The two are computed differently on purpose: the profile counts
  // the ledger, and a Discover card carries the denormalised `saved_days.adds`.
  // If those ever came apart, this is where it shows.
  it("agrees with Discover about the same person's days and adds", async () => {
    currentUserId = TAKER;
    const seen = await profile(POPULAR);

    const res = await DISCOVER(new Request(`http://test/api/playbooks?city=${CITY}`));
    const discovered = (await res.json()) as { days: { ownerId: string; adds: number; savedDayId: string }[] };
    const theirs = discovered.days.filter((d) => d.ownerId === POPULAR);

    expect(seen.author.daysShared).toBe(theirs.length);
    expect(seen.author.adds).toBe(theirs.reduce((sum, d) => sum + d.adds, 0));
    expect(seen.days.map((d) => d.savedDayId).sort()).toEqual(
      theirs.map((d) => d.savedDayId).sort(),
    );
  });

  it("derives the cities that person knows from their published days", async () => {
    currentUserId = TAKER;
    const seen = await profile(POPULAR);
    expect(seen.knows).toEqual([{ city: CITY, days: 2 }]);
  });

  // A private day is not shared, so it is not on the profile — even when the
  // reader IS its author. A profile is what other people see.
  // A profile is what OTHER people see, so its owner gets the same page: the
  // third day here is saved and never published, and must not appear for the
  // author any more than for a stranger.
  //
  // This is the test that caught `everyone` becoming a superset (2026-09-01):
  // the profile used to get "published only" for free from that scope, and the
  // moment the scope widened, an author saw three days where everybody else saw
  // two. The rule is now stated rather than implied — `publishedOnly` on the
  // query — and this is what holds it.
  it("shows the author the same page everybody else sees", async () => {
    currentUserId = POPULAR;
    await saveDay(`Kept back ${RUN}`, CITY);
    const mine = await profile(POPULAR);
    expect(mine.author.daysShared).toBe(2);
    expect(mine.days).toHaveLength(2);
    expect(mine.days.map((d) => d.name)).not.toContain(`Kept back ${RUN}`);
  });

  // A profile reached from a stale link is an honest empty page, not a 404 —
  // which would answer "does this account exist" for anyone who asked.
  it("answers for somebody with no days at all", async () => {
    currentUserId = TAKER;
    const nobody = await profile(`board-ghost-${RUN}`);
    expect(nobody.author).toEqual({
      userId: `board-ghost-${RUN}`,
      // The id is what the profile IS, and what the URL carries; the name is
      // what `displayNameFor` makes of it, which since 2026-09-01 is never the
      // raw identifier ("Dont show the UUID"). Asserted as the derived handle
      // rather than as the id, so a regression that started printing the id
      // again fails here. Six characters, not four (CodeRabbit, PR #104):
      // `displayNameFor` widened its suffix because four hex characters
      // collided too easily for a label the leaderboard ranks people by — see
      // `lib/displayName.ts`. `board-ghost-${RUN}` has no other non-alphanumeric
      // characters after RUN, so the compacted id's last six characters are
      // exactly RUN's last six.
      displayName: `Traveler ${RUN.slice(-6)}`,
      daysShared: 0,
      adds: 0,
    });
    expect(nobody.days).toEqual([]);
    expect(nobody.knows).toEqual([]);
  });
});
