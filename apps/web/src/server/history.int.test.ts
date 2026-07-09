import { describe, expect, it } from "vitest";
import { executeTripCommand } from "./commands";
import { getTripDetailAt, getTripHistory } from "./history";

describe("history reads", () => {
  it("returns batch-grouped entries newest-first with undo/redo availability", async () => {
    const tripId = crypto.randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Readable" });
    await run({ type: "AddDay", tripId, dayId: crypto.randomUUID() });
    await run({ type: "UndoLastChange", tripId });

    const history = await getTripHistory(tripId);
    expect(history).not.toBeNull();
    expect(history!.entries.map((e) => e.description)).toEqual([
      "Undid: Added Day 1",
      "Added Day 1",
      'Created trip "Readable"',
    ]);
    expect(history!.entries[1]!.undone).toBe(true);
    expect(history!.canUndo).toBe(false); // only the creation batch remains effective
    expect(history!.canRedo).toBe(true);
  });

  it("replays detail at a seq, conflicts recomputed", async () => {
    const tripId = crypto.randomUUID();
    const dayId = crypto.randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Replay" });
    await run({ type: "AddDay", tripId, dayId }); // seq 2
    await run({ type: "AddActivity", tripId, activityId: crypto.randomUUID(), dayId, title: "A", timeWindow: { start: "09:00", end: "11:00" } });
    await run({ type: "AddActivity", tripId, activityId: crypto.randomUUID(), dayId, title: "B", timeWindow: { start: "10:00", end: "12:00" } });

    const beforeActivities = await getTripDetailAt(tripId, 2);
    expect(Object.keys(beforeActivities!.activities)).toEqual([]);
    expect(beforeActivities!.conflicts).toEqual([]);
    const atHead = await getTripDetailAt(tripId, 4);
    expect(atHead!.conflicts).toHaveLength(1);
    expect(await getTripDetailAt(tripId, 99)).toBeNull();
    expect(await getTripDetailAt(tripId, 0)).toBeNull();
  });
});
