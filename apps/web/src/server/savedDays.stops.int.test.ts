import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedDay, type SavedStop } from "@tc/contracts";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { getSavedDay, listSavedDays } from "./savedDays";

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
    const { kind: _kind, tags: _tags, ...legacyStop } = wellFormedStop();
    const savedDayId = await insertRawRow(ownerId, [legacyStop]);

    expect(await getSavedDay(savedDayId, ownerId)).toBeNull();
  });

  it("names the row and the field in the server log rather than failing opaquely", async () => {
    const ownerId = freshOwner();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { kind: _kind, ...legacyStop } = wellFormedStop();
    const savedDayId = await insertRawRow(ownerId, [legacyStop]);

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
    const { kind: _kind, ...legacyStop } = wellFormedStop();
    await insertRawRow(ownerId, [legacyStop]);
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
