import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedDay, type SavedStop, type TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { getSavedDay, listSavedDays, saveDay } from "./savedDays";

// KI-71. `saved_days.stops` is `jsonb("stops").$type<SavedStop[]>()`, and
// `$type` is a compile-time cast on Drizzle's side — nothing checks the bytes.
// This file writes rows the way the database can already hold them and the way
// a moving contract will eventually produce them, and pins what a read does
// with one.
//
// A SEPARATE file from `savedDays.int.test.ts` on purpose: that suite truncates
// `saved_days` in `beforeEach` (KI-69) and every test in it asserts the happy
// path. These rows are deliberately malformed, so they are inserted directly,
// scoped to their own random owner, and cleaned up after themselves — no
// truncation, so this file cannot decide what a concurrently-running one sees.

/** A row the write path could never produce today, but the column can hold. */
async function insertRawRow(ownerId: string, stops: unknown): Promise<string> {
  const savedDayId = randomUUID();
  await db.insert(savedDays).values({
    id: savedDayId,
    ownerId,
    name: "A day from before",
    // The cast IS the defect under test: this is exactly the claim `$type`
    // makes about every row already on disk.
    stops: stops as SavedStop[],
    sourceTripId: randomUUID(),
    sourceTripName: "Kyoto",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return savedDayId;
}

/** A stop as it is written today — the control for every case below. */
function wellFormedStop(): SavedStop {
  return {
    title: "Fushimi Inari",
    timeWindow: { start: "09:00", end: "11:00" },
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
  };
}

/**
 * A stop as it was written before `keys` existed. Built by deletion rather
 * than by hand, so it stays a real stop in every other respect — the point is
 * a row that was legal when it was written, not an arbitrary broken object.
 */
function stopWithout(...keys: (keyof SavedStop)[]): Record<string, unknown> {
  const stop: Record<string, unknown> = { ...wellFormedStop() };
  for (const key of keys) delete stop[key];
  return stop;
}

const owners: string[] = [];
function freshOwner(): string {
  const ownerId = `saved-stops-${randomUUID()}`;
  owners.push(ownerId);
  return ownerId;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const ownerId of owners.splice(0)) {
    await db.delete(savedDays).where(eq(savedDays.ownerId, ownerId));
  }
});

describe("saved day rows are parsed at the read boundary (KI-71)", () => {
  it("round-trips a well-formed row unchanged", async () => {
    const ownerId = freshOwner();
    const savedDayId = await insertRawRow(ownerId, [wellFormedStop()]);

    const read = await getSavedDay(savedDayId, ownerId);
    expect(read).not.toBeNull();
    expect(() => SavedDay.parse(read)).not.toThrow();
    expect(read!.stops).toEqual([wellFormedStop()]);
  });

  // The entry's scenario, made concrete: a row written before a field existed.
  // `SavedStop.kind` and `.tags` carry no `.default()` (unlike `ActivityView`'s,
  // which were defaulted precisely so old `trip_details` docs stay legal), so a
  // row missing them is a row today's contract rejects.
  it("does not hand back a row whose stops no longer satisfy the contract", async () => {
    const ownerId = freshOwner();
    // Silenced here, asserted in the next test: the log is part of the fix, but
    // one deliberately-broken row should not print a stack trace per run.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const savedDayId = await insertRawRow(ownerId, [stopWithout("kind", "tags")]);

    expect(await getSavedDay(savedDayId, ownerId)).toBeNull();
  });

  it("names the row and the field in the server log rather than failing opaquely", async () => {
    const ownerId = freshOwner();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const savedDayId = await insertRawRow(ownerId, [stopWithout("kind")]);

    await getSavedDay(savedDayId, ownerId);

    expect(error).toHaveBeenCalledOnce();
    const [, context] = error.mock.calls[0] as [string, { savedDayId: string; issues: unknown[] }];
    expect(context.savedDayId).toBe(savedDayId);
    expect(JSON.stringify(context.issues)).toContain("kind");
  });

  // One unreadable row is not the whole library. The list is what the Library
  // dialog renders, and losing every saved day because one is old would be a
  // worse outcome than the one this entry is about.
  it("skips an unreadable row in the list instead of failing the whole read", async () => {
    const ownerId = freshOwner();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await insertRawRow(ownerId, [stopWithout("kind")]);
    const goodId = await insertRawRow(ownerId, [wellFormedStop()]);

    const list = await listSavedDays(ownerId);
    expect(list.map((d) => d.savedDayId)).toEqual([goodId]);
    expect(() => SavedDay.array().parse(list)).not.toThrow();
  });

  // Not just "a missing key": the column can hold anything jsonb can hold, and
  // a read must not throw on any of it.
  it("survives a stops value that is not an array of objects at all", async () => {
    const ownerId = freshOwner();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const savedDayId = await insertRawRow(ownerId, "not stops at all");

    expect(await getSavedDay(savedDayId, ownerId)).toBeNull();
    expect(await listSavedDays(ownerId)).toEqual([]);
  });
});

// The write half of the same boundary. `saveDay` parses the stops it computed
// BEFORE inserting, and the comment there says why — PR #71 review §2 inserted
// the library row and THEN threw at the response boundary, leaving the user a
// 500 and a contract-violating row. A comment asserting an invariant that no
// test enforces is this repo's named recurring defect class (CodeRabbit,
// PR #85), so it is enforced here.
describe("saveDay refuses a day it could not read back (KI-71, write half)", () => {
  // A detail whose stops cannot pass `SavedStop` — the shape `stopsForDay`
  // produced when it was handed a raw, unparsed `trip_details.doc`. Built as a
  // cast rather than by aging a real row, because the read boundary now repairs
  // an aged row (KI-74) and the point here is what `saveDay` does when its
  // input is bad ANYWAY.
  function detailWithOneStop(kind: "planned" | undefined): TripDetail {
    const activityId = randomUUID();
    const dayId = randomUUID();
    return {
      ...tripDetailFixture(),
      days: [{ dayId, activityIds: [activityId], date: null, costSubtotal: 0 }],
      activities: {
        [activityId]: {
          activityId,
          title: "Ramen",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [],
          // `undefined` is the value PR #71 review §2 turned up here.
          kind,
          tags: [],
          cost: null,
        } as unknown as TripDetail["activities"][string],
      },
    };
  }

  it("returns invalid, and writes no row", async () => {
    const ownerId = freshOwner();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const detail = detailWithOneStop(undefined);

    const result = await saveDay({ name: "A bad day", dayId: detail.days[0]!.dayId }, detail, ownerId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("invalid");
    // The whole point: nothing was persisted. The old failure mode inserted
    // first and threw afterwards, so asserting the error alone would pass
    // against exactly the bug this guards.
    expect(await listSavedDays(ownerId)).toEqual([]);
    expect(error).toHaveBeenCalledOnce();
  });

  it("still saves a day whose stops are fine", async () => {
    const ownerId = freshOwner();
    // The SAME builder, one field apart — so a refusal that came from anything
    // other than the bad `kind` would show up here as a failure too.
    const detail = detailWithOneStop("planned");

    const result = await saveDay(
      { name: "A good day", dayId: detail.days[0]!.dayId },
      detail,
      ownerId,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(() => SavedDay.parse(result.value)).not.toThrow();
    expect((await listSavedDays(ownerId)).map((day) => day.savedDayId)).toEqual([
      result.value.savedDayId,
    ]);
  });
});
