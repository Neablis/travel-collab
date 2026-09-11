// The id-field transform, asserted on the DEFINITIONS.
//
// These four claims were `planningTools.test.ts`'s, made against
// `buildPlanningTools()` — a builder whose only remaining caller was that test
// (P3 deleted it, F-F02 one level down). Made against `PLANNING_TOOLS` they are
// claims about what a turn actually holds: `toolsFor(grant)` filters these same
// constants, so a schema that is right here cannot be wrong at the door.
//
// The rule they guard is ADR-015 Invariant 5 as it reaches a model: **the AI
// never handles a UUID.** `type` is dropped (implied by the tool name),
// `inject` fields (tripId) are dropped, `mint` fields (new ids) are dropped,
// and `ref` fields — an EXISTING day, activity or conflict — are swapped for a
// human `<entity>Ref` that `resolveBatch` resolves server-side. A schema that
// leaked one of those back would let a model write an id, which is the whole
// thing the manifest exists to prevent.
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { witness } from "@/test-support/witness";
import { newProposalBuffer } from "../deps";
import { aiToolsFor } from "../registry";
import { PLANNING_TOOLS } from "./planning";

function byName(name: string) {
  const definition = PLANNING_TOOLS.find((tool) => tool.name === name);
  if (!definition) throw new Error(`${name} is missing from PLANNING_TOOLS`);
  return definition;
}

function shapeOf(name: string): Record<string, unknown> {
  return (byName(name).input as unknown as { shape: Record<string, unknown> }).shape;
}

// `registry.test.ts` already owns "one tool per BatchableCommand member" —
// asserting it here too would be the second statement of one fact, which is
// what F-F02 is about.
describe("the planning tools", () => {
  it("drops mint + inject id fields and swaps ref fields for <entity>Ref", () => {
    // AddActivity: activityId (mint) + dayId (ref) gone; dayRef present; no tripId/type.
    const add = shapeOf("AddActivity");
    expect(add).not.toHaveProperty("activityId");
    expect(add).not.toHaveProperty("dayId");
    expect(add).not.toHaveProperty("tripId");
    expect(add).toHaveProperty("dayRef");
    expect(add).toHaveProperty("title");
    // AddDay: dayId (mint) gone — nothing id-bearing left.
    expect(shapeOf("AddDay")).not.toHaveProperty("dayId");
    // MoveActivity: activityRef + dayRef, not activityId/toDayId.
    const move = shapeOf("MoveActivity");
    expect(move).toHaveProperty("activityRef");
    expect(move).toHaveProperty("dayRef");
    expect(move).toHaveProperty("position");
    expect(move).not.toHaveProperty("activityId");
    expect(move).not.toHaveProperty("toDayId");
    // RemoveDay -> dayRef; DismissConflict -> conflictRef; RemoveActivity -> activityRef.
    expect(shapeOf("RemoveDay")).toHaveProperty("dayRef");
    expect(shapeOf("DismissConflict")).toHaveProperty("conflictRef");
    expect(shapeOf("RemoveActivity")).toHaveProperty("activityRef");
  });

  // The cases above name the six commands that HAVE id fields, and naming them
  // is what makes them readable. It is also their limit: a thirteenth
  // `BatchableCommand` becomes a thirteenth planning tool with no edit in
  // `planning.ts` and none here, so an id field it exposed would sit outside
  // every assertion above with this file still green. The rule itself —
  // **the AI never handles a UUID** — is a claim about the whole set, so it is
  // asserted over the whole set.
  it("exposes no id-shaped field on any planning tool, including one added later", () => {
    const checked = witness("planning tool shapes");

    for (const tool of PLANNING_TOOLS) {
      const keys = Object.keys((tool.input as unknown as { shape: Record<string, unknown> }).shape);
      // `/Id$/` rather than the four field names spelled out: `MoveActivity`'s
      // ref field is `toDayId`, which a `(tripId|dayId|activityId|conflictId)`
      // list misses, and the rule is about the SHAPE of an id rather than about
      // today's vocabulary.
      expect(keys.filter((key) => /Id$/.test(key)), `${tool.name} must expose no id field`).toEqual([]);
      checked.tick();
    }

    // A loop over an empty (or mis-imported) registry asserts nothing and
    // passes — the vacuity this whole test is here to replace. The exact count
    // is `registry.test.ts`'s claim, not a second statement of it here.
    checked.atLeast(1);
  });

  // Built the way a turn builds it — `aiToolsFor` over the definitions, which
  // is what `buildPlanningTools()` was a second spelling of.
  it("records the model's raw intent (type + args), resolving nothing", async () => {
    const proposalBuffer = newProposalBuffer();
    const tools = aiToolsFor(PLANNING_TOOLS, { proposalBuffer });
    await tools.MoveActivity!.execute!({ activityRef: "Colosseum tour", dayRef: "day 2", position: 0 }, {
      toolCallId: "c1",
      messages: [],
      context: undefined,
    } as never);
    expect(proposalBuffer.collected()).toEqual([
      { type: "MoveActivity", args: { activityRef: "Colosseum tour", dayRef: "day 2", position: 0 } },
    ]);
  });

  it("AddActivity accepts a validated payload with no ids", () => {
    const parsed = (byName("AddActivity").input as unknown as ZodTypeAny).safeParse({
      title: "Lunch",
      dayRef: "day 1",
    });
    expect(parsed.success).toBe(true);
  });
});
