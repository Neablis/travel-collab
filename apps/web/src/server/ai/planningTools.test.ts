import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { BatchableCommand } from "@tc/contracts";
import { costedTripDetailFixture, tripDetailFixture } from "../../mocks/fixtures";

const executeTripCommandBatch = vi.fn();
vi.mock("../commands", () => ({
  executeTripCommandBatch: (...args: unknown[]) => executeTripCommandBatch(...args),
}));

import { buildPlanningTools, flushPlanningBatch } from "./planningTools";

const TRIP_ID = "11111111-1111-1111-1111-111111111111";

// Fixture ids (see mocks/fixtures.ts): one day (index 0 = "day 1") holding the
// Colosseum + Forum activities, with the Rome flight in the backlog.
const DAY_1_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const COLOSSEUM_ID = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
const FORUM_ID = "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f";
const FLIGHT_ID = "4e5f6071-8293-4d0e-1f2a-3b4c5d6e7f80";

// A compound, UUID-embedding conflict id (as detectConflicts emits) — the exact
// kind of string the model must never be asked to copy.
const OVERLAP_ID = `time-overlap:${DAY_1_ID}:${COLOSSEUM_ID}:${FORUM_ID}`;
const OVER_BUDGET_ID = "over-budget:6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

// A detail carrying two active conflicts, for the DismissConflict resolver.
const conflictedDetail = () =>
  tripDetailFixture({
    conflicts: [
      {
        id: OVERLAP_ID,
        kind: "time-overlap",
        severity: "warn",
        subjects: [COLOSSEUM_ID, FORUM_ID],
        description: '"Colosseum tour" and "Roman Forum" overlap in time on the same day.',
        resolutions: ["Change one activity's time window"],
      },
      {
        id: OVER_BUDGET_ID,
        kind: "over-budget",
        severity: "warn",
        subjects: ["6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f"],
        description: "Trip total exceeds the budget.",
        resolutions: ["Raise the budget"],
      },
    ],
    dismissedConflictIds: [],
  });

const detail = () => costedTripDetailFixture();

// The AI SDK passes execute() a second "options" arg; tests don't use it, so a
// minimal stand-in keeps call sites short.
const EXEC_OPTS = { toolCallId: "call-1", messages: [], context: undefined } as never;

// `Tool.inputSchema` is typed as AI SDK's `FlexibleSchema<INPUT>` (a union
// covering Standard Schema, Zod, and other schema shapes it accepts), which
// doesn't statically expose `.safeParse`. We know the concrete value is a
// Zod schema (built via `optionSchema.omit(...)` in planningTools.ts), so
// cast it back to exercise it directly in tests.
function asZodSchema(schema: unknown): ZodTypeAny {
  return schema as ZodTypeAny;
}

describe("buildPlanningTools", () => {
  it("has exactly one tool per BatchableCommand union member, keyed by type", () => {
    const expectedTypes = BatchableCommand.options.map((o) => o.shape.type.value).sort();
    const { tools } = buildPlanningTools(TRIP_ID, detail());
    expect(Object.keys(tools).sort()).toEqual(expectedTypes);
  });

  it("rejects a malformed command via the tool's inputSchema", () => {
    const { tools } = buildPlanningTools(TRIP_ID, detail());
    // AddDay requires a uuid dayId — missing entirely should fail.
    const result = asZodSchema(tools.AddDay!.inputSchema).safeParse({});
    expect(result.success).toBe(false);
  });

  it("inputSchema omits tripId — providing one is harmless, not required", () => {
    const { tools } = buildPlanningTools(TRIP_ID, detail());
    const withoutTripId = asZodSchema(tools.AddDay!.inputSchema).safeParse({
      dayId: "22222222-2222-2222-2222-222222222222",
    });
    expect(withoutTripId.success).toBe(true);

    const withTripId = asZodSchema(tools.AddDay!.inputSchema).safeParse({
      dayId: "22222222-2222-2222-2222-222222222222",
      tripId: TRIP_ID,
    });
    expect(withTripId.success).toBe(true);
  });

  it("money-bearing tools spell out integer minor units, guarding the silent-corruption trap", () => {
    const { tools } = buildPlanningTools(TRIP_ID, detail());
    // amountMinor is cents, but nothing in the derived Money schema hints it —
    // so the model could emit `amountMinor: 500` for "5 EUR" (structurally
    // valid, silently wrong). Every tool that carries a Money field must say so.
    for (const type of ["SetTripBudget", "AddActivity", "UpdateActivity"] as const) {
      expect(tools[type]!.description).toMatch(/minor units|cents/i);
    }
  });

  it("collects executed tool calls, injecting tripId and type, retrievable via getCollected", async () => {
    const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
    const dayId = "22222222-2222-2222-2222-222222222222";
    await tools.AddDay!.execute!({ dayId }, EXEC_OPTS);

    expect(getCollected()).toEqual([{ type: "AddDay", tripId: TRIP_ID, dayId }]);
  });
});

