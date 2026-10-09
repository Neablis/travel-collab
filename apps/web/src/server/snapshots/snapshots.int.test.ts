import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandsFor } from "@tc/factories";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { db } from "@/server/db/client";
import { events, tripSnapshots } from "@/server/db/schema";
import { readStreamHeadSeq } from "@/server/eventStore";
import { getTripDetail, rebuildProjections } from "@/server/projections";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import {
  SNAPSHOT_TRIP_MAX,
  deleteSnapshot,
  listSnapshots,
  renameSnapshot,
  restoreSnapshot,
  saveSnapshot,
} from "./snapshots";

// The module asks the access seam, whose file also holds the session-reading
// wrapper. Nothing here reads a session; this keeps next-auth out of the run.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// M40 D4, D5. A snapshot is a row, never an event; restoring one is the
// pipeline's own `RevertToState`, so what these prove about the log is proven
// against the pipeline, not against a copy of it.
let OWNER = "";
let EDITOR = "";
let SUGGESTER = "";
let VIEWER = "";
let tripId = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `snap-owner-${run}`;
  EDITOR = `snap-eda-${run}`;
  SUGGESTER = `snap-sam-${run}`;
  VIEWER = `snap-vera-${run}`;
  // A free owner's granted roles cap to viewer (M20 link 6).
  await entitleAccounts([OWNER]);
  tripId = randomUUID();
  // Two days, from the factory: the trip is about having something to lose.
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER)).ok).toBe(true);
  for (const command of commandsFor("threeDayTrip", tripId, { dayCount: 2, activitiesPerDay: 1, unscheduledCount: 0 })) {
    expect((await executeTripCommand(command, OWNER)).ok).toBe(true);
  }
  for (const [userId, role] of [[EDITOR, "editor"], [SUGGESTER, "suggester"], [VIEWER, "viewer"]] as const) {
    await grantMembership(db, { tripId, userId, role, invitedBy: OWNER, now: new Date().toISOString() });
  }
});

const saved = async (name: string, by = EDITOR) => {
  const result = await saveSnapshot(tripId, by, { name });
  if (!result.ok) throw new Error(`save refused: ${result.error.code}`);
  return result.value;
};

const days = async () => (await getTripDetail(tripId))!.days.map((d) => d.dayId);

describe("restoring a snapshot", () => {
  it("lands ONE batch, and one undo returns the trip to before the restore", async () => {
    const snapshot = await saved("Before Kyoto");
    const before = await days();
    expect(snapshot.seq).toBe(await readStreamHeadSeq(db, tripId));

    // Two separate changes after the save: two batches, so a restore that
    // replayed them one by one would show as more than one.
    const added = randomUUID();
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: added }, OWNER)).ok).toBe(true);
    expect((await executeTripCommand({ type: "SetTripName", tripId, name: "Kyoto, again" }, OWNER)).ok).toBe(true);
    const changed = await days();
    const headBefore = await readStreamHeadSeq(db, tripId);

    const restored = await restoreSnapshot(tripId, snapshot.id, EDITOR);
    expect(restored.ok).toBe(true);
    const appended = await db
      .select({ batchId: events.batchId, origin: events.origin, actorId: events.actorId })
      .from(events)
      .where(eq(events.streamId, tripId))
      .then((rows) => rows.slice(headBefore));
    expect(appended.length).toBeGreaterThan(0);
    expect(new Set(appended.map((e) => e.batchId)).size).toBe(1);
    expect(appended[0]).toMatchObject({ origin: { kind: "revert", toSeq: snapshot.seq }, actorId: EDITOR });
    expect(await days()).toEqual(before);
    expect((await getTripDetail(tripId))!.name).not.toBe("Kyoto, again");

    const undone = await executeTripCommand({ type: "UndoLastChange", tripId }, EDITOR);
    expect(undone.ok).toBe(true);
    expect(await days()).toEqual(changed);
    expect((await getTripDetail(tripId))!.name).toBe("Kyoto, again");
  });

  it("brings back a day removed after the snapshot was saved, with its stops", async () => {
    const detail = (await getTripDetail(tripId))!;
    const doomed = detail.days[1]!;
    expect(doomed.activityIds.length).toBeGreaterThan(0);
    const snapshot = await saved("Both days");

    expect((await executeTripCommand({ type: "RemoveDay", tripId, dayId: doomed.dayId }, OWNER)).ok).toBe(true);
    expect(await days()).not.toContain(doomed.dayId);

    expect((await restoreSnapshot(tripId, snapshot.id, OWNER)).ok).toBe(true);
    const back = (await getTripDetail(tripId))!.days.find((d) => d.dayId === doomed.dayId);
    expect(back?.activityIds).toEqual(doomed.activityIds);
  });

  it("refuses as no-op, and appends nothing, when the trip already matches", async () => {
    const snapshot = await saved("Now");
    const head = await readStreamHeadSeq(db, tripId);
    const result = await restoreSnapshot(tripId, snapshot.id, EDITOR);
    expect(result).toMatchObject({ ok: false, error: { code: "no-op" } });
    expect(await readStreamHeadSeq(db, tripId)).toBe(head);
  });
});

