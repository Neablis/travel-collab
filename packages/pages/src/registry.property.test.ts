// The macro registry's central promise (ADR-014 / the M7 design) is that every
// resolver is **pure and total**: given any TripDetail and any PageContext it
// returns one of four states — `ok`, `empty`, `unbound`, or (for a widget that
// reads outside data, ADR-052) `unavailable` — and never throws
// and never returns null. That promise is what lets a page render a legible
// skeleton for a brand-new empty trip instead of exploding.
//
// It had no property test. `fast-check` was not a dependency of this package at
// all until 2026-07-28, so the only tooling that could check a promise of the
// form "for ALL inputs" was unavailable here.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { ActivityKind, ActivityTag, FILTER_VALUE_SCHEMAS, FilterDimension, type TripDetail, type TripWeatherPoint } from "@tc/contracts";
import type { ExternalInputs } from "./external";
import { MACRO_REGISTRY, primitiveCatalog } from "./registry";
import { LINK_VIEWS } from "./linkTarget";
import type { AnyMacroDef } from "./registry-types";
import { weatherProbe } from "./test-support/weatherProbe";
import { witness } from "./test-support/witness";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Every date a generated trip's days can carry; the weather slot below has a
// point on each, so a dated trip always has weather to find.
const DETAIL_DATES = ["2026-10-01", "2026-01-31", "2026-02-28", "2026-12-31"] as const;

