import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";


import { executeTripCommand } from "./commands";
import { getTripDetail } from "./projections";
import { acceptInvite, createInvite } from "./access/invites";
import {
  deleteSavedDay,
  getSavedDay,
  insertCommands,
  insertSavedDay,
  listSavedDays,
  readableSavedDay,
  saveDay,
  setSavedDayVisibility,
} from "./savedDays";

// Fresh identities per TEST, not per file (KI-69).
//
// `listSavedDays(ownerId)` filters by owner and nothing else, so with a fixed
// "saved-alice" the three assertions that read it back — an empty library, an
// exact ordered pair of names, and `[0]` of the newest-first list — were really
// assertions about the whole `saved_days` table. They passed only because the
// beforeEach below had just deleted every row in it. Minting a new owner for
// each test makes those queries see exactly the rows that test created, which
// is what lets the truncation go: the isolation is now in the data, not in
// having the table to ourselves.
//
// `let`, because `beforeEach` reassigns them; every reader below is inside a
// function body and so picks up the current test's value.
let OWNER = "";
let OTHER = "";

beforeEach(() => {
  const run = randomUUID().slice(0, 8);
  OWNER = `saved-alice-${run}`;
  OTHER = `saved-bob-${run}`;
});

async function seedDay(name = "Kyoto"): Promise<{ tripId: string; dayId: string }> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name }, OWNER);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Fushimi Inari",
      timeWindow: { start: "09:00", end: "11:00" },
      cost: { amountMinor: 1200, currency: "USD" },
    },
    OWNER,
  );
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Nishiki Market",
      timeWindow: { start: "13:00", end: "14:30" },
    },
    OWNER,
  );
  return { tripId, dayId };
}

const detailFor = async (tripId: string) => (await getTripDetail(tripId))!;

// The truncation that used to live here is gone (KI-69). It deleted every row
// of saved_days, trip_invites, trip_memberships, trip_details, trip_summaries
// and events — including a developer's own, since DATABASE_URL is shared with
// local dev. Every trip here is a fresh randomUUID and every owner is now fresh
// per test (above), so nothing this file reads can see another test's rows.

describe("saving a day", () => {
  it("keeps the stops, their order and their times — and no date", async () => {
    const { tripId, dayId } = await seedDay();
    await executeTripCommand({ type: "SetTripStartDate", tripId, startDate: "2027-06-01" }, OWNER);

    const result = await saveDay({ name: "A day in Kyoto", dayId }, await detailFor(tripId), OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.stops.map((s) => s.title)).toEqual(["Fushimi Inari", "Nishiki Market"]);
    expect(result.value.stops[0]!.timeWindow).toEqual({ start: "09:00", end: "11:00" });
    expect(result.value.stops[0]!.cost).toEqual({ amountMinor: 1200, currency: "USD" });
    // The day HAS a date (2027-06-01) and the fragment carries none: a date is
    // derived from the trip's start, so it belongs to the trip, not the day.
    expect(JSON.stringify(result.value.stops)).not.toContain("2027-06");
  });

  // `SavedDay.name` requires a character. The route's Zod parse sees "   " as
  // length 3 and lets it through, and the trim then happened while BUILDING
  // the row — so the stored name violated the contract it was validated
  // against, and the next read of that row would throw (CodeRabbit, PR #71).
  it("refuses a name that is only whitespace, rather than storing an empty one", async () => {
    const { tripId, dayId } = await seedDay();
    const result = await saveDay({ name: "   ", dayId }, await detailFor(tripId), OWNER);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid");
    // …and nothing landed, so the library is not carrying an unparseable row.
    expect(await listSavedDays(OWNER)).toEqual([]);
  });

  it("still trims a name that has something in it", async () => {
    const { tripId, dayId } = await seedDay();
    const result = await saveDay({ name: "  Day one  ", dayId }, await detailFor(tripId), OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Day one");
  });

  it("remembers which trip it came from, and what that trip was called", async () => {
    const { tripId, dayId } = await seedDay("Kyoto");
    const result = await saveDay({ name: "Day one", dayId }, await detailFor(tripId), OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceTripId).toBe(tripId);
    expect(result.value.sourceTripName).toBe("Kyoto");

    // A snapshot, on the same terms as a trip's lineage (ADR-028) — renaming
    // the source afterwards does not rewrite the credit.
    await executeTripCommand({ type: "SetTripName", tripId, name: "Osaka" }, OWNER);
    expect((await getSavedDay(result.value.savedDayId, OWNER))!.sourceTripName).toBe("Kyoto");
  });

  it("refuses a day that is not in the trip", async () => {
    const { tripId } = await seedDay();
    const result = await saveDay({ name: "Nope", dayId: randomUUID() }, await detailFor(tripId), OWNER);
    expect(result.ok === false && result.error.code).toBe("not-found");
  });

  it("refuses an empty day — there is nothing there to reuse", async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Bare" }, OWNER);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
    const result = await saveDay({ name: "Empty" , dayId }, await detailFor(tripId), OWNER);
    expect(result.ok === false && result.error.code).toBe("invalid");
  });
});

