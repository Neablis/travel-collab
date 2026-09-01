import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CityMatch } from "@/lib/cities";
import type { DiscoverResponse, LeaderboardResponse, PublicProfileResponse } from "@/lib/playbooks";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedDayAdds, savedDays } from "@/server/db/schema";

// Deleting a saved day (Mitchell, 2026-09-01: *"add a button to delete a
// notebook activity you own. It should require it to be unpublished first, and
// it doesn't remove it from anyone, it just removes it here."*).
//
// The delete is SOFT — `saved_days.deleted_at` — so the interesting assertions
// are not "is the row gone" but "does every read pretend it is". Six surfaces
// read this table and the whole risk of the feature is one of them being
// missed, so each is walked here rather than trusted to the predicate: Discover
// (both scopes), the sibling/city chips, the shared-day read, the leaderboard,
// a public profile, and the city index.
//
// Two actors and a minted city, fresh per TEST rather than per file (KI-69,
// and `savedDays.int.test.ts` carries the long version). The published library
// is global by construction: `daysShared`, a city chip's count and the board's
// numbers are all aggregates over whatever else is in the table, so a stem
// shared across this file's own tests makes each of them an assertion about the
// tests that ran before it. Minting per test lets every count below be an exact
// number rather than an "at least".
let AUTHOR = "";
let OTHER = "";
let CITY = "";
/**
 * A second city on every day, so the sibling-chip query has something to
 * return. `siblingCities` reports cities in the matched set that the query did
 * NOT ask for — with a single-city day there is nothing to report, and the
 * empty-query form of it is a top-twelve "busy right now" row a one-day city
 * cannot reach. Asking for CITY and looking for SIBLING is the only shape that
 * exercises that predicate on this fixture.
 */
let SIBLING = "";

let currentUserId: string | null = null;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET: READ, DELETE: REMOVE } = await import("./route");
const { POST: PUBLISH } = await import("./publish/route");
const { POST: SAVE } = await import("../route");
const { GET: DISCOVER } = await import("../../playbooks/route");
const { GET: BOARD } = await import("../../playbooks/board/route");
const { GET: PROFILE } = await import("../../playbooks/profile/[userId]/route");
const { GET: CITIES } = await import("../../cities/route");
const { POST: INSERT } = await import("../../trips/[tripId]/saved-days/[savedDayId]/route");

/** A two-stop day across the minted cities, saved by whoever is signed in. Private. */
async function saveDay(name: string): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  const actor = currentUserId!;
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, actor);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, actor);
  for (const [i, cityName] of [CITY, SIBLING].entries()) {
    await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: `Stop ${i + 1}`,
        timeWindow: { start: `0${8 + i}:00`, end: `1${6 + i}:00` },
        location: { name: `Somewhere ${i + 1}`, city: cityName },
        cost: { amountMinor: 1_000, currency: "USD" },
      },
      actor,
    );
  }
  const res = await SAVE(
    new Request("http://test/x", { method: "POST", body: JSON.stringify({ name, tripId, dayId }) }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
}

const remove = (savedDayId: string) =>
  REMOVE(new Request("http://test/x", { method: "DELETE" }), {
    params: Promise.resolve({ savedDayId }),
  });

const read = (savedDayId: string) =>
  READ(new Request("http://test/x"), { params: Promise.resolve({ savedDayId }) });

async function publish(savedDayId: string): Promise<void> {
  const res = await PUBLISH(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ savedDayId }),
  });
  expect(res.status).toBe(200);
}

