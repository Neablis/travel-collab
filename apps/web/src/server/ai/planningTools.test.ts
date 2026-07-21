import { beforeEach, describe, expect, it, vi } from "vitest";
import { BatchableCommand } from "@tc/contracts";

const executeTripCommandBatch = vi.fn();
vi.mock("../commands", () => ({
  executeTripCommandBatch: (...args: unknown[]) => executeTripCommandBatch(...args),
}));

import { buildPlanningTools, flushPlanningBatch } from "./planningTools";

const TRIP_ID = "11111111-1111-1111-1111-111111111111";

describe("buildPlanningTools", () => {
  it("has exactly one tool per BatchableCommand union member, keyed by type", () => {
    const expectedTypes = BatchableCommand.options.map((o) => o.shape.type.value).sort();
    const { tools } = buildPlanningTools(TRIP_ID);
    expect(Object.keys(tools).sort()).toEqual(expectedTypes);
  });

  it("rejects a malformed command via the tool's parameters schema", () => {
    const { tools } = buildPlanningTools(TRIP_ID);
    // AddDay requires a uuid dayId — missing entirely should fail.
    const result = tools.AddDay!.parameters.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parameters omit tripId — providing one is harmless, not required", () => {
    const { tools } = buildPlanningTools(TRIP_ID);
    const withoutTripId = tools.AddDay!.parameters.safeParse({
      dayId: "22222222-2222-2222-2222-222222222222",
    });
    expect(withoutTripId.success).toBe(true);

    const withTripId = tools.AddDay!.parameters.safeParse({
      dayId: "22222222-2222-2222-2222-222222222222",
      tripId: TRIP_ID,
    });
    expect(withTripId.success).toBe(true);
  });

  it("collects executed tool calls, injecting tripId and type, retrievable via getCollected", async () => {
    const { tools, getCollected } = buildPlanningTools(TRIP_ID);
    const dayId = "22222222-2222-2222-2222-222222222222";
    await tools.AddDay!.execute!({ dayId }, { toolCallId: "call-1", messages: [] });

    expect(getCollected()).toEqual([{ type: "AddDay", tripId: TRIP_ID, dayId }]);
  });
});

describe("flushPlanningBatch", () => {
  beforeEach(() => {
    executeTripCommandBatch.mockReset();
  });

  it("submits the collected commands array to executeTripCommandBatch and returns its result", async () => {
    const calls: BatchableCommand[] = [
      { type: "AddDay", tripId: TRIP_ID, dayId: "22222222-2222-2222-2222-222222222222" },
    ];
    const fakeResult = { ok: true, tripId: TRIP_ID, detail: {}, history: {} };
    executeTripCommandBatch.mockResolvedValue(fakeResult);

    const result = await flushPlanningBatch(TRIP_ID, calls, "actor-1");

    expect(executeTripCommandBatch).toHaveBeenCalledWith(calls, "actor-1");
    expect(result).toBe(fakeResult);
  });
});
