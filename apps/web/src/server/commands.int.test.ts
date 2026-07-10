import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { events, tripDetails, tripSummaries } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail, rebuildProjections } from "./projections";

const exec = (command: object, actorId = "user-1") => executeTripCommand(command, actorId);

async function seedBoard() {
  const tripId = randomUUID();
  const dayA = randomUUID();
  const dayB = randomUUID();
  const colosseum = randomUUID();
  const vatican = randomUUID();
  await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
  await exec({ type: "AddDay", tripId, dayId: dayA });
  await exec({ type: "AddDay", tripId, dayId: dayB });
  await exec({
    type: "AddActivity",
    tripId,
    activityId: colosseum,
    title: "Colosseum",
    timeWindow: { start: "09:00", end: "11:00" },
    location: { name: "Rome", lat: 41.8902, lng: 12.4922 },
  });
  await exec({
    type: "AddActivity",
    tripId,
    activityId: vatican,
    title: "Vatican Museums",
    timeWindow: { start: "10:00", end: "12:00" },
  });
  return { tripId, dayA, dayB, colosseum, vatican };
}

describe("executeTripCommand", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("appends TripCreated with the actor and updates both projections", async () => {
    const tripId = randomUUID();
    const result = await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
    expect(result).toEqual({ ok: true, tripId });

    const eventRows = await db.select().from(events);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.actorId).toBe("user-1");

    expect(await db.select().from(tripSummaries)).toHaveLength(1);
    const detail = await getTripDetail(tripId);
    expect(detail).toMatchObject({ tripId, name: "Rome 2027", days: [], backlog: [], conflicts: [] });
  });

  it("rejects a duplicate tripId with a typed error", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
    const second = await exec({ type: "CreateTrip", tripId, name: "Rome again" });
    expect(second).toEqual({
      ok: false,
      error: { code: "trip-already-exists", message: "A trip with this id already exists." },
    });
  });

  it("rejects invalid input via the contract schema", async () => {
    const result = await exec({ type: "CreateTrip", tripId: "not-a-uuid", name: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-member via the AccessPolicy seam", async () => {
    const { tripId } = await seedBoard();
    const result = await exec({ type: "AddDay", tripId, dayId: randomUUID() }, "user-2");
    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "Not a member of this trip." },
    });
  });

  it("runs the board flow; conflicts are data and never block the write", async () => {
    const { tripId, dayA, dayB, colosseum, vatican } = await seedBoard();

    await exec({ type: "MoveActivity", tripId, activityId: colosseum, toDayId: dayA, position: 0 });
    const overlapping = await exec({ type: "MoveActivity", tripId, activityId: vatican, toDayId: dayA, position: 1 });
    expect(overlapping.ok).toBe(true); // the write succeeded despite creating a conflict

    let detail = await getTripDetail(tripId);
    expect(detail?.days).toEqual([
      { dayId: dayA, activityIds: [colosseum, vatican], date: null },
      { dayId: dayB, activityIds: [], date: null },
    ]);
    expect(detail?.conflicts).toHaveLength(1);
    expect(detail?.conflicts[0]).toMatchObject({
      kind: "time-overlap",
      severity: "warn",
      subjects: [colosseum, vatican].sort(),
    });

    // resolving by moving away clears the conflict
    await exec({ type: "MoveActivity", tripId, activityId: vatican, toDayId: dayB, position: 0 });
    detail = await getTripDetail(tripId);
    expect(detail?.conflicts).toEqual([]);
  });

  it("flags impossible geography for far-apart same-day activities", async () => {
    const { tripId, dayA, colosseum } = await seedBoard();
    const met = randomUUID();
    await exec({
      type: "AddActivity",
      tripId,
      activityId: met,
      title: "The Met",
      dayId: dayA,
      location: { name: "New York", lat: 40.7794, lng: -73.9632 },
    });
    await exec({ type: "MoveActivity", tripId, activityId: colosseum, toDayId: dayA, position: 0 });
    const detail = await getTripDetail(tripId);
    expect(detail?.conflicts.some((c) => c.kind === "impossible-geography")).toBe(true);
  });

  it("supports the display-only start date", async () => {
    const { tripId } = await seedBoard();
    await exec({ type: "SetTripStartDate", tripId, startDate: "2027-05-01" });
    expect((await getTripDetail(tripId))?.startDate).toBe("2027-05-01");
    await exec({ type: "SetTripStartDate", tripId, startDate: null });
    expect((await getTripDetail(tripId))?.startDate).toBeNull();
  });

  it("undo → redo → revert flow through the one pipeline", async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    const activityId = randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    expect((await run({ type: "CreateTrip", tripId, name: "History trip" })).ok).toBe(true);
    expect((await run({ type: "AddDay", tripId, dayId })).ok).toBe(true);
    expect((await run({ type: "AddActivity", tripId, activityId, dayId, title: "Colosseum" })).ok).toBe(true);

    expect((await run({ type: "UndoLastChange", tripId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.activities[activityId]).toBeUndefined();

    expect((await run({ type: "RedoChange", tripId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.activities[activityId]).toBeDefined();

    expect((await run({ type: "RevertToState", tripId, toSeq: 1 })).ok).toBe(true);
    const reverted = await getTripDetail(tripId);
    expect(reverted?.days).toEqual([]);
    expect(Object.keys(reverted?.activities ?? {})).toEqual([]);

    const noop = await run({ type: "RevertToState", tripId, toSeq: 1 });
    expect(noop.ok).toBe(false);
    if (!noop.ok) expect(noop.error.code).toBe("already-at-that-state");
  });

  it("dismissal persists through the projection and is revertible", async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Dismiss trip" });
    await run({ type: "AddDay", tripId, dayId });
    await run({ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "A", timeWindow: { start: "09:00", end: "11:00" } });
    await run({ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "B", timeWindow: { start: "10:00", end: "12:00" } });
    const conflicted = await getTripDetail(tripId);
    const conflictId = conflicted?.conflicts[0]?.id;
    expect(conflictId).toBeDefined();
    expect((await run({ type: "DismissConflict", tripId, conflictId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.dismissedConflictIds).toEqual([conflictId]);
    expect((await run({ type: "UndoLastChange", tripId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.dismissedConflictIds).toEqual([]);
  });

  it("a history command racing a concurrent write serializes or returns the typed conflict", async () => {
    const tripId = randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Race trip" });
    await run({ type: "AddDay", tripId, dayId: randomUUID() });
    const [undo, add] = await Promise.all([
      run({ type: "UndoLastChange", tripId }),
      run({ type: "AddDay", tripId, dayId: randomUUID() }),
    ]);
    const failures = [undo, add].filter((r) => !r.ok);
    for (const f of failures) {
      if (!f.ok) expect(f.error.code).toBe("concurrency-conflict");
    }
    // Whatever interleaving happened, the store must be consistent:
    const detail = await getTripDetail(tripId);
    expect(detail).not.toBeNull();
  });

  it("GOLDEN: rebuild from the log equals the live projections", async () => {
    await seedBoard();
    const second = await seedBoard();
    await exec({
      type: "MoveActivity",
      tripId: second.tripId,
      activityId: second.vatican,
      toDayId: second.dayA,
      position: 0,
    });

    const conflictedSecond = await getTripDetail(second.tripId);
    const conflictIdSecond = conflictedSecond?.conflicts[0]?.id;
    if (conflictIdSecond !== undefined) {
      await exec({ type: "DismissConflict", tripId: second.tripId, conflictId: conflictIdSecond });
    }
    await exec({ type: "UndoLastChange", tripId: second.tripId });
    await exec({ type: "RedoChange", tripId: second.tripId });
    await exec({ type: "RevertToState", tripId: second.tripId, toSeq: 1 });

    const liveSummaries = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));
    const liveDetails = await db.select().from(tripDetails).orderBy(asc(tripDetails.tripId));

    await rebuildProjections();

    const rebuiltSummaries = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));
    const rebuiltDetails = await db.select().from(tripDetails).orderBy(asc(tripDetails.tripId));

    const normalize = (rows: typeof liveSummaries) =>
      rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
    expect(normalize(rebuiltSummaries)).toEqual(normalize(liveSummaries));
    expect(rebuiltDetails).toEqual(liveDetails);
  });
});