describe("the library is per-person", () => {
  it("lists only your own saved days, newest first", async () => {
    const { tripId, dayId } = await seedDay();
    const detail = await detailFor(tripId);
    const first = await saveDay({ name: "First", dayId }, detail, OWNER, "2026-01-01T00:00:00.000Z");
    const second = await saveDay({ name: "Second", dayId }, detail, OWNER, "2026-02-01T00:00:00.000Z");
    await saveDay({ name: "Theirs", dayId }, detail, OTHER);
    if (!first.ok || !second.ok) return;

    expect((await listSavedDays(OWNER)).map((d) => d.name)).toEqual(["Second", "First"]);
    expect((await listSavedDays(OTHER)).map((d) => d.name)).toEqual(["Theirs"]);
  });

  // Someone else's saved day is indistinguishable from one that does not
  // exist, which is the right answer to both.
  it("hides, and refuses to delete, someone else's saved day", async () => {
    const { tripId, dayId } = await seedDay();
    const saved = await saveDay({ name: "Mine", dayId }, await detailFor(tripId), OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(await getSavedDay(saved.value.savedDayId, OTHER)).toBeNull();
    // "not-found", NOT "published": the outcome for somebody else's day is the
    // same one a nonexistent id gets, so the refusal cannot be read as a
    // confirmation that the id names something (2026-09-01, the soft delete).
    expect(await deleteSavedDay(saved.value.savedDayId, OTHER)).toBe("not-found");
    expect(await getSavedDay(saved.value.savedDayId, OWNER)).not.toBeNull();

    expect(await deleteSavedDay(saved.value.savedDayId, OWNER)).toBe("deleted");
    expect(await getSavedDay(saved.value.savedDayId, OWNER)).toBeNull();
    // Deleting it again is the same answer every read now gives.
    expect(await deleteSavedDay(saved.value.savedDayId, OWNER)).toBe("not-found");
  });
});

describe("inserting a saved day", () => {
  it("appends a day with its stops, in order, as ONE history entry", async () => {
    const { tripId, dayId } = await seedDay();
    const saved = await saveDay({ name: "Reusable", dayId }, await detailFor(tripId), OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const targetId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: targetId, name: "Next trip" }, OWNER);

    const result = await insertSavedDay(saved.value.savedDayId, targetId, OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.detail.days).toHaveLength(1);
    const inserted = result.detail.days[0]!;
    expect(inserted.activityIds.map((id) => result.detail.activities[id]!.title)).toEqual([
      "Fushimi Inari",
      "Nishiki Market",
    ]);
    expect(result.detail.activities[inserted.activityIds[0]!]!.timeWindow).toEqual({
      start: "09:00",
      end: "11:00",
    });
    // One batch = one history entry = one undo. Half an inserted day is not a
    // state anyone should be able to land in.
    expect(result.history.entries).toHaveLength(2); // TripCreated, then the insert
  });

  it("mints fresh ids every time, so the same day can go into two trips", async () => {
    const { tripId, dayId } = await seedDay();
    const saved = await saveDay({ name: "Twice", dayId }, await detailFor(tripId), OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const a = insertCommands(saved.value, randomUUID());
    const b = insertCommands(saved.value, randomUUID());
    const idsOf = (commands: typeof a) =>
      commands.flatMap((c) => ("activityId" in c ? [c.activityId] : "dayId" in c ? [c.dayId] : []));
    expect(idsOf(a).some((id) => idsOf(b).includes(id))).toBe(false);
    // …and none of them is an id from the source trip.
    const source = await detailFor(tripId);
    const sourceIds = [dayId, ...Object.keys(source.activities)];
    expect(idsOf(a).some((id) => sourceIds.includes(id!))).toBe(false);
  });

  it("refuses someone else's saved day", async () => {
    const { tripId, dayId } = await seedDay();
    const saved = await saveDay({ name: "Mine", dayId }, await detailFor(tripId), OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const targetId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: targetId, name: "Theirs" }, OTHER);
    const result = await insertSavedDay(saved.value.savedDayId, targetId, OTHER);
    expect(result.ok === false && result.error.code).toBe("not-found");
  });

  // The command pipeline is still the boundary: the insert goes through
  // executeTripCommandBatch, so AccessPolicy decides, not this module.
  it("is refused for a viewer, because the batch it raises is", async () => {
    const { tripId, dayId } = await seedDay();
    const saved = await saveDay({ name: "Mine", dayId }, await detailFor(tripId), OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const targetId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: targetId, name: "Someone else's" }, OTHER);
    const invite = await createInvite(targetId, OTHER, { email: null, role: "viewer" });
    await acceptInvite(invite.token, OWNER);

    const result = await insertSavedDay(saved.value.savedDayId, targetId, OWNER);
    expect(result.ok === false && result.error.code).toBe("forbidden");
  });
});

