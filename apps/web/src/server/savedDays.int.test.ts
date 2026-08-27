import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/client";
import { events, savedDays, tripDetails, tripInvites, tripMemberships, tripSummaries } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail } from "./projections";
import { acceptInvite, createInvite } from "./access/invites";
import {
  deleteSavedDay,
  getSavedDay,
  insertCommands,
  insertSavedDay,
  listSavedDays,
  saveDay,
} from "./savedDays";

const OWNER = "saved-alice";
const OTHER = "saved-bob";

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

beforeEach(async () => {
  await db.delete(savedDays);
  await db.delete(tripInvites);
  await db.delete(tripMemberships);
  await db.delete(tripDetails);
  await db.delete(tripSummaries);
  await db.delete(events);
});

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
    if (!saved.ok) return;

    expect(await getSavedDay(saved.value.savedDayId, OTHER)).toBeNull();
    expect(await deleteSavedDay(saved.value.savedDayId, OTHER)).toBe(false);
    expect(await getSavedDay(saved.value.savedDayId, OWNER)).not.toBeNull();

    expect(await deleteSavedDay(saved.value.savedDayId, OWNER)).toBe(true);
    expect(await getSavedDay(saved.value.savedDayId, OWNER)).toBeNull();
  });
});

describe("inserting a saved day", () => {
  it("appends a day with its stops, in order, as ONE history entry", async () => {
    const { tripId, dayId } = await seedDay();
    const saved = await saveDay({ name: "Reusable", dayId }, await detailFor(tripId), OWNER);
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
    if (!saved.ok) return;

    const targetId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: targetId, name: "Someone else's" }, OTHER);
    const invite = await createInvite(targetId, OTHER, { email: null, role: "viewer" });
    await acceptInvite(invite.token, OWNER);

    const result = await insertSavedDay(saved.value.savedDayId, targetId, OWNER);
    expect(result.ok === false && result.error.code).toBe("forbidden");
  });
});