describe("the cap", () => {
  it(`refuses snapshot ${SNAPSHOT_TRIP_MAX + 1} with the reason, and takes one again after a delete`, async () => {
    const all = [];
    for (let i = 0; i < SNAPSHOT_TRIP_MAX; i++) all.push(await saved(`Snapshot ${i + 1}`));
    const refused = await saveSnapshot(tripId, EDITOR, { name: "One too many" });
    expect(refused).toMatchObject({ ok: false, error: { code: "too-many-snapshots" } });
    if (!refused.ok) expect(refused.error.message).toContain(String(SNAPSHOT_TRIP_MAX));
    expect(await db.$count(tripSnapshots, eq(tripSnapshots.tripId, tripId))).toBe(SNAPSHOT_TRIP_MAX);

    expect((await deleteSnapshot(tripId, all[0]!.id, EDITOR)).ok).toBe(true);
    expect((await saveSnapshot(tripId, EDITOR, { name: "Room again" })).ok).toBe(true);
  });
});

describe("who may", () => {
  it("refuses a suggester every write, and lets them and a viewer list", async () => {
    const snapshot = await saved("Editor's");
    const head = await readStreamHeadSeq(db, tripId);
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER)).ok).toBe(true);

    for (const write of [
      () => saveSnapshot(tripId, SUGGESTER, { name: "Mine" }),
      () => renameSnapshot(tripId, snapshot.id, SUGGESTER, { name: "Mine now" }),
      () => deleteSnapshot(tripId, snapshot.id, SUGGESTER),
      () => restoreSnapshot(tripId, snapshot.id, SUGGESTER),
    ]) {
      expect(await write()).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    // The restore was refused before the pipeline: the trip kept its new day.
    expect(await readStreamHeadSeq(db, tripId)).toBe(head + 1);

    for (const reader of [SUGGESTER, VIEWER]) {
      const listed = await listSnapshots(tripId, reader);
      expect(listed).toMatchObject({ ok: true, value: [{ id: snapshot.id, name: "Editor's" }] });
    }
  });

  it("answers a stranger not-found, so the trip's existence is not confirmed", async () => {
    const stranger = `snap-stranger-${randomUUID()}`;
    expect(await listSnapshots(tripId, stranger)).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await saveSnapshot(tripId, stranger, { name: "x" })).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});

describe("rename, delete and the list", () => {
  it("lists newest first, renames without moving the position, and deletes for good", async () => {
    const first = await saved("First");
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER)).ok).toBe(true);
    const second = await saved("Second", OWNER);

    const renamed = await renameSnapshot(tripId, first.id, OWNER, { name: "The first" });
    expect(renamed).toMatchObject({ ok: true, value: { id: first.id, name: "The first", seq: first.seq } });

    const listed = await listSnapshots(tripId, VIEWER);
    expect(listed.ok && listed.value.map((s) => s.name)).toEqual(["Second", "The first"]);

    expect((await deleteSnapshot(tripId, second.id, EDITOR)).ok).toBe(true);
    expect(await deleteSnapshot(tripId, second.id, EDITOR)).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await db.select().from(tripSnapshots).where(inArray(tripSnapshots.id, [second.id]))).toEqual([]);
  });

  it("does not reach a snapshot through another trip's id", async () => {
    const snapshot = await saved("Kept here");
    const other = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId: other, name: "Elsewhere" }, OWNER)).ok).toBe(true);
    expect(await deleteSnapshot(other, snapshot.id, OWNER)).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await restoreSnapshot(other, snapshot.id, OWNER)).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});

// The schema's reason for having no foreign key to the trip: the only table
// keyed by trip id is a projection a rebuild deletes and re-inserts.
it("survives a projection rebuild", async () => {
  const snapshot = await saved("Through a rebuild");
  await rebuildProjections();
  const listed = await listSnapshots(tripId, OWNER);
  expect(listed.ok && listed.value.map((s) => s.id)).toEqual([snapshot.id]);
});
