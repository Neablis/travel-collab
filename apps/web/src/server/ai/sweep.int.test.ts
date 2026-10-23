import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { SavedStop } from "@tc/contracts";
import { db } from "@/server/db/client";
import { dayEmbeddings, pendingEmbeddings, savedDays, events, tripDetails, tripSummaries } from "@/server/db/schema";
import { deleteSavedDay, setSavedDayVisibility, storeSavedDay, updatePlaybookContent } from "@/server/savedDays";
import { executeTripCommand } from "@/server/commands";
import { enqueueDayChunksForEmbedding } from "@/server/ai/queue";
import { runEmbedSweep } from "@/server/ai/sweep";
import { backfillDayEmbeddings } from "../../../scripts/backfill-day-embeddings.mjs";

// Embed-on-write and the cron sweep against REAL Postgres + pgvector: the
// claim lock, the `english` FTS dictionary and the HNSW upsert are all
// database behaviour, so a mock would be the thing tested. The embedding
// PROVIDER is faked — the integration lane forbids third-party calls, and the
// provider is `embeddings.test.ts`'s subject, not this file's.

const DIMS = 1536;
const run = randomUUID().slice(0, 8);

/** Deterministic 1536-dim vector; the values never matter here, only that one lands. */
const fakeEmbed = async (text: string): Promise<number[] | null> => {
  const v = new Array(DIMS).fill(0);
  v[0] = (text.length % 97) / 97;
  v[1] = 0.5;
  return v;
};
/** The provider failing, the fail-open way `embedText` fails: null, never a throw. */
const nullEmbed = async (): Promise<number[] | null> => null;
/** A provider that explodes on one row's text: the batch must walk on. */
const flakyEmbed = async (text: string): Promise<number[] | null> => {
  if (text.includes("POISON")) throw new Error("provider exploded");
  return fakeEmbed(text);
};

function stop(title: string, dayIndex: number, city: string | null = "Kyoto"): SavedStop {
  return {
    title,
    timeWindow: null,
    location: city === null ? null : { name: `${title}, ${city}`, city, countryCode: "JP" },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: ["sight"],
    cost: null,
    dayIndex,
    mode: null,
    endLocation: null,
    pendingReason: null,
    flightNumber: null,
  };
}

const trackedPlaybooks: string[] = [];
const trackedTrips: string[] = [];

afterAll(async () => {
  // Own our rows, clean up after ourselves — no truncation (KI-69).
  if (trackedPlaybooks.length > 0) {
    await db
      .delete(dayEmbeddings)
      .where(and(eq(dayEmbeddings.sourceType, "playbook"), inArray(dayEmbeddings.sourceId, trackedPlaybooks)));
  }
  if (trackedTrips.length > 0) {
    await db
      .delete(dayEmbeddings)
      .where(and(eq(dayEmbeddings.sourceType, "trip"), inArray(dayEmbeddings.sourceId, trackedTrips)));
  }
  for (const id of trackedPlaybooks) {
    await db
      .delete(pendingEmbeddings)
      .where(and(eq(pendingEmbeddings.sourceType, "playbook"), eq(pendingEmbeddings.sourceId, id)));
    await db.delete(savedDays).where(eq(savedDays.id, id));
  }
  for (const tripId of trackedTrips) {
    await db
      .delete(pendingEmbeddings)
      .where(and(eq(pendingEmbeddings.sourceType, "trip"), eq(pendingEmbeddings.sourceId, tripId)));
    await db.delete(events).where(eq(events.streamId, tripId));
    await db.delete(tripDetails).where(eq(tripDetails.tripId, tripId));
    await db.delete(tripSummaries).where(eq(tripSummaries.tripId, tripId));
  }
});

async function createPlaybook(ownerId: string, name: string, stops: SavedStop[], dayCount: number) {
  const saved = await storeSavedDay({
    ownerId,
    name,
    stops,
    dayCount,
    sourceTripId: randomUUID(),
    sourceTripName: "test source",
    now: new Date().toISOString(),
    context: { route: "sweep.int.test" },
  });
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error("storeSavedDay failed in test setup");
  trackedPlaybooks.push(saved.value.savedDayId);
  return saved.value;
}

async function pendingRows(sourceType: "playbook" | "trip", sourceId: string) {
  return db
    .select()
    .from(pendingEmbeddings)
    .where(and(eq(pendingEmbeddings.sourceType, sourceType), eq(pendingEmbeddings.sourceId, sourceId)));
}