// Deliberately adversarial but schema-plausible trips: empty ones, days with no
// activities, activities with no day, mixed currencies (a real hazard for cost
// rollups), zero and 12-digit amounts.
const detailArb: fc.Arbitrary<TripDetail> = fc
  .record({
    nDays: fc.integer({ min: 0, max: 4 }),
    nActs: fc.integer({ min: 0, max: 5 }),
    startDate: fc.option(fc.constantFrom(...DETAIL_DATES), { nil: null }),
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
    // `ActivityView` defaults both on parse, so every real `TripDetail` has
    // them. Absent here, they went unnoticed only while no case bound a tag or
    // a kind (KI-2026-09-05-i item 3).
    kind: fc.constantFrom(...ActivityKind.options),
    tags: fc.subarray([...ActivityTag.options]),
  })
  .map(({ nDays, nActs, startDate, currency, budget, cost, kind, tags }) => {
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
        kind,
        tags,
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

// Params a model or a stale document could plausibly hand a macro, generated
// in the CURRENT vocabulary: one arbitrary per filter dimension, keyed by
// `FilterDimension` so a new dimension fails to compile here until it has one.
//
// It spoke the retired v1 vocabulary (`dayRef`, `dayId`, `dayNumber`) until
// KI-2026-09-05-i item 3: every schema is `filterParams(...).strip()`, so every
// case parsed to `{}` and the `unbound` path the comment claimed was never
// reached — and the witness could not see it, because the assertion count was
// unchanged. The day refs below deliberately include ones the trip cannot
// satisfy (an index past the end, a day id that was removed), and the test now
// asserts that `unbound` is OBSERVED rather than merely allowed.
const FILTER_VALUES: { [D in FilterDimension]: fc.Arbitrary<z.input<(typeof FILTER_VALUE_SCHEMAS)[D]>> } = {
  day: fc.oneof(
    fc.record({ kind: fc.constant("index" as const), index: fc.integer({ min: 0, max: 6 }) }),
    fc.record({ kind: fc.constant("dayId" as const), dayId: fc.constantFrom(uuid(100), uuid(101), uuid(777)) }),
  ),
  city: fc.constantFrom("Tokyo", "Nowhere"),
  tag: fc.constantFrom(...ActivityTag.options),
  kind: fc.constantFrom(...ActivityKind.options),
  person: fc.constantFrom("u1", "me"),
  dates: fc.constantFrom(
    { from: "2026-10-01", through: "2026-10-01" },
    { from: "2026-01-01", through: "2026-12-31" },
    { from: "2027-01-01", through: "2027-01-02" },
  ),
};

// The non-filter params (`count`'s `of`, `attribute`'s `field`, …), read off
// the same catalogue the assistant composes from, so a new one is generated
// the day it exists.
//
// Pooled per key across widgets: `attribute` and `field` both call theirs
// `field`, and letting the last one win handed `attribute` only stop paths,
// which its enum refuses — so it ran 21 cases and the witness said so.
// A `multiple` field input (`stop.rows`' `columns`) stores a LIST of those
// values, so it gets ordered subsets of them rather than one.
const NON_FILTER_POOL: Record<string, Set<string>> = {};
const LIST_PARAMS = new Set<string>();
for (const entry of primitiveCatalog()) {
  for (const input of entry.inputs) if (input.type === "field" && input.multiple) LIST_PARAMS.add(input.name);
  for (const [key, values] of Object.entries(entry.params)) {
    for (const value of values ?? []) (NON_FILTER_POOL[key] ??= new Set()).add(value);
  }
}
const NON_FILTER_VALUES: Record<string, fc.Arbitrary<string | string[]>> = Object.fromEntries(
  Object.entries(NON_FILTER_POOL).map(([key, values]) => [
    key,
    LIST_PARAMS.has(key) ? fc.subarray([...values]) : fc.constantFrom(...values),
  ]),
);

// The link widgets' params (M30, ADR-056). Not in `primitiveCatalog()` — the
// assistant may not compose a link — so the pool above never sees them, and
// without these every link case would parse to `{}` and answer `unbound`.
// Deliberately includes addresses the schema must refuse, and a day and a
// notebook the trip and the list do not have.
const LINK_VALUES = {
  to: fc.oneof(
    fc.record({ kind: fc.constant("notebook" as const), pageId: fc.constantFrom(uuid(900), uuid(901)) }),
    fc.record({ kind: fc.constant("view" as const), view: fc.constantFrom(...LINK_VIEWS) }),
    fc.record({ kind: fc.constant("day" as const), day: FILTER_VALUES.day }),
  ),
  href: fc.constantFrom("https://example.com/tickets", "http://x.test", "javascript:alert(1)", "not a url"),
  label: fc.constantFrom("", "Tickets", "  "),
};

const paramsArb = fc.oneof(
  { weight: 8, arbitrary: fc.record({ ...FILTER_VALUES, ...NON_FILTER_VALUES, ...LINK_VALUES }, { requiredKeys: [] }) },
  { weight: 1, arbitrary: fc.constantFrom(null, undefined) },
);

// Every state an outside input can be in when a widget resolves (ADR-052
// decision 4, and ADR-037 decision 6b: every state renders). Absent is its own
// case: every context built before the slot existed has no `external` at all.
//
// The last member has a point on every one of `detailArb`'s dates, each source
// up or down, so "Weather" can reach `ok` at all — with only `points: []` it
// could answer nothing but `empty` and `unavailable`, and the `ok` half of the
// check below would be unreachable.
const externalArb: fc.Arbitrary<ExternalInputs | undefined> = fc.oneof(
  fc.constantFrom<ExternalInputs | undefined>(
    undefined,
    { weather: { state: "pending" } },
    { weather: { state: "failed" } },
    { weather: { state: "ready", value: { points: [] } } },
    // The notebook list (ADR-056): failed, and ready with one of the two ids
    // `LINK_VALUES` names — so one link finds its notebook and the other's is gone.
    { weather: { state: "pending" }, notebooks: { state: "failed" } },
    {
      weather: { state: "pending" },
      notebooks: { state: "ready", value: { pages: [{ id: uuid(900), title: "Money", firstLine: null, widgetCount: 2 }], openable: false } },
    },
  ),
  fc
    .record({
      forecast: fc.constantFrom<TripWeatherPoint["forecast"]>(
        { unavailable: "source" },
        { unavailable: "not-in-horizon" },
        { source: "met-norway", asOf: "2026-09-30T06:00:00Z", highC: 21, lowC: 12, precipitationMm: 0.4, symbol: "fair_day", hours: [] },
      ),
      typical: fc.constantFrom<TripWeatherPoint["typical"]>(
        { unavailable: "source" },
        { source: "nasa-power", month: 10, highC: 22, lowC: 14, precipitationMmPerDay: 5.1, period: { fromYear: 2001, throughYear: 2020 } },
      ),
    })
    .map(({ forecast, typical }): ExternalInputs => ({
      weather: {
        state: "ready",
        value: { points: DETAIL_DATES.map((date) => ({ date, city: "Tokyo", forecast, typical })) },
      },
    })),
);

// One dated day with nothing on it, and weather for that date from both sources.
const DATED_TRIP = {
  tripId: TRIP, name: "Dated", startDate: "2026-10-01", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: uuid(100), activityIds: [], date: "2026-10-01", costSubtotal: 0 }],
  backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-28T00:00:00.000Z",
  unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
} as unknown as TripDetail;
const READY_WEATHER: ExternalInputs = {
  notebooks: { state: "ready", value: { pages: [{ id: uuid(900), title: "Money", firstLine: "What it costs.", widgetCount: 1 }], openable: true } },
  weather: {
    state: "ready",
    value: {
      points: [{
        date: "2026-10-01", city: "Tokyo", forecast: { unavailable: "not-in-horizon" },
        typical: { source: "nasa-power", month: 10, highC: 22, lowC: 14, precipitationMmPerDay: 5.1, period: { fromYear: 2001, throughYear: 2020 } },
      }],
    },
  },
};