async function discover(qs: string): Promise<DiscoverResponse> {
  const res = await DISCOVER(new Request(`http://test/api/playbooks?${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as DiscoverResponse;
}

async function profileOf(userId: string): Promise<PublicProfileResponse> {
  const res = await PROFILE(new Request("http://test/x"), {
    params: Promise.resolve({ userId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PublicProfileResponse;
}

async function boardRowFor(userId: string): Promise<LeaderboardResponse["authors"][number] | undefined> {
  const res = await BOARD();
  expect(res.status).toBe(200);
  const body = (await res.json()) as LeaderboardResponse;
  return body.authors.find((a) => a.userId === userId);
}

async function cityChip(): Promise<CityMatch | undefined> {
  const res = await CITIES(new Request(`http://test/api/cities?q=${CITY}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { cities: CityMatch[] };
  return body.cities.find((c) => c.city === CITY);
}

/** Take a day into a fresh DATED trip, so the add counts (link 4's rule). */
async function addToDatedTrip(savedDayId: string): Promise<void> {
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

async function deletedAtOf(savedDayId: string): Promise<Date | null> {
  const rows = await db
    .select({ deletedAt: savedDays.deletedAt })
    .from(savedDays)
    .where(eq(savedDays.id, savedDayId));
  return rows[0]?.deletedAt ?? null;
}

async function ledgerRows(savedDayId: string): Promise<number> {
  const rows = await db
    .select({ tripId: savedDayAdds.tripId })
    .from(savedDayAdds)
    .where(eq(savedDayAdds.savedDayId, savedDayId));
  return rows.length;
}

beforeEach(() => {
  const run = randomUUID().slice(0, 8);
  AUTHOR = `del-author-${run}`;
  OTHER = `del-other-${run}`;
  // Capitalised stem: `searchCities` matches on a prefix, and the chip
  // assertions want a name nothing else in the table can collide with.
  CITY = `Delcity${run}`;
  SIBLING = `Delsib${run}`;
  currentUserId = AUTHOR;
});

describe("DELETE /api/saved-days/:id", () => {
  it("401s an anonymous caller", async () => {
    const savedDayId = await saveDay("Anon");
    currentUserId = null;
    expect((await remove(savedDayId)).status).toBe(401);
    currentUserId = AUTHOR;
    expect(await deletedAtOf(savedDayId)).toBeNull();
  });

  it("lets the owner delete an unpublished day, and the day stops existing to every read", async () => {
    const savedDayId = await saveDay("Going away");
    expect((await read(savedDayId)).status).toBe(200);

    const res = await remove(savedDayId);
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });

    // The ROW is still there — that is the whole point of a soft delete, and
    // the only thing a future restore has to work with.
    expect(await deletedAtOf(savedDayId)).toBeInstanceOf(Date);
    // …and it is a 404 to its own author, exactly as a nonexistent id is.
    expect((await read(savedDayId)).status).toBe(404);
    expect((await read(randomUUID())).status).toBe(404);
  });

  // The rule Mitchell stated: "It should require it to be unpublished first."
  // A published day is REFUSED with a reason rather than silently unpublished
  // and deleted — taking a day out of everyone's Discover results must be a
  // decision its author makes, not a side effect of one.
  it("refuses a published day, tells the author why, and leaves it published", async () => {
    const savedDayId = await saveDay("Still out there");
    await publish(savedDayId);

    const res = await remove(savedDayId);
    expect(res.status).toBe(409);
    expect((await res.json()) as { code?: string }).toMatchObject({ code: "published" });

    expect(await deletedAtOf(savedDayId)).toBeNull();
    const after = (await (await read(savedDayId)).json()) as { savedDay: { visibility: string } };
    expect(after.savedDay.visibility).toBe("public");
  });

  // Non-disclosure, the property `access/saved-day-access.ts` exists to keep:
  // somebody else's day must be indistinguishable from one that never existed,
  // so a refusal cannot be used to probe ids. That means 404 and NOT the 409 a
  // published day of your own gets — a 409 here would confirm both that the id
  // names a day and that it is published.
  it("404s a non-owner identically to a nonexistent id, published or not", async () => {
    const privateDayId = await saveDay("Mine, private");
    const publicDayId = await saveDay("Mine, public");
    await publish(publicDayId);

    currentUserId = OTHER;
    expect((await remove(privateDayId)).status).toBe(404);
    expect((await remove(publicDayId)).status).toBe(404);
    expect((await remove(randomUUID())).status).toBe(404);

    currentUserId = AUTHOR;
    expect(await deletedAtOf(privateDayId)).toBeNull();
    expect(await deletedAtOf(publicDayId)).toBeNull();
  });

  it("answers not-found for a day already deleted", async () => {
    const savedDayId = await saveDay("Twice");
    expect((await remove(savedDayId)).status).toBe(200);
    expect((await remove(savedDayId)).status).toBe(404);
  });
});

// The half of this feature that is not the endpoint. Every read of `saved_days`
// has to filter the column out, and a missed one is invisible until somebody
// deletes a day and then finds it on a leaderboard.
describe("what a deleted day disappears from", () => {
  it("leaves Discover, the reader's own Yours scope, and the city chips", async () => {
    const savedDayId = await saveDay("Vanishing act");
    await publish(savedDayId);

    // Present first, so a later absence means "removed" rather than "this
    // query never returned it".
    expect((await discover(`city=${CITY}`)).days.map((d) => d.savedDayId)).toContain(savedDayId);
    expect((await discover(`city=${CITY}&scope=yours`)).days.map((d) => d.savedDayId)).toContain(
      savedDayId,
    );
    expect(await cityChip()).toEqual({ city: CITY, days: 1 });
    // The sibling chips run `matchPredicate` over the same matched set the
    // cards do, so they are checked here rather than assumed to follow.
    expect((await discover(`city=${CITY}`)).siblings).toContainEqual({ city: SIBLING, days: 1 });
    const sharedBefore = (await discover(`city=${CITY}`)).sharedDayCount;

    // Unpublish is what the product requires before a delete; going through the
    // real refusal path rather than writing the column by hand.
    const refused = await remove(savedDayId);
    expect(refused.status).toBe(409);
    const { DELETE: UNPUBLISH } = await import("./publish/route");
    expect(
      (
        await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
          params: Promise.resolve({ savedDayId }),
        })
      ).status,
    ).toBe(200);
    expect((await remove(savedDayId)).status).toBe(200);

    expect((await discover(`city=${CITY}`)).days.map((d) => d.savedDayId)).not.toContain(savedDayId);
    // `yours` is the scope that shows an author their OWN private days, so it
    // is the one place a deleted day could still surface to the person who
    // deleted it.
    expect((await discover(`city=${CITY}&scope=yours`)).days.map((d) => d.savedDayId)).not.toContain(
      savedDayId,
    );
    expect(await cityChip()).toBeUndefined();
    expect((await discover(`city=${CITY}`)).siblings.map((s) => s.city)).not.toContain(SIBLING);
    // The library-wide published count behind the leaderboard link moves too.
    expect((await discover(`city=${CITY}`)).sharedDayCount).toBe(sharedBefore - 1);
  });

  it("leaves the author's profile and their leaderboard counts", async () => {
    const savedDayId = await saveDay("Counted, then not");
    await publish(savedDayId);

    // Somebody else takes it, into a dated trip, so the add COUNTS — which is
    // what puts the author on the board at all.
    currentUserId = OTHER;
    await addToDatedTrip(savedDayId);
    currentUserId = AUTHOR;

    const before = await profileOf(AUTHOR);
    expect(before.author.daysShared).toBe(1);
    expect(before.author.adds).toBe(1);
    expect(before.days.map((d) => d.savedDayId)).toContain(savedDayId);
    expect(before.knows.map((k) => k.city)).toContain(CITY);
    expect((await boardRowFor(AUTHOR))?.daysShared).toBe(1);

    const { DELETE: UNPUBLISH } = await import("./publish/route");
    await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ savedDayId }),
    });
    expect((await remove(savedDayId)).status).toBe(200);

    const after = await profileOf(AUTHOR);
    expect(after.author.daysShared).toBe(0);
    expect(after.author.adds).toBe(0);
    expect(after.days).toEqual([]);
    expect(after.knows.map((k) => k.city)).not.toContain(CITY);
    // The board counts the ledger, so the author drops off it entirely once the
    // only day they were credited for is gone — `having` keeps a row only for
    // someone with adds or published days, and this account now has neither.
    expect(await boardRowFor(AUTHOR)).toBeUndefined();
  });

  // "It doesn't remove it from anyone, it just removes it here." The ledger is
  // a record of what happened, not a grant, and a copy already taken into
  // somebody's trip is a VALUE in that trip's own event stream (ADR-029) with
  // nothing pointing back at this row. Neither is touched.
  it("does not touch the adds ledger, and leaves a taken copy in its trip", async () => {
    const savedDayId = await saveDay("Already taken");
    await publish(savedDayId);

    currentUserId = OTHER;
    await addToDatedTrip(savedDayId);
    currentUserId = AUTHOR;

    expect(await ledgerRows(savedDayId)).toBe(1);
    const counterBefore = (
      await db.select({ adds: savedDays.adds }).from(savedDays).where(eq(savedDays.id, savedDayId))
    )[0]?.adds;
    expect(counterBefore).toBe(1);

    const { DELETE: UNPUBLISH } = await import("./publish/route");
    await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ savedDayId }),
    });
    expect((await remove(savedDayId)).status).toBe(200);

    expect(await ledgerRows(savedDayId)).toBe(1);
    const counterAfter = (
      await db.select({ adds: savedDays.adds }).from(savedDays).where(eq(savedDays.id, savedDayId))
    )[0]?.adds;
    expect(counterAfter).toBe(1);
  });
});
