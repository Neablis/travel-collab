import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { BatchableCommand } from "@tc/contracts";
import { buildPlanningTools } from "./planningTools";

const EXEC_OPTS = { toolCallId: "c1", messages: [], context: undefined } as never;

function shapeOf(schema: unknown): Record<string, unknown> {
  return (schema as { shape: Record<string, unknown> }).shape;
}

describe("buildPlanningTools", () => {
  it("has exactly one tool per BatchableCommand union member, keyed by type", () => {
    const expected = BatchableCommand.options.map((o) => o.shape.type.value).sort();
    const { tools } = buildPlanningTools();
    expect(Object.keys(tools).sort()).toEqual(expected);
  });

  it("drops mint + inject id fields and swaps ref fields for <entity>Ref", () => {
    const { tools } = buildPlanningTools();
    // AddActivity: activityId (mint) + dayId (ref) gone; dayRef present; no tripId/type.
    const add = shapeOf(tools.AddActivity!.inputSchema);
    expect(add).not.toHaveProperty("activityId");
    expect(add).not.toHaveProperty("dayId");
    expect(add).not.toHaveProperty("tripId");
    expect(add).toHaveProperty("dayRef");
    expect(add).toHaveProperty("title");
    // AddDay: dayId (mint) gone — nothing id-bearing left.
    expect(shapeOf(tools.AddDay!.inputSchema)).not.toHaveProperty("dayId");
    // MoveActivity: activityRef + dayRef, not activityId/toDayId.
    const move = shapeOf(tools.MoveActivity!.inputSchema);
    expect(move).toHaveProperty("activityRef");
    expect(move).toHaveProperty("dayRef");
    expect(move).toHaveProperty("position");
    expect(move).not.toHaveProperty("activityId");
    expect(move).not.toHaveProperty("toDayId");
    // RemoveDay -> dayRef; DismissConflict -> conflictRef; RemoveActivity -> activityRef.
    expect(shapeOf(tools.RemoveDay!.inputSchema)).toHaveProperty("dayRef");
    expect(shapeOf(tools.DismissConflict!.inputSchema)).toHaveProperty("conflictRef");
    expect(shapeOf(tools.RemoveActivity!.inputSchema)).toHaveProperty("activityRef");
  });

  it("records the model's raw intent (type + args), resolving nothing", async () => {
    const { tools, getCollected } = buildPlanningTools();
    await tools.MoveActivity!.execute!(
      { activityRef: "Colosseum tour", dayRef: "day 2", position: 0 },
      EXEC_OPTS,
    );
    expect(getCollected()).toEqual([
      { type: "MoveActivity", args: { activityRef: "Colosseum tour", dayRef: "day 2", position: 0 } },
    ]);
  });

  it("AddActivity accepts a validated payload with no ids", () => {
    const { tools } = buildPlanningTools();
    const parsed = (tools.AddActivity!.inputSchema as unknown as ZodTypeAny).safeParse({
      title: "Lunch",
      dayRef: "day 1",
    });
    expect(parsed.success).toBe(true);
  });
});