async function setPendingStatus(
  sourceType: "playbook" | "trip",
  sourceId: string,
  status: "pending" | "processing" | "done" | "dead",
  attempts = 0,
) {
  await db.execute(sql`
    UPDATE pending_embeddings SET status = ${status}, attempts = ${attempts}
    WHERE source_type = ${sourceType} AND source_id = ${sourceId}
  `);
}

/**
 * Empty the queue before a sweep test: earlier tests leave pending rows
 * behind, and a sweep claims globally — without this every summary count
 * below would include other tests' rows. What was asserted about those rows
 * was asserted before they were drained.
 */
async function drainQueue(): Promise<void> {
  // Delete directly: earlier test files share this database and can leave an
  // unbounded backlog of pending rows (a sweep claims at most 50 per run, so
  // draining via the sweep is not guaranteed to terminate). This is test
  // setup, not the sweep under test — the sweep's behavior is asserted below.
  await db.delete(pendingEmbeddings);
}

describe("embed-on-write hooks", () => {
  it("storeSavedDay enqueues one pending row per day, idempotently", async () => {
    const owner = `sweep-alice-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0), stop("Arashiyama", 1)], 2);

    const rows = await pendingRows("playbook", playbook.savedDayId);
    expect(rows.map((r) => r.dayIndex).sort()).toEqual([0, 1]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);

    // A second enqueue of the same days is a no-op: the unique key holds.
    await enqueueDayChunksForEmbedding("playbook", playbook.savedDayId, [0, 1, 0]);
    expect((await pendingRows("playbook", playbook.savedDayId)).map((r) => r.dayIndex).sort()).toEqual([0, 1]);
  });

  it("updatePlaybookContent re-enqueues finished rows when the content moves", async () => {
    const owner = `sweep-bob-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await setPendingStatus("playbook", playbook.savedDayId, "done");

    const updated = await updatePlaybookContent(playbook.savedDayId, owner, {
      days: { stops: [stop("Kinkaku-ji", 0)], dayCount: 1 },
      expectedVersion: 1,
    });
    expect(updated.ok).toBe(true);

    const rows = await pendingRows("playbook", playbook.savedDayId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("updatePlaybookContent re-enqueues on a visibility flip, and not on a failed edit", async () => {
    const owner = `sweep-carol-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await setPendingStatus("playbook", playbook.savedDayId, "done");

    const flipped = await updatePlaybookContent(playbook.savedDayId, owner, { visibility: "public" });
    expect(flipped.ok).toBe(true);
    expect((await pendingRows("playbook", playbook.savedDayId))[0]).toMatchObject({ status: "pending" });

    await setPendingStatus("playbook", playbook.savedDayId, "done");
    // A stale version is refused: the queue must not move for a write that did not land.
    const stale = await updatePlaybookContent(playbook.savedDayId, owner, {
      days: { stops: [stop("Kinkaku-ji", 0)], dayCount: 1 },
      expectedVersion: 1,
    });
    expect(stale.ok).toBe(false);
    expect((await pendingRows("playbook", playbook.savedDayId))[0]).toMatchObject({ status: "done" });
  });

  it("setSavedDayVisibility re-enqueues finished rows on publish and unpublish", async () => {
    const owner = `sweep-cathy-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0), stop("Arashiyama", 1)], 2);
    await setPendingStatus("playbook", playbook.savedDayId, "done");

    expect(await setSavedDayVisibility(playbook.savedDayId, owner, "public")).not.toBeNull();
    let rows = await pendingRows("playbook", playbook.savedDayId);
    expect(rows.map((r) => r.dayIndex).sort()).toEqual([0, 1]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);

    await setPendingStatus("playbook", playbook.savedDayId, "done");
    expect(await setSavedDayVisibility(playbook.savedDayId, owner, "private")).not.toBeNull();
    rows = await pendingRows("playbook", playbook.savedDayId);
    expect(rows.every((r) => r.status === "pending")).toBe(true);

    // Somebody else's day matches no row: nothing may move for it.
    await setPendingStatus("playbook", playbook.savedDayId, "done");
    expect(await setSavedDayVisibility(playbook.savedDayId, `sweep-mallory-${run}`, "public")).toBeNull();
    expect((await pendingRows("playbook", playbook.savedDayId)).every((r) => r.status === "done")).toBe(true);
  });

  it("deleteSavedDay re-enqueues the days so the sweep tombstones them", async () => {
    await drainQueue();
    const owner = `sweep-dan-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await runEmbedSweep({ embed: fakeEmbed });

    expect(await deleteSavedDay(playbook.savedDayId, owner)).toBe("deleted");
    expect((await pendingRows("playbook", playbook.savedDayId))[0]).toMatchObject({ status: "pending" });

    const summary = await runEmbedSweep({ embed: fakeEmbed });
    expect(summary.tombstoned).toBe(1);
    expect(
      await db
        .select()
        .from(dayEmbeddings)
        .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId))),
    ).toHaveLength(0);
  });

  it("trip commands enqueue the trip's days through the command pipeline", async () => {
    const actor = `sweep-dave-${run}`;
    const tripId = randomUUID();
    trackedTrips.push(tripId);
    const dayId = randomUUID();

    // CreateTrip: no days yet, nothing to queue.
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, actor)).ok).toBe(true);
    expect(await pendingRows("trip", tripId)).toHaveLength(0);

    expect((await executeTripCommand({ type: "AddDay", tripId, dayId }, actor)).ok).toBe(true);
    expect((await pendingRows("trip", tripId)).map((r) => r.dayIndex)).toEqual([0]);

    // A note edit keeps the day count: the re-enqueue is unconditional and idempotent.
    const activityId = randomUUID();
    const added = await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId,
        dayId,
        title: "Colosseum",
        location: { name: "Colosseum, Rome", city: "Rome", countryCode: "IT" },
      },
      actor,
    );
    expect(added.ok).toBe(true);
    expect((await pendingRows("trip", tripId)).map((r) => r.dayIndex)).toEqual([0]);
  });
});

describe("runEmbedSweep", () => {
  it("embeds a playbook's days with visibility and owner metadata", async () => {
    await drainQueue();
    const owner = `sweep-erin-${run}`;
    const playbook = await createPlaybook(
      owner,
      "Kyoto Stroll",
      [stop("Fushimi Inari", 0), stop("Arashiyama", 1, "Kyoto")],
      2,
    );

    const summary = await runEmbedSweep({ embed: fakeEmbed });
    expect(summary).toMatchObject({ claimed: 2, embedded: 2, retried: 0, dead: 0, tombstoned: 0 });

    const chunks = await db
      .select()
      .from(dayEmbeddings)
      .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId)));
    expect(chunks).toHaveLength(2);
    const day0 = chunks.find((c) => c.dayIndex === 0)!;
    expect(day0.chunkText).toContain("Fushimi Inari");
    expect(day0).toMatchObject({ visibility: "private", ownerId: owner, city: "Kyoto", countryCode: "JP" });
    expect(day0.tags).toEqual(["sight"]);
    // The vector really landed: 1536 dims, and the FTS leg can see the text.
    expect(day0.embedding).toHaveLength(1536);
    const fts = await db.execute<{ rank: number }>(sql`
      SELECT ts_rank(fts, plainto_tsquery('english', 'Fushimi')) AS rank
      FROM day_embeddings WHERE id = ${day0.id}
    `);
    expect(fts.rows[0]!.rank).toBeGreaterThan(0);

    for (const row of await pendingRows("playbook", playbook.savedDayId)) {
      expect(row.status).toBe("done");
    }
  });

  it("embeds trip days as private with the creator as owner", async () => {
    await drainQueue();
    const actor = `sweep-frank-${run}`;
    const tripId = randomUUID();
    trackedTrips.push(tripId);
    const dayId = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, actor)).ok).toBe(true);
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId }, actor)).ok).toBe(true);
    const activityId = randomUUID();
    expect(
      (
        await executeTripCommand(
          {
            type: "AddActivity",
            tripId,
            activityId,
            dayId,
            title: "Colosseum",
            location: { name: "Colosseum, Rome", city: "Rome", countryCode: "IT" },
          },
          actor,
        )
      ).ok,
    ).toBe(true);

    const summary = await runEmbedSweep({ embed: fakeEmbed });
    expect(summary.embedded).toBeGreaterThanOrEqual(1);

    const chunks = await db
      .select()
      .from(dayEmbeddings)
      .where(and(eq(dayEmbeddings.sourceType, "trip"), eq(dayEmbeddings.sourceId, tripId)));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunkText).toContain("Colosseum");
    // Trips are always private; the owner is recorded at write time because
    // they hold no `trip_memberships` row (spec, vendor decision).
    expect(chunks[0]).toMatchObject({ visibility: "private", ownerId: actor, city: "Rome", countryCode: "IT" });
  });

  it("re-embeds with fresh metadata after a visibility flip", async () => {
    await drainQueue();
    const owner = `sweep-grace-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await runEmbedSweep({ embed: fakeEmbed });
    const flipped = await updatePlaybookContent(playbook.savedDayId, owner, { visibility: "public" });
    expect(flipped.ok).toBe(true);

    await runEmbedSweep({ embed: fakeEmbed });
    const chunks = await db
      .select()
      .from(dayEmbeddings)
      .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId)));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.visibility).toBe("public");
  });

  it("skips the provider for a day whose text has not changed, and still stores fresh metadata", async () => {
    await drainQueue();
    const owner = `sweep-gus-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    let calls = 0;
    const countingEmbed = async (text: string) => {
      calls++;
      return fakeEmbed(text);
    };
    await runEmbedSweep({ embed: countingEmbed });
    expect(calls).toBe(1);

    // A visibility flip re-queues the day; the chunk text is the same.
    expect(await setSavedDayVisibility(playbook.savedDayId, owner, "public")).not.toBeNull();
    const summary = await runEmbedSweep({ embed: countingEmbed });
    expect(calls).toBe(1);
    expect(summary).toMatchObject({ claimed: 1, embedded: 0, unchanged: 1 });
    const chunks = await db
      .select()
      .from(dayEmbeddings)
      .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId)));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.visibility).toBe("public");
    expect(chunks[0]!.embedding).not.toBeNull();
    expect((await pendingRows("playbook", playbook.savedDayId))[0]!.status).toBe("done");

    // A content change does reach the provider.
    expect(await setSavedDayVisibility(playbook.savedDayId, owner, "private")).not.toBeNull();
    await runEmbedSweep({ embed: countingEmbed });
    const edited = await updatePlaybookContent(playbook.savedDayId, owner, {
      days: { stops: [stop("Kinkaku-ji", 0)], dayCount: 1 },
      expectedVersion: 1,
    });
    expect(edited.ok).toBe(true);
    const after = await runEmbedSweep({ embed: countingEmbed });
    expect(calls).toBe(2);
    expect(after).toMatchObject({ embedded: 1, unchanged: 0 });
  });

  it("reports how many rows are still pending after the run", async () => {
    await drainQueue();
    const owner = `sweep-hal-${run}`;
    await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0), stop("Arashiyama", 1), stop("Gion", 2)], 3);
    const summary = await runEmbedSweep({ embed: fakeEmbed, batchSize: 2 });
    expect(summary).toMatchObject({ claimed: 2, pending: 1 });
  });

  it("stops at its time budget and hands the rest of the claim back unspent", async () => {
    await drainQueue();
    const owner = `sweep-ida-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0), stop("Arashiyama", 1)], 2);
    const summary = await runEmbedSweep({ embed: fakeEmbed, budgetMs: 0 });
    expect(summary).toMatchObject({ claimed: 2, embedded: 0, deferred: 2, pending: 2 });
    const rows = await pendingRows("playbook", playbook.savedDayId);
    expect(rows.every((r) => r.status === "pending" && r.attempts === 0)).toBe(true);
  });

  it("retries a failed row and dead-letters it after 5 attempts", async () => {
    await drainQueue();
    const owner = `sweep-heidi-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);

    for (let attempt = 1; attempt <= 4; attempt++) {
      const summary = await runEmbedSweep({ embed: nullEmbed });
      expect(summary).toMatchObject({ claimed: 1, retried: 1, dead: 0 });
      expect((await pendingRows("playbook", playbook.savedDayId))[0]).toMatchObject({ status: "pending", attempts: attempt });
    }
    const last = await runEmbedSweep({ embed: nullEmbed });
    expect(last).toMatchObject({ claimed: 1, retried: 0, dead: 1 });
    expect((await pendingRows("playbook", playbook.savedDayId))[0]).toMatchObject({ status: "dead", attempts: 5 });

    // A dead row is never claimed again.
    const quiet = await runEmbedSweep({ embed: fakeEmbed });
    expect(quiet.claimed).toBe(0);
    expect(
      await db
        .select()
        .from(dayEmbeddings)
        .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId))),
    ).toHaveLength(0);
  });

  it("one bad row never kills the batch", async () => {
    await drainQueue();
    const owner = `sweep-ivan-${run}`;
    const good = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    const bad = await createPlaybook(owner, "POISON Playbook", [stop("POISON Shrine", 0)], 1);

    const summary = await runEmbedSweep({ embed: flakyEmbed });
    expect(summary.embedded).toBe(1);
    expect(summary.retried).toBe(1);
    expect((await pendingRows("playbook", good.savedDayId))[0]!.status).toBe("done");
    expect((await pendingRows("playbook", bad.savedDayId))[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("tombstones rows whose source is gone, removing its embeddings", async () => {
    await drainQueue();
    const owner = `sweep-judy-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await runEmbedSweep({ embed: fakeEmbed });
    expect(
      await db
        .select()
        .from(dayEmbeddings)
        .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId))),
    ).toHaveLength(1);

    // The playbook is deleted, then something queues its day again (a stale
    // write racing the delete): the sweep must not resurrect it.
    expect(await deleteSavedDay(playbook.savedDayId, owner)).toBe("deleted");
    await enqueueDayChunksForEmbedding("playbook", playbook.savedDayId, [0]);

    const summary = await runEmbedSweep({ embed: fakeEmbed });
    expect(summary.tombstoned).toBe(1);
    expect(
      await db
        .select()
        .from(dayEmbeddings)
        .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId))),
    ).toHaveLength(0);
    expect((await pendingRows("playbook", playbook.savedDayId))[0]!.status).toBe("done");
  });

  it("recovers rows orphaned at processing by a crashed run", async () => {
    await drainQueue();
    const owner = `sweep-karl-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await setPendingStatus("playbook", playbook.savedDayId, "processing");

    const summary = await runEmbedSweep({ embed: fakeEmbed });
    expect(summary).toMatchObject({ recovered: 1, claimed: 1, embedded: 1 });
  });

  it("tombstones only the stale day when a day index outlives its source's day count", async () => {
    await drainQueue();
    const owner = `sweep-lena-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await runEmbedSweep({ embed: fakeEmbed });
    // A stale queue row for a day the playbook no longer has.
    await enqueueDayChunksForEmbedding("playbook", playbook.savedDayId, [7]);

    const summary = await runEmbedSweep({ embed: fakeEmbed });
    expect(summary.tombstoned).toBe(1);
    // Day 0's embedding survives: only the stale day is removed.
    const chunks = await db
      .select()
      .from(dayEmbeddings)
      .where(and(eq(dayEmbeddings.sourceType, "playbook"), eq(dayEmbeddings.sourceId, playbook.savedDayId)));
    expect(chunks.map((c) => c.dayIndex)).toEqual([0]);
  });
});

