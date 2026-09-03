import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { MACRO_REGISTRY, getMacro, resolveMacro, MACRO_NAMES, macroCatalog } from "./registry";
import type { WidgetInput } from "./registry-types";

const detail = { tripId: "11111111-1111-1111-1111-111111111111", name: "T", startDate: null, currency: "USD", budget: null, status: "active", members: [{ userId: "u1", role: "owner" }], forkedFrom: null, days: [], backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null } as TripDetail;

describe("registry", () => {
  it("registers all seven starter macros keyed by name", () => {
    expect(MACRO_NAMES).toEqual(expect.arrayContaining(["trip.name","trip.dates","cost.trip","cost.day","itinerary.day","itinerary.trip","costs.table"]));
    for (const name of MACRO_NAMES) expect(getMacro(name)!.name).toBe(name);
  });
  it("resolveMacro dispatches to the right resolver", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "trip.name", {})).toEqual({ status: "ok", value: "T" });
  });
  it("resolveMacro reports unknown macros without throwing", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "nope.nope", {}).status).toBe("unknown");
  });
  it("resolveMacro reports bad params without throwing", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "trip.name", { junk: 1 }).status).toBe("ok"); // strip() ignores extras
  });
  it("macroCatalog exposes name/kind/description for the AI + autocomplete", () => {
    const cat = macroCatalog();
    expect(cat.find((m) => m.name === "cost.trip")).toMatchObject({ kind: "inline", description: expect.any(String) });
  });

  // ADR-035 decision 2. These two guard the seam itself rather than any one
  // widget, so a widget added later is covered the day it lands — which is the
  // whole point of declaring inputs instead of hardcoding a control per widget.

  // A plausible value per input type, so the assertion below can actually
  // exercise each macro's own validator rather than just reading its keys.
  const SAMPLE: Record<WidgetInput["type"], unknown> = {
    day: { kind: "index", index: 0 },
    days: { from: { kind: "index", index: 0 }, through: { kind: "index", index: 1 } },
    person: "u1",
    tags: ["Meal"],
    trip: "11111111-1111-1111-1111-111111111111",
  };

  it("every declared input names a key its own macro's params schema accepts", () => {
    const checked: string[] = [];
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      if (def.inputs.length === 0) continue;
      const bound = Object.fromEntries(def.inputs.map((i) => [i.name, SAMPLE[i.type]]));
      const parsed = def.params.safeParse(bound);
      // A declared input the validator drops is a binding the UI can set and
      // the resolver will never see — silent, and exactly the drift this seam
      // exists to prevent. `.strip()` makes that failure quiet, so assert the
      // key SURVIVES rather than merely that parsing succeeded.
      expect(parsed.success, `${name}: params rejected its own declared inputs`).toBe(true);
      for (const input of def.inputs) {
        expect(parsed.success && parsed.data as Record<string, unknown>).toHaveProperty(input.name);
      }
      checked.push(name);
    }
    // Non-vacuous: if every widget declared nothing, the loop above would pass
    // while asserting nothing at all.
    expect(checked).toEqual(["cost.day", "itinerary.day"]);
  });

  it("declares inputs for every macro, with [] meaning 'binds nothing'", () => {
    // `[]` is a real answer, not a placeholder (ADR-035 decision 2) — it is what
    // makes a widget insert immediately with nothing to bind. So the field must
    // be present on all seven, and absence must be impossible rather than
    // indistinguishable from "binds nothing".
    for (const name of MACRO_NAMES) {
      expect(Array.isArray(getMacro(name)!.inputs), `${name} declares no inputs array`).toBe(true);
    }
  });
});
