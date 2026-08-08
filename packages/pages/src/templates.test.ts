import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, instantiateDefaults } from "./templates";
import { CreatePageInput } from "@tc/contracts";

describe("templates", () => {
  it("ships exactly Trip Overview + Day Sheet", () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.key)).toEqual(["trip-overview", "day-sheet"]);
  });
  it("instantiateDefaults produces valid CreatePageInputs bound to the trip", () => {
    const tripId = crypto.randomUUID();
    const inputs = instantiateDefaults(tripId);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(CreatePageInput.safeParse(input).success).toBe(true);
    expect(inputs[0]!.context.tripId).toBe(tripId);
    expect(inputs[1]!.context.dayRef).toEqual({ kind: "index", index: 0 }); // Day Sheet binds day 0
  });
  // Task B3: macro authoring left the primary editing surface in M8, so the
  // seeded templates no longer plant macro nodes a reader can't add, edit, or
  // remove themselves. Macro *rendering* is unaffected (see MacroNodeExtension,
  // registry.test.ts, macros/*.test.ts) — this only asserts the seed content
  // itself is plain now.
  it("templates contain no macro nodes", () => {
    const nodes: unknown[] = [];
    const walk = (n: any) => { if (n?.type === "macro") nodes.push(n); (n?.content ?? []).forEach(walk); };
    DEFAULT_TEMPLATES.forEach((t) => walk(t.content));
    expect(nodes).toHaveLength(0);
  });
});