describe("backfillDayEmbeddings", () => {
  it("queues every day of every playbook and active trip", async () => {
    await drainQueue();
    const owner = `sweep-liam-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0), stop("Arashiyama", 1)], 2);
    const actor = `sweep-mia-${run}`;
    const tripId = randomUUID();
    trackedTrips.push(tripId);
    const dayId = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, actor)).ok).toBe(true);
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId }, actor)).ok).toBe(true);

    // The hooks already queued these; clear the queue so the backfill is what fills it.
    await db.execute(sql`DELETE FROM pending_embeddings WHERE source_id IN (${playbook.savedDayId}, ${tripId})`);

    const result = await backfillDayEmbeddings(db);
    expect(result.playbooks).toBeGreaterThanOrEqual(1);
    expect(result.trips).toBeGreaterThanOrEqual(1);
    expect((await pendingRows("playbook", playbook.savedDayId)).map((r) => r.dayIndex).sort()).toEqual([0, 1]);
    expect((await pendingRows("trip", tripId)).map((r) => r.dayIndex)).toEqual([0]);
  });

  it("leaves finished rows alone but resets dead ones", async () => {
    await drainQueue();
    const owner = `sweep-nina-${run}`;
    const playbook = await createPlaybook(owner, "Kyoto Stroll", [stop("Fushimi Inari", 0)], 1);
    await setPendingStatus("playbook", playbook.savedDayId, "dead", 5);

    const result = await backfillDayEmbeddings(db);
    expect(result.deadReset).toBeGreaterThanOrEqual(1);
    expect((await pendingRows("playbook", playbook.savedDayId))[0]).toMatchObject({ status: "pending", attempts: 0 });

    // A second run is a no-op on the now-pending row: idempotent.
    await setPendingStatus("playbook", playbook.savedDayId, "done");
    const again = await backfillDayEmbeddings(db);
    expect(again.deadReset).toBe(0);
    expect((await pendingRows("playbook", playbook.savedDayId))[0]).toMatchObject({ status: "done" });
  });
});
