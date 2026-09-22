import { describe, expect, it } from "vitest";
import type { ActivityView, BatchableCommand, TripDetail } from "@tc/contracts";
import { activityFactory, tripDetailFixture } from "@tc/factories";
import {
  activityTargets,
  concurrentEditConflicts,
  CONCURRENT_EDIT_KIND,
  pruneResolved,
} from "./concurrentEdits";

const TRIP = tripDetailFixture().tripId;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stop = (activityId: string, over: Partial<ActivityView> = {}): ActivityView =>
  activityFactory.build({ activityId, title: "Fushimi Inari", ...over });

const detailWith = (activities: ActivityView[]): TripDetail =>
  tripDetailFixture({
    activities: Object.fromEntries(activities.map((a) => [a.activityId, a])),
  });

describe("activityTargets", () => {
  it.each([
    ["UpdateActivity", { type: "UpdateActivity", tripId: TRIP, activityId: A, title: "x" }],
    ["MoveActivity", { type: "MoveActivity", tripId: TRIP, activityId: A, toDayId: null, position: 0 }],
    ["RemoveActivity", { type: "RemoveActivity", tripId: TRIP, activityId: A }],
    ["AddActivity", { type: "AddActivity", tripId: TRIP, activityId: A, title: "x" }],
  ])("finds the stop %s is about", (_label, command) => {
    expect(activityTargets([command as BatchableCommand])).toEqual([A]);
  });

  it("ignores commands that name no stop", () => {
    expect(activityTargets([{ type: "AddDay", tripId: TRIP, dayId: "d1" } as BatchableCommand])).toEqual([]);
  });

  it("does not repeat a stop named twice", () => {
    expect(
      activityTargets([
        { type: "RemoveActivity", tripId: TRIP, activityId: A },
        { type: "UpdateActivity", tripId: TRIP, activityId: A, title: "y" },
      ] as BatchableCommand[]),
    ).toEqual([A]);
  });
});

describe("concurrentEditConflicts", () => {
  it("says nothing when the stop did not move on the server", () => {
    const before = detailWith([stop(A)]);
    expect(concurrentEditConflicts([A], before, detailWith([stop(A)]))).toEqual([]);
  });

  it("raises a conflict when the stop changed under unsent work", () => {
    const before = detailWith([stop(A, { title: "Fushimi Inari" })]);
    const after = detailWith([stop(A, { title: "Kiyomizu-dera" })]);
    const [conflict] = concurrentEditConflicts([A], before, after);

    expect(conflict).toMatchObject({
      id: `${CONCURRENT_EDIT_KIND}:${A}`,
      kind: CONCURRENT_EDIT_KIND,
      severity: "warn",
      subjects: [A],
    });
    // The server's title, not the stale local one — the description is about
    // what is there now.
    expect(conflict!.description).toContain("Kiyomizu-dera");
    expect(conflict!.resolutions.length).toBeGreaterThan(0);
  });

  it("raises a conflict when the stop was removed under unsent work", () => {
    const before = detailWith([stop(A, { title: "Fushimi Inari" })]);
    const [conflict] = concurrentEditConflicts([A], before, detailWith([]));
    expect(conflict!.description).toContain("removed");
    // Named from the copy the caller still has, since the server no longer has one.
    expect(conflict!.description).toContain("Fushimi Inari");
  });

  // The detector inherits the domain's field-by-field comparison rather than a
  // structural one, so a change to any activity field counts — which is what
  // ties it to KI-2026-09-05-o's compile-forcing field set.
  it.each([
    ["notes", { notes: "meet at the gate" }],
    ["kind", { kind: "booked" as const }],
    ["tags", { tags: ["meal" as const] }],
    ["timeWindow", { timeWindow: null }],
  ])("notices a change to %s", (_label, over) => {
    const before = detailWith([stop(A)]);
    const after = detailWith([stop(A, over)]);
    expect(concurrentEditConflicts([A], before, after)).toHaveLength(1);
  });

  // Falls out of "must exist in before" rather than being special-cased: a
  // locally added stop is in neither trip.
  it("never conflicts on a stop the caller added locally", () => {
    const before = detailWith([]);
    const after = detailWith([]);
    expect(concurrentEditConflicts([A], before, after)).toEqual([]);
  });

  it("ignores stops nothing is queued against", () => {
    const before = detailWith([stop(A), stop(B)]);
    const after = detailWith([stop(A), stop(B, { title: "changed" })]);
    // B moved, but only A is queued.
    expect(concurrentEditConflicts([A], before, after)).toEqual([]);
  });

  it("raises one per colliding stop", () => {
    const before = detailWith([stop(A), stop(B)]);
    const after = detailWith([stop(A, { notes: "x" }), stop(B, { notes: "y" })]);
    expect(concurrentEditConflicts([A, B], before, after).map((c) => c.subjects[0])).toEqual([A, B]);
  });
});

describe("pruneResolved", () => {
  const conflict = (activityId: string) => ({
    id: `${CONCURRENT_EDIT_KIND}:${activityId}`,
    kind: CONCURRENT_EDIT_KIND,
    severity: "warn" as const,
    subjects: [activityId],
    description: "d",
    resolutions: [],
  });

  it("keeps a conflict while its stop is still queued", () => {
    expect(pruneResolved([conflict(A)], [A])).toHaveLength(1);
  });

  // A concurrent-edit conflict is about UNSENT work, so it stops being true
  // the moment that work is sent.
  it("drops a conflict once nothing is queued against its stop", () => {
    expect(pruneResolved([conflict(A)], [B])).toEqual([]);
    expect(pruneResolved([conflict(A)], [])).toEqual([]);
  });
});
