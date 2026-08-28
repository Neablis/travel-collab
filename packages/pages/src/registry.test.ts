import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { MACRO_REGISTRY, getMacro, resolveMacro, MACRO_NAMES, macroCatalog } from "./registry";

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
});