describe("reference resolution", () => {
  // The id-bearing tools swap `activityId`/`toDayId` for human refs; the
  // derived schema no longer accepts a raw `activityId`, but still accepts an
  // `activityRef`.
  it("Move/Update/Remove schemas expose activityRef, not activityId", () => {
    const { tools } = buildPlanningTools(TRIP_ID, detail());
    for (const type of ["MoveActivity", "UpdateActivity", "RemoveActivity"] as const) {
      const shape = (asZodSchema(tools[type]!.inputSchema) as unknown as { shape: Record<string, unknown> }).shape;
      expect(shape).toHaveProperty("activityRef");
      expect(shape).not.toHaveProperty("activityId");
    }
    const moveShape = (asZodSchema(tools.MoveActivity!.inputSchema) as unknown as { shape: Record<string, unknown> })
      .shape;
    expect(moveShape).toHaveProperty("dayRef");
    expect(moveShape).not.toHaveProperty("toDayId");
  });

  it("AddActivity schema exposes dayRef, not dayId (activityId is untouched — it's a new entity)", () => {
    const { tools } = buildPlanningTools(TRIP_ID, detail());
    const shape = (asZodSchema(tools.AddActivity!.inputSchema) as unknown as { shape: Record<string, unknown> })
      .shape;
    expect(shape).toHaveProperty("dayRef");
    expect(shape).not.toHaveProperty("dayId");
    expect(shape).toHaveProperty("activityId");
  });

  it("RemoveDay schema exposes dayRef, not dayId", () => {
    const { tools } = buildPlanningTools(TRIP_ID, detail());
    const shape = (asZodSchema(tools.RemoveDay!.inputSchema) as unknown as { shape: Record<string, unknown> }).shape;
    expect(shape).toHaveProperty("dayRef");
    expect(shape).not.toHaveProperty("dayId");
  });

  describe("activityRef", () => {
    it("resolves an exact title to its id", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = await tools.RemoveActivity!.execute!({ activityRef: "Roman Forum" }, EXEC_OPTS);

      expect(result).toEqual({ queued: true, type: "RemoveActivity", tripId: TRIP_ID });
      expect(getCollected()).toEqual([{ type: "RemoveActivity", tripId: TRIP_ID, activityId: FORUM_ID }]);
    });

    it("resolves a title case-insensitively and trimmed", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.RemoveActivity!.execute!({ activityRef: "  colosseum TOUR  " }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "RemoveActivity", tripId: TRIP_ID, activityId: COLOSSEUM_ID }]);
    });

    it("accepts a raw id that exists (the old copy-the-UUID path still works)", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.RemoveActivity!.execute!({ activityRef: FLIGHT_ID }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "RemoveActivity", tripId: TRIP_ID, activityId: FLIGHT_ID }]);
    });

    it("errors (and collects nothing) for an unknown title", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = (await tools.RemoveActivity!.execute!({ activityRef: "Sagrada Familia" }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(result.queued).toBe(false);
      expect(result.error).toContain("No activity named");
      expect(getCollected()).toEqual([]);
    });

    it("errors (and collects nothing) for an id that does not exist", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const missing = "99999999-9999-4999-8999-999999999999";
      const result = (await tools.RemoveActivity!.execute!({ activityRef: missing }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(result.queued).toBe(false);
      expect(result.error).toContain(missing);
      expect(getCollected()).toEqual([]);
    });

    it("errors on an ambiguous title without guessing, asking for the exact id", async () => {
      // Two activities share the title "Museum" — resolution must refuse.
      const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const ambiguous = tripDetailFixture({
        activities: {
          [a]: { activityId: a, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
          [b]: { activityId: b, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
        },
      });
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, ambiguous);
      const result = (await tools.RemoveActivity!.execute!({ activityRef: "Museum" }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(result.queued).toBe(false);
      expect(result.error).toContain("matches 2 activities");
      expect(getCollected()).toEqual([]);
    });
  });

  describe("UpdateActivity carries through the non-id fields", () => {
    it("resolves activityRef and keeps the update payload", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.UpdateActivity!.execute!({ activityRef: "Roman Forum", notes: "bring water" }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "UpdateActivity", tripId: TRIP_ID, activityId: FORUM_ID, notes: "bring water" },
      ]);
    });
  });

  describe("MoveActivity dayRef", () => {
    it('resolves "day N" (1-based) to that day\'s id', async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.MoveActivity!.execute!({ activityRef: "Flight to Rome", dayRef: "day 1", position: 0 }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "MoveActivity", tripId: TRIP_ID, activityId: FLIGHT_ID, toDayId: DAY_1_ID, position: 0 },
      ]);
    });

    it("resolves a bare day number to that day's id", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.MoveActivity!.execute!({ activityRef: "Flight to Rome", dayRef: 1, position: 2 }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "MoveActivity", tripId: TRIP_ID, activityId: FLIGHT_ID, toDayId: DAY_1_ID, position: 2 },
      ]);
    });

    it("resolves null and \"backlog\" to the backlog (toDayId null)", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.MoveActivity!.execute!({ activityRef: "Colosseum tour", dayRef: null, position: 0 }, EXEC_OPTS);
      await tools.MoveActivity!.execute!({ activityRef: "Roman Forum", dayRef: "backlog", position: 0 }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "MoveActivity", tripId: TRIP_ID, activityId: COLOSSEUM_ID, toDayId: null, position: 0 },
        { type: "MoveActivity", tripId: TRIP_ID, activityId: FORUM_ID, toDayId: null, position: 0 },
      ]);
    });

    it("resolves a raw dayId that exists", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.MoveActivity!.execute!({ activityRef: "Flight to Rome", dayRef: DAY_1_ID, position: 0 }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "MoveActivity", tripId: TRIP_ID, activityId: FLIGHT_ID, toDayId: DAY_1_ID, position: 0 },
      ]);
    });

    it("errors (and collects nothing) on an out-of-range day number", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = (await tools.MoveActivity!.execute!(
        { activityRef: "Flight to Rome", dayRef: "day 2", position: 0 },
        EXEC_OPTS,
      )) as { queued: boolean; error?: string };

      expect(result.queued).toBe(false);
      expect(result.error).toContain("out of range");
      expect(getCollected()).toEqual([]);
    });

    it("errors (and collects nothing) on an unresolvable dayRef string", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = (await tools.MoveActivity!.execute!(
        { activityRef: "Flight to Rome", dayRef: "next tuesday", position: 0 },
        EXEC_OPTS,
      )) as { queued: boolean; error?: string };

      expect(result.queued).toBe(false);
      expect(getCollected()).toEqual([]);
    });

    it("does not collect a Move when the activity ref fails, even with a valid dayRef", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = (await tools.MoveActivity!.execute!(
        { activityRef: "Nonexistent", dayRef: "day 1", position: 0 },
        EXEC_OPTS,
      )) as { queued: boolean };

      expect(result.queued).toBe(false);
      expect(getCollected()).toEqual([]);
    });
  });

  describe("AddActivity dayRef", () => {
    it('resolves "day N" (1-based) to that day\'s id', async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const activityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      await tools.AddActivity!.execute!({ activityId, title: "New stop", dayRef: "day 1" }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "AddActivity", tripId: TRIP_ID, activityId, title: "New stop", dayId: DAY_1_ID },
      ]);
    });

    it("resolves a raw dayId that exists", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const activityId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      await tools.AddActivity!.execute!({ activityId, title: "New stop", dayRef: DAY_1_ID }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "AddActivity", tripId: TRIP_ID, activityId, title: "New stop", dayId: DAY_1_ID },
      ]);
    });

    it("omitting dayRef leaves the activity in the backlog (no dayId on the command)", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const activityId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      await tools.AddActivity!.execute!({ activityId, title: "New stop" }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "AddActivity", tripId: TRIP_ID, activityId, title: "New stop" }]);
    });

    it('null and "backlog" also resolve to the backlog', async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const idA = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
      const idB = "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb";
      await tools.AddActivity!.execute!({ activityId: idA, title: "Stop A", dayRef: null }, EXEC_OPTS);
      await tools.AddActivity!.execute!({ activityId: idB, title: "Stop B", dayRef: "backlog" }, EXEC_OPTS);

      expect(getCollected()).toEqual([
        { type: "AddActivity", tripId: TRIP_ID, activityId: idA, title: "Stop A" },
        { type: "AddActivity", tripId: TRIP_ID, activityId: idB, title: "Stop B" },
      ]);
    });

    it("errors (and collects nothing) on an out-of-range day number — this is the day-not-found bug fix", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const activityId = "ffffffff-1111-4fff-8fff-ffffffffffff";
      const result = (await tools.AddActivity!.execute!(
        { activityId, title: "New stop", dayRef: "day 2" },
        EXEC_OPTS,
      )) as { queued: boolean; error?: string };

      expect(result.queued).toBe(false);
      expect(result.error).toContain("out of range");
      expect(getCollected()).toEqual([]);
    });

    it("errors (and collects nothing) on an unresolvable dayRef string", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const activityId = "12345678-1111-4123-8123-123456789012";
      const result = (await tools.AddActivity!.execute!(
        { activityId, title: "New stop", dayRef: "next tuesday" },
        EXEC_OPTS,
      )) as { queued: boolean; error?: string };

      expect(result.queued).toBe(false);
      expect(getCollected()).toEqual([]);
    });
  });

  describe("RemoveDay dayRef", () => {
    it('resolves "day N" (1-based) to that day\'s id', async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = await tools.RemoveDay!.execute!({ dayRef: "day 1" }, EXEC_OPTS);

      expect(result).toEqual({ queued: true, type: "RemoveDay", tripId: TRIP_ID });
      expect(getCollected()).toEqual([{ type: "RemoveDay", tripId: TRIP_ID, dayId: DAY_1_ID }]);
    });

    it("resolves a bare day number to that day's id", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.RemoveDay!.execute!({ dayRef: 1 }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "RemoveDay", tripId: TRIP_ID, dayId: DAY_1_ID }]);
    });

    it("resolves a raw dayId that exists", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      await tools.RemoveDay!.execute!({ dayRef: DAY_1_ID }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "RemoveDay", tripId: TRIP_ID, dayId: DAY_1_ID }]);
    });

    it("errors (and collects nothing) on an out-of-range day number — this is the day-not-found bug fix", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = (await tools.RemoveDay!.execute!({ dayRef: "day 2" }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(result.queued).toBe(false);
      expect(result.error).toContain("out of range");
      expect(getCollected()).toEqual([]);
    });

    it("errors (and collects nothing) on an unresolvable dayRef string", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = (await tools.RemoveDay!.execute!({ dayRef: "next tuesday" }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(result.queued).toBe(false);
      expect(getCollected()).toEqual([]);
    });

    it('rejects null and "backlog" — RemoveDay has no backlog concept, so it never builds a command with no dayId', async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const fromNull = (await tools.RemoveDay!.execute!({ dayRef: null }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };
      const fromBacklog = (await tools.RemoveDay!.execute!({ dayRef: "backlog" }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(fromNull.queued).toBe(false);
      expect(fromNull.error).toContain("backlog is not a day");
      expect(fromBacklog.queued).toBe(false);
      expect(fromBacklog.error).toContain("backlog is not a day");
      expect(getCollected()).toEqual([]);
    });
  });

  describe("DismissConflict conflictRef", () => {
    it("DismissConflict schema exposes conflictRef, not conflictId", () => {
      const { tools } = buildPlanningTools(TRIP_ID, conflictedDetail());
      const shape = (asZodSchema(tools.DismissConflict!.inputSchema) as unknown as { shape: Record<string, unknown> })
        .shape;
      expect(shape).toHaveProperty("conflictRef");
      expect(shape).not.toHaveProperty("conflictId");
    });

    it("resolves a 1-based ref number to that conflict's real (compound) id", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, conflictedDetail());
      const result = await tools.DismissConflict!.execute!({ conflictRef: 1 }, EXEC_OPTS);

      expect(result).toEqual({ queued: true, type: "DismissConflict", tripId: TRIP_ID });
      expect(getCollected()).toEqual([{ type: "DismissConflict", tripId: TRIP_ID, conflictId: OVERLAP_ID }]);
    });

    it("resolves a numeric-string ref too, and picks the right conflict by position", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, conflictedDetail());
      await tools.DismissConflict!.execute!({ conflictRef: "2" }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "DismissConflict", tripId: TRIP_ID, conflictId: OVER_BUDGET_ID }]);
    });

    it("accepts an exact conflict id as a fallback", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, conflictedDetail());
      await tools.DismissConflict!.execute!({ conflictRef: OVERLAP_ID }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "DismissConflict", tripId: TRIP_ID, conflictId: OVERLAP_ID }]);
    });

    it("errors (and collects nothing) on an out-of-range ref", async () => {
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, conflictedDetail());
      const result = (await tools.DismissConflict!.execute!({ conflictRef: 3 }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(result.queued).toBe(false);
      expect(result.error).toContain("out of range");
      expect(getCollected()).toEqual([]);
    });

    it("errors (and collects nothing) when there are no active conflicts to dismiss", async () => {
      // The default fixture has an empty conflicts array.
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, detail());
      const result = (await tools.DismissConflict!.execute!({ conflictRef: 1 }, EXEC_OPTS)) as {
        queued: boolean;
        error?: string;
      };

      expect(result.queued).toBe(false);
      expect(result.error).toContain("no active conflicts");
      expect(getCollected()).toEqual([]);
    });

    it("excludes dismissed conflicts from ref numbering", async () => {
      // With the first conflict already dismissed, ref 1 must resolve to the
      // second (still-active) conflict, not the dismissed one.
      const base = conflictedDetail();
      const partlyDismissed = tripDetailFixture({
        conflicts: base.conflicts,
        dismissedConflictIds: [OVERLAP_ID],
      });
      const { tools, getCollected } = buildPlanningTools(TRIP_ID, partlyDismissed);
      await tools.DismissConflict!.execute!({ conflictRef: 1 }, EXEC_OPTS);

      expect(getCollected()).toEqual([{ type: "DismissConflict", tripId: TRIP_ID, conflictId: OVER_BUDGET_ID }]);
    });
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
