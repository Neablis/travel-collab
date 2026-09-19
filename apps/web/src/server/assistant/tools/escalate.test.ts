// The escalation tool — Mitchell's complaint, answered.
//
// > *"i really dislike how the AI right now will ask me to reframe a ask in
// > order for it to do the work. It should do what it needs to do."*
//
// What is tested here is the tool itself: the latch, what it tells the model,
// and the tags that decide where it is offered. **Where it is offered is
// `grants.test.ts`'s**, and it is asserted there as a PROPERTY over every
// combination of caps rather than as three scenarios — because "escalation
// never widens access" has to hold for cases nobody enumerated.
import { describe, expect, it } from "vitest";
import { newEscalationBuffer } from "@/server/assistant/deps";
import { ESCALATE_TOOL_NAME, escalateTool } from "./escalate";

const REQUEST = { reason: "they asked me to add a stop", intendedChange: "add a coffee stop to day 2" };

describe("the escalation tool", () => {
  // The tags ARE the safety argument. `postures: ["withheld"]` is what makes
  // "it cannot widen access" structural: `withheld` is by definition the case
  // where role and plan both already permit `propose`, so the escalated set can
  // never exceed what the actor may do.
  it("is offered in exactly one posture, and says so on its own definition", async () => {
    expect(escalateTool.postures).toEqual(["withheld"]);
    expect(escalateTool.domain).toBe("system");
    // It proposes nothing and collects nothing about the trip — what it changes
    // is which tools the next step holds.
    expect(escalateTool.effect).toBe("read");
    expect(escalateTool.spend).toBe("none");
    // The belt to `postures`' braces: `minimumRoleFor` is computed over the set
    // actually selected, and a tool that unlocks write tools should raise that
    // answer on its own account.
    expect(escalateTool.minimumRole).toBe("editor");
  });

  it("grants on the first call and records what the model meant", async () => {
    const escalation = newEscalationBuffer();
    const result = await escalateTool.run(REQUEST, { escalation });
    expect(result.granted).toBe(true);
    expect(escalation.escalated()).toEqual(REQUEST);
  });

  // **Once per turn, tracked on the collector rather than in the model's
  // head.** A latch in the prompt is a request; a latch here is a fact — and
  // what is being bounded is a charged step and a tier upgrade.
  it("refuses a second escalation in the same turn, and keeps the first", async () => {
    const escalation = newEscalationBuffer();
    await escalateTool.run(REQUEST, { escalation });
    const again = await escalateTool.run({ reason: "second thoughts", intendedChange: "something else" }, { escalation });

    expect(again.granted).toBe(false);
    expect(escalation.escalated()).toEqual(REQUEST);
  });

  // A refusal that only said "no" would invite a third attempt. The note has to
  // say the thing it wanted has already happened.
  it("tells a second caller the tools are already there rather than just refusing", async () => {
    const escalation = newEscalationBuffer();
    await escalateTool.run(REQUEST, { escalation });
    const again = await escalateTool.run(REQUEST, { escalation });
    expect(again.note).toMatch(/already/i);
    expect(again.note).toMatch(/use them now/i);
  });

  // The whole point of the tool, in the one sentence the model reads after
  // calling it. "Ask the user to rephrase" is the behaviour being replaced, so
  // the grant note has to close that door explicitly.
  it("tells the model to act rather than to ask again", async () => {
    const { note } = await escalateTool.run(REQUEST, { escalation: newEscalationBuffer() });
    expect(note).toMatch(/do not ask the user to rephrase/i);
    // ...and not to ask permission either: the proposal is already a review
    // step, so a model that asks first turns one turn into three.
    expect(note).toMatch(/do not ask permission/i);
  });

  it("gives back a copy, so a reader cannot edit the turn's own record", async () => {
    const escalation = newEscalationBuffer();
    await escalateTool.run(REQUEST, { escalation });
    const first = escalation.escalated()!;
    first.intendedChange = "tampered";
    expect(escalation.escalated()!.intendedChange).toBe(REQUEST.intendedChange);
  });

  it("is null before anything escalates", async () => {
    expect(newEscalationBuffer().escalated()).toBeNull();
  });

  // Both fields are required and bounded. `intendedChange` in particular is the
  // half that outlives the turn: an escalation is a labelled classifier miss,
  // and a miss with no statement of what was intended is not a label.
  it("requires both halves of the label", async () => {
    expect(escalateTool.input.safeParse({ reason: "x", intendedChange: "y" }).success).toBe(true);
    expect(escalateTool.input.safeParse({ reason: "x" }).success).toBe(false);
    expect(escalateTool.input.safeParse({ reason: "", intendedChange: "y" }).success).toBe(false);
    expect(escalateTool.input.safeParse({ reason: "x", intendedChange: "y".repeat(301) }).success).toBe(false);
  });

  it("is named the same thing the withheld instruction tells the model to call", async () => {
    expect(escalateTool.name).toBe(ESCALATE_TOOL_NAME);
  });
});