// KI-53. `mode: "string"` columns echoed the write path's own ISO input and
// rendered Postgres's format ("2026-01-01 00:00:00+00") on the read path, so
// the same field had two shapes depending on which call you got it from.
// `mode: "date"` plus one `.toISOString()` in `toDto` is what makes these
// equal; asserting the ISO literal is what stops it silently coming back.
// KI-2026-09-05-x. `saved_days.id` is a uuid column, so every one of these
// reached Postgres and came back `22P02 invalid input syntax for type uuid` —
// `GET`, `DELETE` and publish on `/api/saved-days/:id`, plus `POST
// /api/trips/:id/saved-days/:id`, all 500ed on a mistyped or truncated library
// link. Each guard returns the function's OWN empty answer, which is why no
// route needed a new branch: `null` and `not-found` are already 404 there.
//
// `deleteSavedDay` is the one worth naming: `not-found`, never `published` —
// an id that could not name a day cannot name a published one either, and
// answering `published` would tell a caller to go and unpublish nothing.
describe("an id that is not a uuid is a miss, not a database error", () => {
  const BAD = "not-a-uuid";

  it("getSavedDay returns null", async () => {
    expect(await getSavedDay(BAD, OWNER)).toBeNull();
  });

  it("readableSavedDay returns null", async () => {
    expect(await readableSavedDay(BAD, OWNER)).toBeNull();
  });

  it("setSavedDayVisibility returns null", async () => {
    expect(await setSavedDayVisibility(BAD, OWNER, "public")).toBeNull();
  });

  it("deleteSavedDay answers not-found", async () => {
    expect(await deleteSavedDay(BAD, OWNER)).toBe("not-found");
  });

  it("insertSavedDay answers not-found", async () => {
    const { tripId } = await seedDay();
    const result = await insertSavedDay(BAD, tripId, OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-found");
  });
});

describe("saved-day timestamps have one shape", () => {
  it("returns the same createdAt from the write path and both read paths", async () => {
    const { tripId, dayId } = await seedDay();
    const saved = await saveDay(
      { name: "Day one", dayId },
      await detailFor(tripId),
      OWNER,
      "2026-01-01T00:00:00.000Z",
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect((await listSavedDays(OWNER))[0]!.createdAt).toBe(saved.value.createdAt);
    expect((await getSavedDay(saved.value.savedDayId, OWNER))!.createdAt).toBe(
      saved.value.createdAt,
    );
  });
});
