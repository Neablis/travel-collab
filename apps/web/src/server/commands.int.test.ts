import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { events, tripDetails, tripSummaries } from "./db/schema";
import { executeTripCommand, executeTripCommandBatch } from "./commands";
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

// The `beforeEach` that deleted every row of trip_details, trip_summaries and
// events is gone (KI-89, the same defect KI-69 fixed in six sibling files).
// Every trip id below is minted per test, so each assertion filters to the rows
// the test itself wrote instead of counting the whole database — which is what
// the truncation was really propping up.
describe("executeTripCommand", () => {
  it("appends TripCreated with the actor and updates both projections", async () => {
    // A decoy trip nobody asserts about, standing in for a concurrent run or a
    // developer's own data. It is the regression guard for KI-89: the scoped
    // counts below stay 1 only while they are scoped, and the decoy's rows
    // survive to the end of the test only while nothing truncates.
    const decoyTripId = randomUUID();
    await exec({ type: "CreateTrip", tripId: decoyTripId, name: "Someone else's trip" });

    const tripId = randomUUID();
    const result = await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tripId).toBe(tripId);

    const eventRows = await db.select().from(events).where(eq(events.streamId, tripId));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.actorId).toBe("user-1");

    expect(await db.select().from(tripSummaries).where(eq(tripSummaries.tripId, tripId))).toHaveLength(1);
    const detail = await getTripDetail(tripId);
    expect(detail).toMatchObject({ tripId, name: "Rome 2027", days: [], backlog: [], conflicts: [] });

    expect(await db.select().from(events).where(eq(events.streamId, decoyTripId))).toHaveLength(1);
    expect(await db.select().from(tripSummaries).where(eq(tripSummaries.tripId, decoyTripId))).toHaveLength(1);
  });

  it("returns the authoritative detail + history on success", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
    const dayId = randomUUID();
    const result = await exec({ type: "AddDay", tripId, dayId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.days).toHaveLength(1);
    expect(result.history.entries[0]?.description).toBe("Added Day 1");
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

  // `owner` is the only role anything mints (TripCreated), so the owner-only
  // commands have to stay reachable for the creator — and the role has to
  // survive the trip_summaries/trip_details jsonb round trip, since the next
  // command's authorization reads it back out of the folded stream.
  it("mints the creator as owner and keeps owner-only commands reachable", async () => {
    const { tripId } = await seedBoard();
    expect((await getTripDetail(tripId))?.members).toEqual([{ userId: "user-1", role: "owner" }]);
    const summary = await db.select().from(tripSummaries).where(eq(tripSummaries.tripId, tripId));
    expect(summary[0]?.members).toEqual([{ userId: "user-1", role: "owner" }]);
    expect((await exec({ type: "DeleteTrip", tripId })).ok).toBe(true);
    expect((await exec({ type: "RestoreTrip", tripId })).ok).toBe(true);
    await rebuildProjections();
    expect((await getTripDetail(tripId))?.members).toEqual([{ userId: "user-1", role: "owner" }]);
  });

  it("runs the board flow; conflicts are data and never block the write", async () => {
    const { tripId, dayA, dayB, colosseum, vatican } = await seedBoard();

    await exec({ type: "MoveActivity", tripId, activityId: colosseum, toDayId: dayA, position: 0 });
    const overlapping = await exec({ type: "MoveActivity", tripId, activityId: vatican, toDayId: dayA, position: 1 });
    expect(overlapping.ok).toBe(true); // the write succeeded despite creating a conflict

    let detail = await getTripDetail(tripId);
    expect(detail?.days).toEqual([
      { dayId: dayA, activityIds: [colosseum, vatican], date: null, costSubtotal: 0 },
      { dayId: dayB, activityIds: [], date: null, costSubtotal: 0 },
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
    const first = await seedBoard();
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

    // Scoped to this test's two trips (KI-89). Unscoped, this compared every
    // row of both projection tables before and after the rebuild, which held
    // only because the truncation guaranteed those were the only rows.
    // `rebuildProjections()` itself is still database-wide — that is a property
    // of the function under test, not something the test can scope away — so
    // the rebuild below still re-projects every trip in the log; only the
    // comparison is narrowed. The length assertions keep that honest: a
    // filtered comparison of two empty arrays would pass while proving nothing.
    const tripIds = [first.tripId, second.tripId];
    const summariesOfThisTest = () =>
      db.select().from(tripSummaries).where(inArray(tripSummaries.tripId, tripIds)).orderBy(asc(tripSummaries.tripId));
    const detailsOfThisTest = () =>
      db.select().from(tripDetails).where(inArray(tripDetails.tripId, tripIds)).orderBy(asc(tripDetails.tripId));

    const liveSummaries = await summariesOfThisTest();
    const liveDetails = await detailsOfThisTest();
    expect(liveSummaries).toHaveLength(2);
    expect(liveDetails).toHaveLength(2);

    await rebuildProjections();

    const rebuiltSummaries = await summariesOfThisTest();
    const rebuiltDetails = await detailsOfThisTest();

    const normalize = (rows: typeof liveSummaries) =>
      rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
    expect(normalize(rebuiltSummaries)).toEqual(normalize(liveSummaries));
    expect(rebuiltDetails).toEqual(liveDetails);
  });
});

// Same truncating `beforeEach`, removed on the same grounds (KI-89). Nothing in
// this block ever asserted over a whole table — every test here reads back
// through its own `tripId` — so it needed no other change.
describe("executeTripCommandBatch", () => {
  it("appends a batch of commands as ONE history entry", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "Batch trip" });
    const result = await executeTripCommandBatch(
      [
        { type: "AddDay", tripId, dayId: randomUUID() },
        { type: "AddDay", tripId, dayId: randomUUID() },
      ],
      "user-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.days).toHaveLength(2);
    // one entry for the batch, plus the creation entry
    const userEntries = result.history.entries.filter((e) => e.origin.kind === "user");
    expect(userEntries).toHaveLength(2);
    expect(userEntries[0]?.description).toBe("Added Day 1; Added Day 2");
  });

  it("is all-or-nothing — a later invalid command appends nothing", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "Batch trip" });
    const before = await getTripDetail(tripId);
    const result = await executeTripCommandBatch(
      [
        { type: "AddDay", tripId, dayId: randomUUID() },
        { type: "RemoveDay", tripId, dayId: randomUUID() }, // ghost day
      ],
      "user-1",
    );
    expect(result.ok).toBe(false);
    const after = await getTripDetail(tripId);
    expect(after?.days).toEqual(before?.days); // unchanged
  });

  it("rejects a non-member via the AccessPolicy seam", async () => {
    const { tripId } = await seedBoard();
    const result = await executeTripCommandBatch(
      [{ type: "AddDay", tripId, dayId: randomUUID() }],
      "user-2",
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "Not a member of this trip." },
    });
  });

  it("rejects commands that target different trips", async () => {
    const tripId = randomUUID();
    const otherTripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "Batch trip" });
    const result = await executeTripCommandBatch(
      [
        { type: "AddDay", tripId, dayId: randomUUID() },
        { type: "AddDay", tripId: otherTripId, dayId: randomUUID() },
      ],
      "user-1",
    );
    expect(result.ok).toBe(false);
  });

  it("skips a no-op sub-command instead of aborting the batch", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "No-op batch trip" }); // defaults currency USD
    const dayId = randomUUID();
    const result = await executeTripCommandBatch(
      [
        { type: "SetTripCurrency", tripId, currency: "USD" }, // no-op: already USD
        { type: "AddDay", tripId, dayId },
      ],
      "user-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.detail.days).toHaveLength(1); // the AddDay applied despite the no-op
  });

  it("rejects a batch that is entirely no-ops", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "All no-op trip" });
    const result = await executeTripCommandBatch(
      [{ type: "SetTripCurrency", tripId, currency: "USD" }],
      "user-1",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe("no-op");
  });
});