// The reader's date: unknown, or either side of `detailArb`'s 2026-10-01, or on it.
const todayArb = fc.constantFrom(null, "2026-09-28", "2026-10-01", "2026-10-05");

// The registered widgets, and a probe that reads an outside input. The probe
// came first (T23), when no registered widget declared a need and the sweep
// could not otherwise produce `unavailable`. `day.weather` now does; the probe
// stays as the one reader of the slot with no mode logic in front of it.
const SWEPT: [string, AnyMacroDef][] = [
  ...Object.entries(MACRO_REGISTRY),
  [weatherProbe.name, weatherProbe as unknown as AnyMacroDef],
];

describe("macro registry — every resolver is pure and total", () => {
  const names = Object.keys(MACRO_REGISTRY);

  it(`covers all ${names.length} registered macros`, () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("generates only values the filter schemas accept", () => {
    // Otherwise a drifted generator is skipped by the schema check below and
    // the input space shrinks with nothing failing — witness failure mode 2.
    const w = witness("filter values parse");
    for (const dimension of FilterDimension.options) {
      fc.assert(
        fc.property(FILTER_VALUES[dimension], (value) => {
          w.tick();
          expect(FILTER_VALUE_SCHEMAS[dimension].safeParse(value).success, `${dimension}: ${JSON.stringify(value)}`).toBe(true);
        }),
        { numRuns: 50 },
      );
    }
    w.atLeast(FilterDimension.options.length * 50);
  });

  for (const [name, def] of SWEPT) {
    it(`${name}: never throws, always ok|empty|unbound|unavailable, and ok renders`, () => {
      const w = witness(`macro ${name}`);
      const seen = new Set<string>();
      fc.assert(
        fc.property(detailArb, contextArb, paramsArb, externalArb, todayArb, (detail, ctx, raw, external, today) => {
          const parsed = def.params.safeParse(raw);
          if (!parsed.success) return; // the schema rejected it — not the resolver's problem
          let result: { status?: string; value?: unknown };
          try {
            result = def.resolve({ trip: detail, page: ctx as never, user: null, globals: null, today, external }, parsed.data as never) as never;
          } catch (error) {
            throw new Error(
              `resolver threw on params=${JSON.stringify(raw)} ctx=${JSON.stringify(ctx)}: ${(error as Error).message}`,
            );
          }
          w.tick();
          expect(result, "resolver returned null/undefined instead of a result").toBeTruthy();
          expect(["ok", "empty", "unbound", "unavailable"], `unexpected status in ${JSON.stringify(result)}`).toContain(result.status);
          if (result.status === "ok") expect(def.render(result.value as never)).toBeTruthy();
          seen.add(result.status!);
        }),
        // A widget that reads an outside input gets one case it can answer
        // `ok` to: generated, that needs a dated trip AND a ready slot AND a
        // known reader's date AND params that narrow to a dated day, and was
        // measured at 1–4 of ~180 cases a run (2026-09-24) — a check that
        // flaps. The example makes `ok` certain; the random cases still sweep.
        {
          numRuns: 200,
          // `to` is stripped by every widget but the internal link, which it
          // points at the notebook `READY_WEATHER`'s list carries.
          examples: def.needs?.length
            ? [[DATED_TRIP, { tripId: TRIP }, { to: { kind: "notebook", pageId: uuid(900) } }, READY_WEATHER, "2026-10-05"]]
            : [],
        },
      );
      // Floors measured 2026-07-28; every macro accepts at least the `{}` params
      // case, so all of them clear 50 comfortably. The weather probe measured
      // 163–175 over six runs on 2026-09-24.
      w.atLeast(50);
      // The widening is only a claim if the sweep reaches the new state.
      if (def.needs?.length) expect([...seen]).toEqual(expect.arrayContaining(["ok", "unavailable"]));
      // The path the old generator never reached. A widget that takes a day is
      // handed removed and out-of-range day refs, and must have answered
      // `unbound` for at least one of them.
      if (def.selection?.filters.includes("day")) {
        expect(seen, `${name} never reported unbound across 200 runs`).toContain("unbound");
      }
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
          const first = def.resolve({ trip: detail, page: ctx as never, user: null, globals: null, today: null }, parsed.data as never);
          const second = def.resolve({ trip: detail, page: ctx as never, user: null, globals: null, today: null }, parsed.data as never);
          w.tick();
          expect(first).toEqual(second);
        }
      }),
      { numRuns: 200 },
    );
    w.atLeast(200);
  });
});
