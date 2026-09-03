import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { MACRO_REGISTRY, getMacro, resolveMacro, renderMacro, MACRO_NAMES, macroCatalog } from "./registry";
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
      if (!parsed.success) throw new Error(`${name}: params rejected its own declared inputs`);
      for (const input of def.inputs) {
        expect(parsed.data as Record<string, unknown>).toHaveProperty(input.name);
      }
      checked.push(name);
    }
    // Non-vacuous: if every widget declared nothing, the loop above would pass
    // while asserting nothing at all. Containment, NOT equality — a new widget
    // that declares inputs must make this test cover more, never make it fail
    // (Copilot, PR 130). Exact equality would have contradicted the comment at
    // the top of this test the first time link 4 added a widget.
    expect(checked).toEqual(expect.arrayContaining(["cost.day", "itinerary.day"]));
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

// ADR-037 decision 2, and the control it names by hand: **"a registry-wide test
// asserts every widget has a renderer, so 'forgot to wire it up' is a red test
// rather than a `no renderer:` chip discovered by a user."**
//
// That chip was real: `MacroView`'s `switch (name)` had a `default:` branch
// rendering `no renderer: <name>` to whoever opened the page. These tests are
// what replaces it, and they are registry-wide on purpose — a widget added
// tomorrow is covered the day it lands, without anyone remembering to add a case
// here either.
describe("every widget renders (ADR-037 decision 2)", () => {
  // A trip with enough in it that the block widgets resolve to `ok` rather than
  // `empty` — an `empty` outcome never reaches `render`, so a registry sweep
  // over a bare trip would pass while proving nothing about the renderers.
  const populated: TripDetail = {
    ...detail,
    startDate: "2026-08-01",
    days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 5000 }],
    activities: {
      a1: {
        activityId: "a1", tripId: detail.tripId, title: "Museum", dayId: "d0", position: 0,
        timeWindow: null, location: null, cost: { amountMinor: 5000, currency: "USD" },
        notes: null, kind: null, tags: [],
      },
    } as unknown as TripDetail["activities"],
    tripCostTotal: 5000,
  };

  // A loaded account. The sweep below needs one: `account.name` and
  // `account.homeAirport` resolve to `empty()` without it, so they would never
  // reach `render` and the witness floor would fail — which is the floor doing
  // exactly its job rather than a reason to lower it.
  const user = { displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" as const };

  it("declares a render function for every registered widget", () => {
    for (const name of MACRO_NAMES) {
      expect(typeof getMacro(name)!.render, `${name} has no render`).toBe("function");
    }
  });

  it("produces a Rendered of a known kind for every widget that resolves", () => {
    const seen: string[] = [];
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      // Bind anything that takes a day to the one day above, so block widgets
      // reach `ok` instead of `unbound`.
      const params = def.inputs.some((i) => i.type === "day") ? { dayRef: { kind: "index", index: 0 } } : {};
      const outcome = renderMacro({ trip: populated, page: { tripId: populated.tripId }, user }, name, params);
      if (outcome.status !== "ok") continue;
      seen.push(name);
      expect(["inline", "block", "rows"], `${name} rendered an unknown kind`).toContain(outcome.rendered.kind);
    }
    // The witness. Without this the loop above passes when every widget
    // resolves to `empty` and nothing is rendered at all — the insensitive-test
    // failure this repo has already had twice (CLAUDE.md rule 3).
    expect(seen.length, `only ${seen.length} widget(s) reached render`).toBeGreaterThanOrEqual(MACRO_NAMES.length);
  });

  it("emits only text and chip segments — a widget has nowhere to put markup", () => {
    // ADR-037 decision 3a. Not a policy the renderers are asked to follow: the
    // `Seg` union has no member that can carry an element, an attribute or a
    // URL, and this asserts the widgets stay inside it.
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      const params = def.inputs.some((i) => i.type === "day") ? { dayRef: { kind: "index", index: 0 } } : {};
      const outcome = renderMacro({ trip: populated, page: { tripId: populated.tripId }, user }, name, params);
      if (outcome.status !== "ok" || outcome.rendered.kind === "block") continue;
      const segs = outcome.rendered.kind === "inline" ? outcome.rendered.segs : outcome.rendered.rows.flat();
      for (const seg of segs) expect(["text", "chip"]).toContain(seg.kind);
    }
  });

  it("gives every block payload a `kind`, which is what BlockView dispatches on", () => {
    // The other half of deleting the name switch: `apps/web` picks a component
    // by payload shape, so a payload with no discriminator is a block nothing
    // can render.
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      const params = def.inputs.some((i) => i.type === "day") ? { dayRef: { kind: "index", index: 0 } } : {};
      const outcome = renderMacro({ trip: populated, page: { tripId: populated.tripId }, user }, name, params);
      if (outcome.status !== "ok" || outcome.rendered.kind !== "block") continue;
      expect(typeof outcome.rendered.block.kind, `${name}'s block payload has no kind`).toBe("string");
    }
  });
});
