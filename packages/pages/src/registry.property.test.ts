// The macro registry's central promise (ADR-014 / the M7 design) is that every
// resolver is **pure and total**: given any TripDetail and any PageContext it
// returns one of three states — `ok`, `empty`, or `unbound` — and never throws
// and never returns null. That promise is what lets a page render a legible
// skeleton for a brand-new empty trip instead of exploding.
//
// It had no property test. `fast-check` was not a dependency of this package at
// all until 2026-07-28, so the only tooling that could check a promise of the
// form "for ALL inputs" was unavailable here.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { MACRO_REGISTRY } from "./registry";
import { witness } from "./test-support/witness";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Deliberately adversarial but schema-plausible trips: empty ones, days with no
// activities, activities with no day, mixed currencies (a real hazard for cost
// rollups), zero and 12-digit amounts.
const detailArb: fc.Arbitrary<TripDetail> = fc
  .record({
    nDays: fc.integer({ min: 0, max: 4 }),
    nActs: fc.integer({ min: 0, max: 5 }),
    startDate: fc.option(fc.constantFrom("2026-10-01", "2026-01-31", "2026-02-28", "2026-12-31"), { nil: null }),
    currency: fc.constantFrom("USD", "EUR", "JPY"),
    budget: fc.option(fc.constant({ amountMinor: 50_000, currency: "USD" }), { nil: null }),
    cost: fc.option(
      fc.constantFrom(
        { amountMinor: 0, currency: "USD" },
        { amountMinor: 999_999_999_999, currency: "EUR" },
        { amountMinor: 4500, currency: "JPY" },
      ),
      { nil: null },
    ),
  })
  .map(({ nDays, nActs, startDate, currency, budget, cost }) => {
    const activities: Record<string, unknown> = {};
    const ids: string[] = [];
    for (let i = 0; i < nActs; i++) {
      const id = uuid(200 + i);
      ids.push(id);
      activities[id] = {
        activityId: id,
        title: `Activity ${i}`,
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        cost,
      };
    }
    const days = Array.from({ length: nDays }, (_, i) => ({
      dayId: uuid(100 + i),
      activityIds: i === 0 ? ids : [],
      date: startDate,
      costSubtotal: 0,
    }));
    return {
      tripId: TRIP,
      name: "Property trip",
      startDate,
      currency,
      budget,
      members: [{ userId: "u1", role: "owner" }],
      days,
      backlog: nDays === 0 ? ids : [],
      activities,
      conflicts: [],
      dismissedConflictIds: [],
      createdAt: "2026-07-28T00:00:00.000Z",
      unscheduledCostSubtotal: 0,
      tripCostTotal: 0,
      budgetRemaining: null,
    } as unknown as TripDetail;
  });

// A page context is the trip and nothing else (SPEC §18): the only thing left
// to vary is nothing, so this stays a constant rather than pretending otherwise.
const contextArb = fc.constant({ tripId: TRIP });

// Params a model or a stale document could plausibly hand a macro — including
// the day binding itself, since that is where a day lives now. The refs
// deliberately include ones the trip cannot satisfy (a day removed under the
// widget, an index past the end), which is the `unbound` path. Anything the
// macro's own Zod schema rejects is skipped — that is the schema's job, not the
// resolver's.
const paramsArb = fc.oneof(
  fc.constant({}),
  fc.constant({ dayRef: { kind: "index", index: 0 } }),
  fc.constant({ dayRef: { kind: "index", index: 3 } }),
  fc.constant({ dayRef: { kind: "index", index: 99 } }),
  fc.constant({ dayRef: { kind: "dayId", dayId: uuid(100) } }),
  fc.constant({ dayRef: { kind: "dayId", dayId: uuid(777) } }),
  fc.constant({ dayId: uuid(100) }),
  fc.constant({ dayId: uuid(777) }),
  fc.constant({ dayNumber: 1 }),
  fc.constant({ dayNumber: 0 }),
  fc.constant({ dayNumber: -1 }),
  fc.constant({ dayNumber: 99 }),
  fc.constant(null),
  fc.constant(undefined),
);

describe("macro registry — every resolver is pure and total", () => {
  const names = Object.keys(MACRO_REGISTRY);

  it(`covers all ${names.length} registered macros`, () => {
    expect(names.length).toBeGreaterThan(0);
  });

  for (const [name, def] of Object.entries(MACRO_REGISTRY)) {
    it(`${name}: never throws, always ok|empty|unbound`, () => {
      const w = witness(`macro ${name}`);
      fc.assert(
        fc.property(detailArb, contextArb, paramsArb, (detail, ctx, raw) => {
          const parsed = def.params.safeParse(raw);
          if (!parsed.success) return; // the schema rejected it — not the resolver's problem
          let result: { status?: string };
          try {
            result = def.resolve(detail, ctx as never, parsed.data as never) as never;
          } catch (error) {
            throw new Error(
              `resolver threw on params=${JSON.stringify(raw)} ctx=${JSON.stringify(ctx)}: ${(error as Error).message}`,
            );
          }
          w.tick();
          expect(result, "resolver returned null/undefined instead of a result").toBeTruthy();
          expect(["ok", "empty", "unbound"], `unexpected status in ${JSON.stringify(result)}`).toContain(result.status);
        }),
        { numRuns: 200 },
      );
      // Floors measured 2026-07-28; every macro accepts at least the `{}` params
      // case, so all of them clear 50 comfortably.
      w.atLeast(50);
    });
  }
});

describe("macro registry — resolvers are deterministic", () => {
  it("the same inputs always produce the same result", () => {
    const w = witness("resolver determinism");
    fc.assert(
      fc.property(detailArb, contextArb, paramsArb, (detail, ctx, raw) => {
        for (const def of Object.values(MACRO_REGISTRY)) {
          const parsed = def.params.safeParse(raw);
          if (!parsed.success) continue;
          const first = def.resolve(detail, ctx as never, parsed.data as never);
          const second = def.resolve(detail, ctx as never, parsed.data as never);
          w.tick();
          expect(first).toEqual(second);
        }
      }),
      { numRuns: 200 },
    );
    w.atLeast(200);
  });
});
