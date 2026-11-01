// `switch_persona`: the server's side of an edge in the persona graph (M57
// part 4). The model can only name a persona; whether the turn crosses is the
// latch's answer, from the graph and the caps the turn was admitted with. What
// is tested here is that answer, and where the tool is offered. The step that
// records the crossing is `route.int.test.ts`'s ("switch_persona").
import { describe, expect, it } from "vitest";
import { grantFor, postureFor, toolsFor } from "../grants";
import { newIntentLatch, type PersonaStart } from "../intents";
import { MAX_PERSONA_SWITCHES, type PersonaId, type TurnCaps } from "../personas";
import { SWITCH_PERSONA_TOOL_NAME, switchPersonaTool } from "./switchPersona";

const OPEN: TurnCaps = { role: "propose", plan: "propose", classifier: "propose" };

function latchAt(entry: PersonaId, caps: TurnCaps, steps: () => number = () => 0) {
  const start: PersonaStart = { entry, caps };
  return newIntentLatch("question", ["question"], steps, start);
}

const call = (intent: ReturnType<typeof latchAt>, to: PersonaId) =>
  switchPersonaTool.run({ to, why: "they want a restaurant looked up" }, { intent });

describe("the switch_persona tool", () => {
  it("crosses an edge the turn's caps allow, and records where from, where to, why and when", async () => {
    let steps = 0;
    const intent = latchAt("schedule", OPEN, () => steps);
    steps = 2;
    const result = await call(intent, "discover");

    expect(result).toMatchObject({ switched: true });
    expect(intent.persona()).toBe("discover");
    expect(intent.switches()).toEqual([{ from: "schedule", to: "discover", why: "they want a restaurant looked up", step: 2 }]);
  });

  // The guard is re-checked on the server whatever the schema allowed. A turn
  // whose caps fail it is refused and stays where it was: the model is told, and
  // nothing about what the next step holds changes.
  it("refuses an edge whose guard the turn's caps fail, and stays put", async () => {
    for (const caps of [{ ...OPEN, role: "read" }, { ...OPEN, plan: "read" }] as const) {
      const intent = latchAt("schedule", caps);
      const result = await call(intent, "discover");

      expect(result).toMatchObject({ switched: false, refused: expect.stringMatching(/permissions/) });
      expect(intent.persona()).toBe("schedule");
      expect(intent.switches()).toEqual([]);
    }
  });

  it("refuses a persona no switch edge leaves the current one for, and says what is open", async () => {
    const intent = latchAt("page-writer", OPEN);
    const result = await call(intent, "discover");

    expect(result).toMatchObject({ switched: false, refused: expect.stringMatching(/not open from page-writer/) });
    expect(intent.persona()).toBe("page-writer");
  });

  it("makes at most one switch a turn, and keeps the first", async () => {
    expect(MAX_PERSONA_SWITCHES).toBe(1);
    const intent = latchAt("schedule", OPEN);
    await call(intent, "discover");
    const again = await call(intent, "schedule");

    expect(again).toMatchObject({ switched: false, refused: expect.stringMatching(/already switched/) });
    expect(intent.persona()).toBe("discover");
    expect(intent.switches()).toHaveLength(1);
  });

  // ADR-085 decision 4: the enum is the outgoing edges of the persona holding the
  // tool. Schedule is the one that does, so it is never offered itself, and a
  // refusal of it would cost a charged step.
  it("names only personas a switch_persona edge leads to from the persona that holds it", () => {
    expect(switchPersonaTool.input.safeParse({ to: "discover", why: "x" }).success).toBe(true);
    expect(switchPersonaTool.input.safeParse({ to: "schedule", why: "x" }).success).toBe(false);
    expect(switchPersonaTool.input.safeParse({ to: "account", why: "x" }).success).toBe(false);
  });
});

describe("where switch_persona is offered", () => {
  const offeredOn = (surface: "trip" | "page" | "account", caps: Omit<TurnCaps, never>) => {
    const full = { surface, ...caps } as const;
    return toolsFor(grantFor(full), undefined, postureFor(full)).some((tool) => tool.name === SWITCH_PERSONA_TOOL_NAME);
  };

  it("is offered to an editor on a trip, whether the classifier read a question or an edit", () => {
    expect(offeredOn("trip", OPEN)).toBe(true);
    expect(offeredOn("trip", { ...OPEN, classifier: "read" })).toBe(true);
  });

  // Invariant 7: a person who can only read has no button that moves a turn
  // onto another persona's tools, so neither does the assistant.
  it("is never offered to a read-only turn, nor on a page that has no edge to switch along", () => {
    expect(offeredOn("trip", { ...OPEN, role: "read" })).toBe(false);
    expect(offeredOn("trip", { ...OPEN, plan: "read" })).toBe(false);
    expect(offeredOn("page", OPEN)).toBe(false);
    expect(offeredOn("account", { ...OPEN, role: "read" })).toBe(false);
  });
});
