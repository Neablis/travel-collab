# M4 Money & Lenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** Give every activity an optional cost, roll costs up (derived, not stored) to per-day subtotals and a trip total, add a settable trip currency and budget with an over-budget soft conflict, and add three read-only output lenses (itinerary / daily overview / full-trip overview) — all through the one command pipeline, undo/revert-correct via the existing ADR-005 machinery.

**Architecture:** Same as M0–M3 (ADR-001/002/003/005/006) plus two new mechanism decisions. `Money = { amountMinor:int≥0, currency:ISO-4217 }` — integer minor units, never floats (ADR-008). Cost is a snapshot field on activities riding the existing `ActivityAdded/Updated` events (ADR-009) — undo/revert-correct for free, zero new activity events. Trip `currency` and `budget` are new attribute events modeled on `SetTripStartDate`. Rollups are a pure `rollupCosts(state)` exposed on `TripDetail` (the `deriveDayDates` precedent). A pure `budgetRule` raises an `over-budget` `warn`. The three lenses are read-only views over the same `TripDetail`, built against MSW mocks first. Spec: `docs/specs/2026-07-10-M4-money-and-lenses-design.md`.

**Tech Stack:** Everything M3 used. **No new runtime dependency** (unlike M3's `maplibre-gl`) — money is plain integer arithmetic and the lenses are plain React/CSS. **No new environment variable and no DB migration** — cost/currency/budget ride the existing `events`/`trip_details` jsonb.

## Global Constraints

- Read `AGENTS.md` before starting. Its invariants override convenience, always.
- Node >= 20, pnpm >= 9. All commands run from the repo root unless stated. Local Postgres for integration tests: `docker compose up -d` (port 5433); dev server on 3001. Never hardcode a port/URL; use the existing `apps/web/src/config.ts` / `apps/web/src/server/config.ts` defaults.
- **M4 builds on M3.** Branch from `main` **after M3 is merged**. Every `TripDetail`/`ActivityView`/`ActivityState` literal below carries M3's fields (`anchors`, day `date`) as well as M4's new fields — if M3 is not yet merged when you start, STOP and tell Mitchell.
- **Branch:** create `m4-money-and-lenses` from `main` (isolated worktree recommended via superpowers:using-git-worktrees). One PR at the end (Task I4). CI green before merge.
- Events are forever: never edit stored events; all new event schemas are `version: 1`; event payloads use explicit `null`, never missing keys. New optional fields on **existing** event payloads MUST use `.default(...)` so `TripEvent.parse` still accepts every previously stored event (verified by a test in Task 1).
- `packages/domain` does **no I/O, no clock reads, no randomness** (invariant 4). All money is **integer** minor-unit arithmetic — no floats, no fractional cents. The only division by 100 is the documented display formatter (`fmt`, Task D3) and the UI's `MoneyInput` (Task U2), both a 2-decimal simplification recorded in ADR-008.
- No writes to `trip_summaries` or `trip_details` outside `apps/web/src/server/projections.ts` (invariant 1). UI code (including `src/mocks`) may import only `@tc/contracts` + the typed client, never `@tc/domain` (lint wall).
- Every command still goes `command → validate → append → project`; every event carries `actor_id`; all permission checks go through `AccessPolicy`.
- **No DB migration and no new env var.** Money lives in `events.payload` and `trip_details.doc` jsonb. Nothing changes the SQL schema or the deploy secrets.
- Commit after every task with the exact message given (conventional commits).
- **Known red window:** `pnpm typecheck` (whole workspace) fails from Task 1 until **both Task D3 and Task U1** land — Task 1 grows `ActivityView`/`TripDetail` (and the activity event payloads), so the projection and every `TripDetail`/`ActivityView` literal miss the new fields until the domain (D-track) and the mocks (U1) fill them in. Task 1 verifies the **contracts package only**; within each track, run the track's filtered tests, not the full `pnpm typecheck`. Do not "fix" the red window early by weakening types.

## Workstreams & parallel dispatch (AGENTS.md workstream model)

**Task 1 (Contracts) is the meeting point — it lands and is reviewed/merged first.** After Task 1, two workstreams are **mutually independent** and can be dispatched as **parallel subagents** (there is no server-geocoding track this milestone — M4 adds no new I/O):

| Track | Tasks | Depends on | Independent of |
|---|---|---|---|
| **D — Domain** (cost field, rollup, currency/budget, over-budget rule) | D1 → D2 → D3 | Task 1 only | UI track |
| **U — UI** (money editors + three lenses + M3 debt, **against MSW mocks**) | U1 → (U2, U3, U4, U5, U6) | Task 1 only (U1 first, then U2–U6 parallel) | Domain track |

The domain track and the UI track **never touch the same files** and share no runtime state — the UI builds entirely against contract-derived MSW mocks (U1), exactly as M1/M2/M3 did. Within a track, order is D1→D2→D3 and U1→{U2,U3,U4,U5,U6}.

**Integration tasks run after their tracks converge** (a single coordinating session, not parallel):
- **I1 (server wiring + rollup integration test)** needs Track D merged.
- **I2 (wire lenses + money settings to the real API)** needs Track U + I1 merged.
- **I3 (e2e)** and **I4 (verification + docs + PR)** need everything.

Dependency at a glance:

```
Task 1 ──┬──► D1 cost/state ► D2 rollupCosts ► D3 currency/budget + over-budget + detail ─┐
         └──► U1 mocks ►┬─ U2 money editors ─┐                                             ├──► I1 ► I2 ► I3 ► I4
                        ├─ U3 itinerary lens ─┤                                             │
                        ├─ U4 daily overview ─┤─────────────────────────────────────────────┘
                        ├─ U5 trip overview ──┤
                        └─ U6 M3 debt paydown ┘
```

---

### Task 0: Preflight — reconcile M3's gate-close checklist

The standing preflight (`TODO.md` standing tasks): before Task 1, confirm the
previous milestone (M3) is fully closed out per the **gate-close checklist** in
`docs/milestones/README.md`. This is the forcing function that catches a missed
gate-close.

- [ ] **Step 1: Verify M3's flags are all flipped**
  - `TODO.md`: M3 is `- [x]`.
  - `docs/milestones/M3-place-and-time.md`: every exit-gate box checked; retro note present.
  - `docs/milestones/README.md`: "Current milestone" reads M4 (and `AGENTS.md` restates no number).
  - `main` contains M3's merged **code** (`packages/contracts/src/activity.ts` has `anchors`; `detail.ts` has day `date`). If not, STOP — M4 builds on M3.

- [ ] **Step 2: If any flag is unflipped, flip it now** — in one commit (tick TODO, check the M3 exit-gate boxes, retro, bump Current milestone) before starting Task 1. If everything is already reconciled, no changes; proceed to Task 1.

---

### Task 1: Contracts — Money, activity cost, trip currency & budget, rollup fields

**Files:**
- Create: `packages/contracts/src/money.ts`
- Modify: `packages/contracts/src/activity.ts`, `packages/contracts/src/trip.ts`, `packages/contracts/src/detail.ts`, `packages/contracts/src/index.ts` (verify it re-exports the new `./money` and existing modules)
- Modify: `docs/contracts/CHANGELOG.md`
- Test: `packages/contracts/test/money.test.ts` (create; mirror `packages/contracts/test/anchors.test.ts`)

**Interfaces:**
- Produces (consumed by every later task):
  - `Money` — `{ amountMinor: int≥0; currency: /^[A-Z]{3}$/ }`.
  - `AddActivity` gains `cost: Money.optional()`; `UpdateActivity` gains `cost: Money.nullable().optional()` (omitted = unchanged, `null` = cleared).
  - `ActivityAddedV1`/`ActivityUpdatedV1` payloads gain `cost: Money.nullable().default(null)` (default = non-breaking for stored events).
  - `SetTripCurrency` + `TripCurrencySetV1`; `SetTripBudget` + `TripBudgetSetV1` (joined into `TripCommand`/`TripEvent`).
  - `ActivityView` gains `cost: Money.nullable()`; `TripDetail` gains `currency: string`, `budget: Money|null`, `days[].costSubtotal: int`, `unscheduledCostSubtotal: int`, `tripCostTotal: int`, `budgetRemaining: int|null`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/test/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money, TripCommand, TripEvent, TripDetail } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";

describe("M4 money contracts", () => {
  it("parses Money and rejects floats / bad currency codes", () => {
    expect(Money.parse({ amountMinor: 4200, currency: "USD" }).amountMinor).toBe(4200);
    expect(() => Money.parse({ amountMinor: 42.5, currency: "USD" })).toThrow();
    expect(() => Money.parse({ amountMinor: -1, currency: "USD" })).toThrow();
    expect(() => Money.parse({ amountMinor: 100, currency: "usd" })).toThrow();
  });

  it("AddActivity/UpdateActivity carry a cost; UpdateActivity can clear it with null", () => {
    const add = TripCommand.parse({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Museum", cost: { amountMinor: 4200, currency: "USD" } });
    expect(add.type).toBe("AddActivity");
    const clear = TripCommand.parse({ type: "UpdateActivity", tripId: TRIP, activityId: A1, cost: null });
    expect(clear.type).toBe("UpdateActivity");
  });

  it("SetTripCurrency and SetTripBudget parse (budget nullable to clear)", () => {
    expect(TripCommand.parse({ type: "SetTripCurrency", tripId: TRIP, currency: "EUR" }).type).toBe("SetTripCurrency");
    expect(TripCommand.parse({ type: "SetTripBudget", tripId: TRIP, budget: { amountMinor: 250000, currency: "EUR" } }).type).toBe("SetTripBudget");
    expect(TripCommand.parse({ type: "SetTripBudget", tripId: TRIP, budget: null }).type).toBe("SetTripBudget");
  });

  it("TripCurrencySet/TripBudgetSet events parse", () => {
    expect(TripEvent.parse({ type: "TripCurrencySet", version: 1, payload: { tripId: TRIP, currency: "EUR" } }).type).toBe("TripCurrencySet");
    expect(TripEvent.parse({ type: "TripBudgetSet", version: 1, payload: { tripId: TRIP, budget: null } }).type).toBe("TripBudgetSet");
  });

  it("previously-stored ActivityAdded/Updated events (no cost field) still parse, defaulting to null", () => {
    const added = TripEvent.parse({ type: "ActivityAdded", version: 1, payload: { tripId: TRIP, activityId: A1, dayId: null, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [] } });
    if (added.type !== "ActivityAdded") throw new Error("wrong type");
    expect(added.payload.cost).toBeNull();
    const updated = TripEvent.parse({ type: "ActivityUpdated", version: 1, payload: { tripId: TRIP, activityId: A1, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [] } });
    if (updated.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(updated.payload.cost).toBeNull();
  });

  it("TripDetail carries currency, budget, per-day + trip rollups", () => {
    const detail = {
      tripId: TRIP, name: "Rome", startDate: "2026-10-12", currency: "USD", budget: null,
      members: [{ userId: "u1", role: "owner" }],
      days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
      backlog: [], unscheduledCostSubtotal: 0, tripCostTotal: 4200, budgetRemaining: null,
      conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
      activities: { [A1]: { activityId: A1, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 4200, currency: "USD" } } },
    };
    expect(TripDetail.parse(detail).tripCostTotal).toBe(4200);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @tc/contracts test`
Expected: FAIL — `Money` not exported.

- [ ] **Step 3: Implement — `packages/contracts/src/money.ts`**

```ts
import { z } from "zod";

// Integer minor units (e.g. cents) + an ISO-4217 code. Never a float (ADR-008):
// stored money must rebuild bit-identically under the golden test, and all
// arithmetic is integer. `currency` keeps every amount self-describing so
// multi-currency is a later additive step.
export const Money = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof Money>;
```

Confirm `packages/contracts/src/index.ts` re-exports the new module — add `export * from "./money";` if it does not already (it uses `export *` per module).

- [ ] **Step 4: Implement — `packages/contracts/src/activity.ts`**

Add `import { Money } from "./money";` at the top. Then:
- `AddActivity` object gains `cost: Money.optional(), // omitted = no cost`.
- `UpdateActivity` object gains `cost: Money.nullable().optional(), // omitted = unchanged, null = cleared`.
- `ActivityAddedV1.payload` and `ActivityUpdatedV1.payload` each gain `cost: Money.nullable().default(null),` (the `.default(null)` makes previously-stored events parse — same mechanism as M3's `anchors: z.array(Anchor).default([])`).

- [ ] **Step 5: Implement — `packages/contracts/src/trip.ts`**

Add `import { Money } from "./money";`. Add the two attribute commands + events (modeled on `SetTripStartDate`/`TripStartDateSetV1`):

```ts
export const SetTripCurrency = z.object({
  type: z.literal("SetTripCurrency"),
  tripId: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type SetTripCurrency = z.infer<typeof SetTripCurrency>;

export const TripCurrencySetV1 = z.object({
  type: z.literal("TripCurrencySet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/) }),
});
export type TripCurrencySetV1 = z.infer<typeof TripCurrencySetV1>;

export const SetTripBudget = z.object({
  type: z.literal("SetTripBudget"),
  tripId: z.string().uuid(),
  budget: Money.nullable(), // null clears
});
export type SetTripBudget = z.infer<typeof SetTripBudget>;

export const TripBudgetSetV1 = z.object({
  type: z.literal("TripBudgetSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), budget: Money.nullable() }),
});
export type TripBudgetSetV1 = z.infer<typeof TripBudgetSetV1>;
```

Join `TripCurrencySetV1` and `TripBudgetSetV1` into the `TripEvent` discriminated union, and `SetTripCurrency` and `SetTripBudget` into the `TripCommand` discriminated union.

- [ ] **Step 6: Implement — `packages/contracts/src/detail.ts`**

Add `Money` to the existing `import { Location, TimeWindow } from "./activity";` line by importing it from `./money`: `import { Money } from "./money";`.
- `ActivityView` gains `cost: Money.nullable(),` (alongside the M3 `anchors`).
- The `TripDetail.days` element gains `costSubtotal: z.number().int(),` (alongside the M3 `date`):

```ts
  days: z.array(
    z.object({
      dayId: z.string().uuid(),
      activityIds: z.array(z.string().uuid()),
      date: z.string().nullable(),        // M3
      costSubtotal: z.number().int(),     // M4 (minor units)
    }),
  ),
```

- `TripDetail` gains, at the top level:

```ts
  currency: z.string(),                   // ISO-4217, from state (default "USD")
  budget: Money.nullable(),
  unscheduledCostSubtotal: z.number().int(),
  tripCostTotal: z.number().int(),
  budgetRemaining: z.number().int().nullable(), // budget − total, null if no budget (may be negative)
```

- [ ] **Step 7: Run the contracts tests**

Run: `pnpm --filter @tc/contracts test && pnpm --filter @tc/contracts typecheck`
Expected: PASS. (Root `pnpm typecheck` is EXPECTED to fail until Tasks D3 and U1 — the red window.)

- [ ] **Step 8: Changelog + commit**

Append to `docs/contracts/CHANGELOG.md`:

```markdown
## 2026-07-10 — M4 money & lenses schemas
- Added: `Money` (integer minor units + ISO-4217 currency)
- Added: `cost` on `AddActivity` (optional) / `UpdateActivity` (nullable, optional)
  and on `ActivityAddedV1`/`ActivityUpdatedV1` payloads (`Money.nullable().default(null)`)
- Added: commands `SetTripCurrency`, `SetTripBudget`; events `TripCurrencySetV1`,
  `TripBudgetSetV1` (joined `TripCommand`/`TripEvent`)
- Added: `ActivityView.cost`; `TripDetail.currency`, `.budget`, `.tripCostTotal`,
  `.unscheduledCostSubtotal`, `.budgetRemaining`, `days[].costSubtotal`
- Why: M4 — costs on activities, derived cost rollups, trip currency & budget,
  over-budget conflict (ADR-008, ADR-009)
- Consumers updated: `@tc/domain` (state/evolve/equality/diff/decide/costs/
  conflicts/detail), `apps/web` (projection wiring, mocks, money editors, lenses)
  — same PR
- Breaking? no — event payload additions default (`cost` → null), so
  `TripEvent.parse` accepts all previously stored events unchanged; DTO additions
  are new required fields produced only by the updated projection
```

```bash
git add packages/contracts docs/contracts/CHANGELOG.md
git commit -m "feat(contracts): Money, activity cost, trip currency & budget, cost rollups"
```

---

## Track D — Domain (parallelizable with Track U after Task 1)

### Task D1: Domain — activity `cost` + trip `currency`/`budget` state fields

**Files:**
- Modify: `packages/domain/src/trip/state.ts`, `evolve.ts`, `equality.ts`, `decide.ts`, `diff.ts`
- Modify: domain tests that build `TripState`/`ActivityState` literals (add `cost: null` to activities, `currency: "USD"` + `budget: null` to states)
- Test: `packages/domain/test/cost-state.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 `Money`.
- Produces: `ActivityState.cost: Money | null`; `TripState.currency: string` (default `"USD"`) + `TripState.budget: Money | null` (default `null`); `moneyEqual(a, b)` in `equality.ts`; `activityStatesEqual` compares `cost`; `decideTripCommand` sets `cost` on add/update; `diffTripStates` emits `cost` in activity snapshots. (Currency/budget **mutation** events arrive in D3 — here they are only immutable state fields with defaults.)

- [ ] **Step 1: Write the failing test**

`packages/domain/test/cost-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Money } from "@tc/contracts";
import { decideTripCommand, evolveTrip, tripDetailFromState, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const CTX = { actorId: "u1" };
const COST: Money = { amountMinor: 4200, currency: "USD" };

function baseState(): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }],
    startDate: null, days: [], backlog: [], activities: {},
    currency: "USD", budget: null, dismissedConflictIds: [],
  };
}

function addWithCost(cost: Money): TripState {
  const d = decideTripCommand(baseState(), { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Museum", cost }, CTX);
  if (!d.ok) throw new Error(d.rejection.code);
  return evolveTrip(baseState(), d.events[0]!);
}

describe("activity cost in domain state", () => {
  it("AddActivity carries cost into state; the detail exposes it", () => {
    const state = addWithCost(COST);
    expect(state.activities[A1]!.cost).toEqual(COST);
    expect(tripDetailFromState(state, "2026-07-10T00:00:00.000Z").activities[A1]!.cost).toEqual(COST);
  });

  it("UpdateActivity with omitted cost leaves it unchanged; explicit null clears", () => {
    let state = addWithCost(COST);
    const omit = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, title: "Renamed" }, CTX);
    if (!omit.ok) throw new Error(omit.rejection.code);
    state = evolveTrip(state, omit.events[0]!);
    expect(state.activities[A1]!.cost).toEqual(COST);
    const clear = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, cost: null }, CTX);
    if (!clear.ok) throw new Error(clear.rejection.code);
    expect(evolveTrip(state, clear.events[0]!).activities[A1]!.cost).toBeNull();
  });

  it("re-setting the identical cost is a no-op", () => {
    const state = addWithCost(COST);
    const decision = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, cost: { amountMinor: 4200, currency: "USD" } }, CTX);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.rejection.code).toBe("no-op");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test packages/domain/test/cost-state.test.ts`
Expected: FAIL (typecheck: `cost`/`currency`/`budget` missing on the state types).

- [ ] **Step 3: Implement — state fields**

`packages/domain/src/trip/state.ts` — extend the imports and both state types:

```ts
import type { Anchor, Location, Money, TimeWindow, TripMember } from "@tc/contracts";

export type ActivityState = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];   // M3
  cost: Money | null;  // M4
};

// TripState gains currency (default applied in evolve at TripCreated) and budget.
export type TripState = {
  // ...existing fields...
  currency: string;      // ISO-4217; defaults to "USD"
  budget: Money | null;  // defaults to null
};
```

- [ ] **Step 4: Implement — evolve, equality, decide, diff**

`packages/domain/src/trip/evolve.ts`:
- In the `TripCreated` branch (the initial-state builder), set the defaults `currency: "USD"` and `budget: null` on the new state.
- In the `ActivityAdded` and `ActivityUpdated` branches, read `cost` from the payload into the `ActivityState` (add `cost` next to the existing `anchors` destructure/assignment):

```ts
    // ActivityAdded / ActivityUpdated:
    const { /* ...title, timeWindow, location, notes, anchors, */ cost } = event.payload;
    // activities[activityId] = { title, timeWindow, location, notes, anchors, cost };
```

`packages/domain/src/trip/equality.ts` — add a money comparator and use it for `cost`:

```ts
import type { Money } from "@tc/contracts";

export function moneyEqual(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}
```

Add `&& moneyEqual(a.cost, b.cost)` to the `activityStatesEqual` return expression. In the trip-level state comparator (the `tripStatesEqual` the diff round-trip test uses), add `state.currency` equality (`a.currency === b.currency`) and `moneyEqual(a.budget, b.budget)`.

`packages/domain/src/trip/decide.ts` — the `AddActivity` payload gains `cost: command.cost ?? null`; the `UpdateActivity` payload gains `cost: command.cost === undefined ? current.cost : command.cost`. (The existing no-op wrapper now rejects a same-cost update automatically, because `activityStatesEqual` compares `cost`.)

`packages/domain/src/trip/diff.ts` — the `ActivityAdded` snapshot and the `ActivityUpdated` snapshot payloads each gain `cost: a.cost` (next to the existing `anchors: a.anchors`).

- [ ] **Step 5: Fix the red window mechanically (domain tests only)**

Run: `pnpm --filter @tc/domain typecheck`
Every remaining error in `packages/domain/test/*.test.ts` is an `ActivityState` literal missing `cost` or a `TripState` literal missing `currency`/`budget`. Add `cost: null` to each activity literal and `currency: "USD"`, `budget: null` to each state literal. No other change this step. (The UI mocks' literals are fixed in Task U1, on the UI track — leave them.)

- [ ] **Step 6: Run + commit**

Run: `pnpm --filter @tc/domain test packages/domain/test/cost-state.test.ts && pnpm --filter @tc/domain typecheck`
Expected: PASS (the domain package typechecks; the full-workspace `pnpm typecheck` stays red until D3 + U1).

```bash
git add packages/domain
git commit -m "feat(domain): activity cost + trip currency/budget state fields"
```

### Task D2: Domain — `rollupCosts` (pure cost math)

**Files:**
- Create: `packages/domain/src/trip/costs.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/costs.property.test.ts`

**Interfaces:**
- Consumes: Task D1 `ActivityState.cost`.
- Produces: `rollupCosts(state): { dayCostSubtotals: number[]; unscheduledCostSubtotal: number; tripCostTotal: number }` (pure integer math, minor units).

- [ ] **Step 1: Write `rollupCosts`**

`packages/domain/src/trip/costs.ts`:

```ts
import type { TripState } from "./state";

// Pure integer money math (minor units). No I/O, no clock. All costs are in the
// trip currency (single-currency, ADR-008), so amounts sum directly. An activity
// with no cost contributes 0.
export function rollupCosts(state: TripState): {
  dayCostSubtotals: number[];
  unscheduledCostSubtotal: number;
  tripCostTotal: number;
} {
  const costOf = (id: string): number => state.activities[id]?.cost?.amountMinor ?? 0;
  const dayCostSubtotals = state.days.map((d) => d.activityIds.reduce((sum, id) => sum + costOf(id), 0));
  const unscheduledCostSubtotal = state.backlog.reduce((sum, id) => sum + costOf(id), 0);
  const tripCostTotal = dayCostSubtotals.reduce((a, b) => a + b, 0) + unscheduledCostSubtotal;
  return { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal };
}
```

`packages/domain/src/index.ts` — add `export * from "./trip/costs";`.

- [ ] **Step 2: Write the property test**

`packages/domain/test/costs.property.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rollupCosts, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";

// N activities, each with an integer minor-unit cost (0 = no cost); onDay[i]
// puts activity i on the single day, else in the backlog.
function stateOf(costs: number[], onDay: boolean[]): TripState {
  const activities: TripState["activities"] = {};
  const day = { dayId: "d1", activityIds: [] as string[] };
  const backlog: string[] = [];
  costs.forEach((c, i) => {
    const id = `a${i}`;
    activities[id] = { title: `A${i}`, timeWindow: null, location: null, notes: null, anchors: [], cost: c === 0 ? null : { amountMinor: c, currency: "USD" } };
    (onDay[i] ? day.activityIds : backlog).push(id);
  });
  return { tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], startDate: null, days: [day], backlog, activities, currency: "USD", budget: null, dismissedConflictIds: [] };
}

describe("rollupCosts", () => {
  it("a costless trip totals 0", () => {
    fc.assert(fc.property(fc.nat({ max: 10 }), (n) => {
      const st = stateOf(Array.from({ length: n }, () => 0), Array.from({ length: n }, (_, i) => i % 2 === 0));
      expect(rollupCosts(st).tripCostTotal).toBe(0);
    }));
  });

  it("day subtotals + unscheduled equals the trip total, which equals the sum of all costs (partition)", () => {
    fc.assert(fc.property(fc.array(fc.nat({ max: 100_000 }), { maxLength: 12 }), (costs) => {
      const onDay = costs.map((_, i) => i % 3 !== 0);
      const r = rollupCosts(stateOf(costs, onDay));
      expect(r.dayCostSubtotals.reduce((a, b) => a + b, 0) + r.unscheduledCostSubtotal).toBe(r.tripCostTotal);
      expect(r.tripCostTotal).toBe(costs.reduce((a, b) => a + b, 0));
    }));
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @tc/domain test packages/domain/test/costs.property.test.ts`
Expected: PASS.

```bash
git add packages/domain
git commit -m "feat(domain): rollupCosts — pure per-day/unscheduled/trip cost totals"
```

### Task D3: Domain — currency/budget mutations, over-budget rule, detail rollups

**Files:**
- Modify: `packages/domain/src/trip/decide.ts`, `evolve.ts`, `diff.ts`, `conflicts.ts`, `detail.ts`
- Test: `packages/domain/test/over-budget.test.ts` (create); extend `packages/domain/test/diff.property.test.ts`

**Interfaces:**
- Consumes: Task 1 `SetTripCurrency`/`SetTripBudget` + events, Task D1 `moneyEqual`, Task D2 `rollupCosts`.
- Produces: `decideTripCommand` handles `SetTripCurrency`/`SetTripBudget` (no-op when unchanged); `evolveTrip` applies `TripCurrencySet`/`TripBudgetSet`; `diffTripStates` emits them; a `budgetRule` in `conflicts.ts` (`kind:"over-budget"`, `warn`, id `over-budget:<tripId>`); `tripDetailFromState` populates `currency`, `budget`, `days[].costSubtotal`, `unscheduledCostSubtotal`, `tripCostTotal`, `budgetRemaining`. This task **closes the domain red window**.

- [ ] **Step 1: Write the failing over-budget test**

`packages/domain/test/over-budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectConflicts, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "a1";

function stateWith(budgetMinor: number | null, costMinor: number): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }],
    startDate: null, days: [{ dayId: "d1", activityIds: [A1] }], backlog: [],
    activities: { [A1]: { title: "Hotel", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: costMinor, currency: "USD" } } },
    currency: "USD", budget: budgetMinor === null ? null : { amountMinor: budgetMinor, currency: "USD" },
    dismissedConflictIds: [],
  };
}

describe("over-budget rule", () => {
  it("no conflict with no budget, under budget, or exactly at budget", () => {
    expect(detectConflicts(stateWith(null, 5000))).toHaveLength(0);
    expect(detectConflicts(stateWith(5000, 4999))).toHaveLength(0);
    expect(detectConflicts(stateWith(5000, 5000))).toHaveLength(0);
  });

  it("one warn conflict when over budget, with a stable trip-scoped id", () => {
    const conflicts = detectConflicts(stateWith(5000, 6000));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("over-budget");
    expect(conflicts[0]!.severity).toBe("warn");
    expect(conflicts[0]!.id).toBe(`over-budget:${TRIP}`);
    expect(conflicts[0]!.subjects).toEqual([TRIP]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test packages/domain/test/over-budget.test.ts`
Expected: FAIL — no `over-budget` conflict produced.

- [ ] **Step 3: Implement — currency/budget mutations**

`packages/domain/src/trip/decide.ts` — add two cases, mirroring the existing `SetTripStartDate` case's structure (its no-op guard + event shape):

```ts
    case "SetTripCurrency": {
      // no-op if unchanged (mirror SetTripStartDate's no-op guard)
      if (command.currency === state.currency) return /* the no-op rejection SetTripStartDate returns */;
      return /* ok with */ [{ type: "TripCurrencySet", version: 1, payload: { tripId: command.tripId, currency: command.currency } }];
    }
    case "SetTripBudget": {
      if (moneyEqual(command.budget, state.budget)) return /* the no-op rejection */;
      return /* ok with */ [{ type: "TripBudgetSet", version: 1, payload: { tripId: command.tripId, budget: command.budget } }];
    }
```

> Copy the exact ok/no-op return shape from the `SetTripStartDate` case in the same file — do not invent new helpers. Import `moneyEqual` from `./equality`.

`packages/domain/src/trip/evolve.ts` — add two branches:

```ts
    case "TripCurrencySet":
      return { ...state, currency: event.payload.currency };
    case "TripBudgetSet":
      return { ...state, budget: event.payload.budget };
```

`packages/domain/src/trip/diff.ts` — alongside the existing `startDate` diff (which pushes a `TripStartDateSet` when `a.startDate !== b.startDate`), add:

```ts
    if (a.currency !== b.currency) {
      /* push */ { type: "TripCurrencySet", version: 1, payload: { tripId, currency: b.currency } };
    }
    if (!moneyEqual(a.budget, b.budget)) {
      /* push */ { type: "TripBudgetSet", version: 1, payload: { tripId, budget: b.budget } };
    }
```

> Match the exact push/emit mechanism `diff.ts` uses for `TripStartDateSet`. Import `moneyEqual` from `./equality`.

- [ ] **Step 4: Implement — the over-budget rule**

`packages/domain/src/trip/conflicts.ts` — add near the top:

```ts
import { rollupCosts } from "./costs";

// 2-decimal display formatter (ADR-008 M4 simplification); pure and deterministic
// so the stored conflict description reproduces under the golden rebuild.
function fmt(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}
```

Add the rule (it ignores `ctx` — budget and total are both in state):

```ts
const budgetRule: Rule = (state, _ctx) => {
  if (state.budget === null) return [];
  const { tripCostTotal } = rollupCosts(state);
  if (tripCostTotal <= state.budget.amountMinor) return [];
  return [{
    id: `over-budget:${state.tripId}`,
    kind: "over-budget",
    severity: "warn",
    subjects: [state.tripId],
    description: `Trip total (${fmt(tripCostTotal, state.currency)}) exceeds the budget (${fmt(state.budget.amountMinor, state.currency)}) by ${fmt(tripCostTotal - state.budget.amountMinor, state.currency)}.`,
    resolutions: ["Raise the budget", "Remove or reduce a cost"],
  }];
};
```

Register it in the rules array: `const rules: Rule[] = [timeOverlapRule, geographyRule, anchorRule, budgetRule];`.

- [ ] **Step 5: Implement — populate the rollup fields on the detail**

`packages/domain/src/trip/detail.ts` — import `rollupCosts` and populate the new `TripDetail` fields:

```ts
import { rollupCosts } from "./costs";
// ...
  const { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal } = rollupCosts(state);
  // days mapping already attaches the M3 `date`; add `costSubtotal`:
  //   days: state.days.map((d, i) => ({ dayId: d.dayId, activityIds: [...d.activityIds], date: dayDates[i]!, costSubtotal: dayCostSubtotals[i]! })),
  // activities mapping adds `cost: a.cost` (next to `anchors`).
  // top level:
  //   currency: state.currency,
  //   budget: state.budget,
  //   unscheduledCostSubtotal,
  //   tripCostTotal,
  //   budgetRemaining: state.budget ? state.budget.amountMinor - tripCostTotal : null,
```

- [ ] **Step 6: Extend the diff round-trip property test to exercise cost/currency/budget**

In `packages/domain/test/diff.property.test.ts`, add fixtures and thread them into the command/history generator so histories include cost edits, currency changes, and budget changes:

```ts
const COSTS = [undefined, null, { amountMinor: 1000, currency: "USD" }, { amountMinor: 250_00, currency: "USD" }] as const;
const CURRENCIES = ["USD", "EUR", "GBP"] as const;
const BUDGETS = [undefined, null, { amountMinor: 100_00, currency: "USD" }, { amountMinor: 500_00, currency: "USD" }] as const;
```

- Thread `cost: COSTS[raw.c % COSTS.length]` into the `AddActivity`/`UpdateActivity` builder cases (next to the M3 `anchors` threading).
- Mirror how the generator emits `SetTripStartDate` to also occasionally emit `SetTripCurrency` (`currency: CURRENCIES[raw.b % CURRENCIES.length]`) and `SetTripBudget` (`budget: BUDGETS[raw.b % BUDGETS.length]`).

The existing `tripStatesEqual(applied, target)` round-trip assertion now covers cost + currency + budget — proving undo/revert of every money edit is exact.

- [ ] **Step 7: Run + commit (closes the red window)**

Run: `pnpm typecheck && pnpm --filter @tc/domain test`
Expected: PASS (all domain suites — over-budget, the extended round-trip 300 runs, and the golden rebuild). `pnpm typecheck` now passes the whole workspace **once Task U1 has also landed**; if U1 is not yet merged, run `pnpm --filter @tc/domain typecheck` here instead.

```bash
git add packages/domain
git commit -m "feat(domain): currency/budget mutations + over-budget rule + cost rollups on detail"
```

---

## Track U — UI against MSW mocks (parallelizable with Track D after Task 1)

> All UI tasks import only `@tc/contracts` + the typed client. They build against MSW; nothing here imports `@tc/domain`. Lens logic is extracted into **pure, tested helper functions**; the visual shell is verified in the browser preview at the gate (Task I3).

### Task U1: UI — fixtures + mocks for cost, currency, budget, rollups

**Files:**
- Modify: `apps/web/src/mocks/fixtures.ts`, `apps/web/src/mocks/handlers.ts`

**Interfaces:**
- Produces: sample `TripDetail`s carrying `currency`/`budget`/rollup fields + `activities[].cost`; `applyMock` handles `cost` on add/update, applies `SetTripCurrency`/`SetTripBudget`, and recomputes rollups + the synthetic `over-budget` conflict after any cost/day/budget change.

- [ ] **Step 1: Extend fixtures (close the UI half of the red window)**

In `apps/web/src/mocks/fixtures.ts`, add to every `TripDetail` literal: `currency: "USD"`, `budget: null` (or a sample budget), `unscheduledCostSubtotal: 0`, `tripCostTotal: <computed>`, `budgetRemaining: null`; add `costSubtotal: <computed>` to each day; add `cost: null` (or a sample `{ amountMinor, currency }`) to each activity. Add a costed sample for the lens fixtures so the itinerary/overview lenses have something to show.

- [ ] **Step 2: Teach the mock about cost, currency, budget, and rollups**

`apps/web/src/mocks/handlers.ts` — add a local rollup helper (the mock stands in for the projection; it may NOT import `@tc/domain`):

```ts
function rerollup(detail: TripDetail): void {
  const costOf = (id: string): number => detail.activities[id]?.cost?.amountMinor ?? 0;
  detail.days.forEach((day) => (day.costSubtotal = day.activityIds.reduce((s, id) => s + costOf(id), 0)));
  detail.unscheduledCostSubtotal = detail.backlog.reduce((s, id) => s + costOf(id), 0);
  detail.tripCostTotal = detail.days.reduce((s, d) => s + d.costSubtotal, 0) + detail.unscheduledCostSubtotal;
  detail.budgetRemaining = detail.budget ? detail.budget.amountMinor - detail.tripCostTotal : null;
  detail.conflicts = detail.conflicts.filter((c) => c.kind !== "over-budget");
  if (detail.budget && detail.tripCostTotal > detail.budget.amountMinor) {
    detail.conflicts.push({
      id: `over-budget:${detail.tripId}`, kind: "over-budget", severity: "warn",
      subjects: [detail.tripId], description: "Trip total exceeds the budget.",
      resolutions: ["Raise the budget", "Remove or reduce a cost"],
    });
  }
}
```

In `applyMock`:
- `AddActivity`: set `cost: command.cost ?? null` on the new activity.
- `UpdateActivity`: `if (command.cost !== undefined) activity.cost = command.cost;`.
- `SetTripCurrency`: `detail.currency = command.currency;`.
- `SetTripBudget`: `detail.budget = command.budget;`.
- Call `rerollup(detail)` at the end of the `AddActivity`, `UpdateActivity`, `MoveActivity`, `RemoveActivity`, `AddDay`, `RemoveDay`, and `SetTripBudget` cases.

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/mocks
git commit -m "test(ui): MSW fixtures/handlers for cost, currency, budget, rollups"
```

### Task U2: UI — money input + cost field + currency/budget settings

**Files:**
- Create: `apps/web/src/components/board/MoneyInput.tsx`, `apps/web/src/components/board/TripMoneySettings.tsx`
- Modify: `apps/web/src/components/board/ActivityEditor.tsx`
- Test: `apps/web/src/components/board/MoneyInput.test.tsx`, `apps/web/src/components/board/TripMoneySettings.test.tsx`

**Interfaces:**
- Consumes: `Money` from `@tc/contracts`.
- Produces: `MoneyInput({ value: Money|null, currency, onChange })`; `TripMoneySettings({ tripId, currency, budget, onCommand })` (emits `SetTripCurrency`/`SetTripBudget`); `ActivityEditor` renders a `MoneyInput` for the activity cost and includes `cost` in the emitted command.

- [ ] **Step 1: Write the failing `MoneyInput` test**

`apps/web/src/components/board/MoneyInput.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MoneyInput } from "./MoneyInput";

describe("MoneyInput", () => {
  it("emits integer minor units from a decimal entry", async () => {
    const onChange = vi.fn();
    render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/cost/i), "42.50");
    expect(onChange).toHaveBeenLastCalledWith({ amountMinor: 4250, currency: "USD" });
  });

  it("clears to null when emptied", async () => {
    const onChange = vi.fn();
    render(<MoneyInput value={{ amountMinor: 4250, currency: "USD" }} currency="USD" onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText(/cost/i));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `pnpm --filter web test apps/web/src/components/board/MoneyInput.test.tsx` → FAIL (module missing).

`apps/web/src/components/board/MoneyInput.tsx`:

```tsx
"use client";
import type { Money } from "@tc/contracts";

// 2-decimal minor-unit input (ADR-008 M4 simplification). Empty → null.
export function MoneyInput({ value, currency, onChange }: { value: Money | null; currency: string; onChange: (m: Money | null) => void }) {
  const display = value ? (value.amountMinor / 100).toFixed(2) : "";
  return (
    <input
      type="number" step="0.01" min="0" aria-label={`cost (${currency})`} placeholder={`0.00 ${currency}`}
      defaultValue={display}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") return onChange(null);
        const amountMinor = Math.round(Number(raw) * 100);
        onChange(Number.isFinite(amountMinor) ? { amountMinor, currency } : null);
      }}
    />
  );
}
```

`apps/web/src/components/board/TripMoneySettings.tsx` — a `"use client"` control: a currency `<select>` (a short ISO list: `USD, EUR, GBP, JPY, CAD, AUD, CHF`) bound to `currency`, dispatching `{ type: "SetTripCurrency", tripId, currency }` via `onCommand` on change; a `MoneyInput` bound to `budget` (currency = the trip currency) that dispatches `{ type: "SetTripBudget", tripId, budget }` (and a **Clear budget** button dispatching `budget: null`). Functional styling.

Wire into `ActivityEditor.tsx`: render `<MoneyInput value={cost} currency={tripCurrency} onChange={setCost} />` (keep `cost` in local state, seeded from the activity), and include `cost` in the `AddActivity`/`UpdateActivity` command the editor already emits. The editor receives the trip currency from its props (thread it from the screen at wiring time, Task I2 — for the mocked test, default to `"USD"`).

- [ ] **Step 3: Write the `TripMoneySettings` test**

`apps/web/src/components/board/TripMoneySettings.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TripMoneySettings } from "./TripMoneySettings";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";

describe("TripMoneySettings", () => {
  it("emits SetTripCurrency on currency change and SetTripBudget on budget entry", async () => {
    const onCommand = vi.fn();
    render(<TripMoneySettings tripId={TRIP} currency="USD" budget={null} onCommand={onCommand} />);
    await userEvent.selectOptions(screen.getByLabelText(/currency/i), "EUR");
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripCurrency", tripId: TRIP, currency: "EUR" });
    await userEvent.type(screen.getByLabelText(/cost|budget/i), "2500");
    expect(onCommand).toHaveBeenLastCalledWith({ type: "SetTripBudget", tripId: TRIP, budget: { amountMinor: 250000, currency: "USD" } });
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/board/MoneyInput.test.tsx apps/web/src/components/board/TripMoneySettings.test.tsx && pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/components/board
git commit -m "feat(ui): money input, activity cost field, trip currency/budget settings"
```

### Task U3: UI — Itinerary lens

**Files:**
- Create: `apps/web/src/components/lenses/itineraryData.ts`, `apps/web/src/components/lenses/ItineraryLens.tsx`
- Test: `apps/web/src/components/lenses/itineraryData.test.ts`

**Interfaces:**
- Consumes: `TripDetail`.
- Produces: `itineraryDays(detail): ItineraryDay[]` (pure, days in order) and `itineraryUnscheduled(detail): ItineraryActivity[]`; `ItineraryLens({ detail })`.

- [ ] **Step 1: Write the pure helper test**

`apps/web/src/components/lenses/itineraryData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { itineraryDays, itineraryUnscheduled } from "./itineraryData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
  backlog: [A2], unscheduledCostSubtotal: 9900, tripCostTotal: 14100, budgetRemaining: null,
  activities: {
    [A1]: { activityId: A1, title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: { name: "Colosseum" }, notes: null, anchors: [], cost: { amountMinor: 4200, currency: "USD" } },
    [A2]: { activityId: A2, title: "Travel insurance", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 9900, currency: "USD" } },
  },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
};

describe("itineraryData", () => {
  it("lists each day's activities in order with cost and subtotal", () => {
    const [day] = itineraryDays(detail);
    expect(day!.ordinal).toBe(1);
    expect(day!.date).toBe("2026-10-12");
    expect(day!.costSubtotal).toBe(4200);
    expect(day!.activities).toEqual([{ activityId: A1, title: "Colosseum", start: "09:00", end: "11:00", place: "Colosseum", costMinor: 4200 }]);
  });
  it("lists unscheduled (trip-level) costs separately", () => {
    expect(itineraryUnscheduled(detail)).toEqual([{ activityId: A2, title: "Travel insurance", start: null, end: null, place: null, costMinor: 9900 }]);
  });
});
```

- [ ] **Step 2: Implement + run + commit**

`apps/web/src/components/lenses/itineraryData.ts`:

```ts
import type { TripDetail } from "@tc/contracts";

export type ItineraryActivity = { activityId: string; title: string; start: string | null; end: string | null; place: string | null; costMinor: number | null };
export type ItineraryDay = { dayId: string; date: string | null; ordinal: number; activities: ItineraryActivity[]; costSubtotal: number };

function toActivity(detail: TripDetail, id: string): ItineraryActivity {
  const a = detail.activities[id]!;
  return { activityId: id, title: a.title, start: a.timeWindow?.start ?? null, end: a.timeWindow?.end ?? null, place: a.location?.name ?? null, costMinor: a.cost?.amountMinor ?? null };
}

export function itineraryDays(detail: TripDetail): ItineraryDay[] {
  return detail.days.map((d, i) => ({ dayId: d.dayId, date: d.date, ordinal: i + 1, activities: d.activityIds.map((id) => toActivity(detail, id)), costSubtotal: d.costSubtotal }));
}

export function itineraryUnscheduled(detail: TripDetail): ItineraryActivity[] {
  return detail.backlog.map((id) => toActivity(detail, id));
}
```

`apps/web/src/components/lenses/ItineraryLens.tsx` — a component rendering, per `itineraryDays`, a day heading (ordinal + date) with its activities (time · place · cost, formatted `amountMinor/100` with `detail.currency`) and a day subtotal; then an **Unscheduled** section from `itineraryUnscheduled`; then a footer line with `detail.tripCostTotal` and, if `detail.budget`, the budget and `detail.budgetRemaining`. Functional styling.

Run: `pnpm --filter web test apps/web/src/components/lenses/itineraryData.test.ts` → PASS.

```bash
git add apps/web/src/components/lenses
git commit -m "feat(ui): itinerary lens (day-by-day with costs + subtotals)"
```

### Task U4: UI — Daily overview lens

**Files:**
- Create: `apps/web/src/components/lenses/dailyOverviewData.ts`, `apps/web/src/components/lenses/DailyOverviewLens.tsx`
- Test: `apps/web/src/components/lenses/dailyOverviewData.test.ts`

**Interfaces:**
- Consumes: `TripDetail`.
- Produces: `dailyRows(detail): { dayId, date, ordinal, activityCount, costSubtotal, conflictCount }[]` (pure, days in order); `DailyOverviewLens({ detail })`.

- [ ] **Step 1: Write the pure helper test**

`apps/web/src/components/lenses/dailyOverviewData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { dailyRows } from "./dailyOverviewData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
  backlog: [], unscheduledCostSubtotal: 0, tripCostTotal: 4200, budgetRemaining: null,
  activities: { [A1]: { activityId: A1, title: "Colosseum", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 4200, currency: "USD" } } },
  conflicts: [{ id: "anchor-violation:" + A1 + ":x", kind: "anchor-violation", severity: "warn", subjects: [A1], description: "x", resolutions: [] }],
  dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
};

describe("dailyRows", () => {
  it("summarizes each day: count, subtotal, and conflicts touching that day", () => {
    const [row] = dailyRows(detail);
    expect(row!.ordinal).toBe(1);
    expect(row!.date).toBe("2026-10-12");
    expect(row!.activityCount).toBe(1);
    expect(row!.costSubtotal).toBe(4200);
    expect(row!.conflictCount).toBe(1);
  });
});
```

- [ ] **Step 2: Implement + run + commit**

`apps/web/src/components/lenses/dailyOverviewData.ts`:

```ts
import type { TripDetail } from "@tc/contracts";

export type DailyRow = { dayId: string; date: string | null; ordinal: number; activityCount: number; costSubtotal: number; conflictCount: number };

export function dailyRows(detail: TripDetail): DailyRow[] {
  return detail.days.map((d, i) => {
    const ids = new Set(d.activityIds);
    const conflictCount = detail.conflicts.filter((c) => c.subjects.some((s) => ids.has(s))).length;
    return { dayId: d.dayId, date: d.date, ordinal: i + 1, activityCount: d.activityIds.length, costSubtotal: d.costSubtotal, conflictCount };
  });
}
```

`apps/web/src/components/lenses/DailyOverviewLens.tsx` — render `dailyRows` as one row per day (ordinal + date · activity count · subtotal formatted with `detail.currency` · a conflict badge when `conflictCount > 0`), plus a trip-total footer. Functional styling.

Run: `pnpm --filter web test apps/web/src/components/lenses/dailyOverviewData.test.ts` → PASS.

```bash
git add apps/web/src/components/lenses
git commit -m "feat(ui): daily overview lens (per-day count/spend/conflicts)"
```

### Task U5: UI — Full-trip overview lens

**Files:**
- Create: `apps/web/src/components/lenses/tripOverviewData.ts`, `apps/web/src/components/lenses/FullTripOverviewLens.tsx`
- Test: `apps/web/src/components/lenses/tripOverviewData.test.ts`

**Interfaces:**
- Consumes: `TripDetail`.
- Produces: `tripOverview(detail): { dayCount, dateRange, tripCostTotal, scheduledTotal, unscheduledTotal, currency, budget, budgetRemaining, overBudget }` (pure); `FullTripOverviewLens({ detail })`.

- [ ] **Step 1: Write the pure helper test**

`apps/web/src/components/lenses/tripOverviewData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripOverview } from "./tripOverviewData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12", currency: "USD",
  budget: { amountMinor: 10000, currency: "USD" },
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12", costSubtotal: 4200 }],
  backlog: [], unscheduledCostSubtotal: 9900, tripCostTotal: 14100, budgetRemaining: -4100,
  activities: { [A1]: { activityId: A1, title: "Colosseum", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 4200, currency: "USD" } } },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-10T00:00:00.000Z",
};

describe("tripOverview", () => {
  it("summarizes the whole trip and flags over-budget", () => {
    const o = tripOverview(detail);
    expect(o.dayCount).toBe(1);
    expect(o.dateRange).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    expect(o.tripCostTotal).toBe(14100);
    expect(o.scheduledTotal).toBe(4200);
    expect(o.unscheduledTotal).toBe(9900);
    expect(o.budgetRemaining).toBe(-4100);
    expect(o.overBudget).toBe(true);
  });
});
```

- [ ] **Step 2: Implement + run + commit**

`apps/web/src/components/lenses/tripOverviewData.ts`:

```ts
import type { Money, TripDetail } from "@tc/contracts";

export type TripOverview = {
  dayCount: number;
  dateRange: { from: string; to: string } | null;
  tripCostTotal: number;
  scheduledTotal: number;
  unscheduledTotal: number;
  currency: string;
  budget: Money | null;
  budgetRemaining: number | null;
  overBudget: boolean;
};

export function tripOverview(detail: TripDetail): TripOverview {
  const dates = detail.days.map((d) => d.date).filter((d): d is string => d !== null);
  const dateRange = dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null;
  return {
    dayCount: detail.days.length,
    dateRange,
    tripCostTotal: detail.tripCostTotal,
    scheduledTotal: detail.tripCostTotal - detail.unscheduledCostSubtotal,
    unscheduledTotal: detail.unscheduledCostSubtotal,
    currency: detail.currency,
    budget: detail.budget,
    budgetRemaining: detail.budgetRemaining,
    overBudget: detail.budgetRemaining !== null && detail.budgetRemaining < 0,
  };
}
```

`apps/web/src/components/lenses/FullTripOverviewLens.tsx` — a one-screen summary from `tripOverview`: trip name, date range + day count, trip total (formatted with `currency`), a scheduled-vs-unscheduled split, and a budget line showing budget + remaining (rendered as "over by X" when `overBudget`). Functional styling.

Run: `pnpm --filter web test apps/web/src/components/lenses/tripOverviewData.test.ts` → PASS.

```bash
git add apps/web/src/components/lenses
git commit -m "feat(ui): full-trip overview lens (totals, split, budget status)"
```

### Task U6: UI — M3 debt paydown (undo/redo in-flight guard + one start-date control)

**Files:**
- Modify: the `UndoRedoControls` component (locate: `grep -rl "UndoRedo" apps/web/src`) and its test
- Modify/remove: the duplicate start-date control (locate: `grep -rln "SetTripStartDate" apps/web/src/components`)

**Interfaces:**
- No contract/domain change — UI only.

- [ ] **Step 1: Guard undo/redo while a command is in flight**

Locate the component: `grep -rl "UndoRedo" apps/web/src`. Add an in-flight guard so a rapid double-click cannot fire two overlapping compensating commands: disable both buttons while a command is pending. Prefer an existing "is a command posting?" signal from the screen (thread it as an `isBusy`/`pending` prop); if none exists, track local `pending` state around the `onCommand` promise and disable while it resolves. Extend the component's test to assert both buttons are `disabled` while `pending`/`isBusy` is true.

- [ ] **Step 2: Consolidate the two start-date controls**

`grep -rln "SetTripStartDate" apps/web/src/components` — M3 left a start-date control in two places (the calendar lens `TripDateControl` and a second one on the board/settings surface). Keep **one** canonical control (the `TripDateControl` from M3) and remove the duplicate, updating any references so the trip start date is set from a single place. Where the M4 `TripMoneySettings` lives is the natural home for trip-level settings — co-locate the single start-date control there if it reduces duplication, but do not change its emitted command. Add/adjust a test asserting only one start-date control renders in the screen.

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter web test apps/web/src/components && pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/components
git commit -m "fix(ui): guard undo/redo in-flight; consolidate to one start-date control (M3 debt)"
```

---

## Integration (single coordinating session — runs after the tracks merge)

### Task I1: Server — verify pipeline + rollup/over-budget integration test

**Files:**
- Test: `apps/web/src/server/money.int.test.ts` (create; mirror the setup style of `apps/web/src/server/commands.int.test.ts`)
- Modify (only if needed): `apps/web/src/server/commands.ts` — see Step 1

**Interfaces:**
- Consumes: Track D (the projection now emits rollups/currency/budget; `decide`/`evolve` handle the new commands).

- [ ] **Step 1: Confirm the pipeline needs no change for the new commands**

The command pipeline validates commands via `TripCommand.parse` and calls `decideTripCommand` generically, so `SetTripCurrency`/`SetTripBudget` flow through with no pipeline change (the domain handles them). Confirm:

```bash
grep -rn "TripCommand\|decideTripCommand" apps/web/src/server/commands.ts
```

If (and only if) there is an explicit per-type switch/allow-list, add the two new command types to it. Otherwise no server code changes here — the projection changes already landed with Track D.

- [ ] **Step 2: Integration test — rollups recompute and over-budget appears, and survive rebuild**

`apps/web/src/server/money.int.test.ts` — using the existing integration harness (real Postgres, the command pipeline):
- Create a trip; `SetTripCurrency` → `"EUR"`; add a day; add two activities on the day, each with a `cost` (e.g. 4200 and 9900 minor). Assert the projected `TripDetail`: `currency === "EUR"`, `days[0].costSubtotal === 14100`, `tripCostTotal === 14100`.
- `SetTripBudget` to `{ amountMinor: 10000, currency: "EUR" }` (below total). Assert `TripDetail.conflicts` contains a `warn` with `kind === "over-budget"` and `budgetRemaining === -4100`.
- `SetTripBudget` to `{ amountMinor: 20000, currency: "EUR" }` (above total). Assert the `over-budget` conflict is gone and `budgetRemaining === 5900`.
- Call `rebuildProjections()` and assert the rebuilt detail equals the live one (conflicts included).

- [ ] **Step 3: Run + commit**

Run: `docker compose up -d && pnpm --filter web test:int apps/web/src/server/money.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS; lint wall green.

```bash
git add apps/web/src/server
git commit -m "test(server): money rollups + over-budget projection + rebuild integration"
```

### Task I2: Wire the money settings + three lenses into the trip screen

**Files:**
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx` (extend the lens switcher; mount `TripMoneySettings`; thread the trip currency into `ActivityEditor`)
- Test: `apps/web/src/components/board/TripBoardScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: U2–U6 components; the real `/commands` endpoint.

- [ ] **Step 1: Extend the lens switcher and mount money settings**

In `TripBoardScreen.tsx`, extend the M3 lens switcher (Board | Map | Timeline | Calendar) with **Itinerary | Daily | Trip** rendering `<ItineraryLens detail=…>` / `<DailyOverviewLens detail=…>` / `<FullTripOverviewLens detail=…>`. Mount `<TripMoneySettings tripId currency={detail.currency} budget={detail.budget} onCommand=…>` in the trip-settings area (co-located with the single start-date control from U6), dispatching through the screen's existing command-post path. Thread `detail.currency` into `ActivityEditor` so its `MoneyInput` uses the trip currency.

- [ ] **Step 2: Extend the screen test**

Add a test asserting: the switcher renders each new lens; `TripMoneySettings` posts a `SetTripBudget` command (via the MSW `onCommand` spy already used by `TripBoardScreen.test.tsx`); and when the mocked detail is over budget, the existing conflict banner shows the `over-budget` warning.

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/board && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS.

```bash
git add apps/web/src/components apps/web/src/app
git commit -m "feat(ui): wire money settings + itinerary/daily/trip lenses into the trip screen"
```

### Task I3: E2E — the M4 gate demo script

**Files:**
- Create: `apps/web/e2e/m4-money-and-lenses.spec.ts` (match the existing e2e layout/harness used by M1/M2/M3)

**Interfaces:**
- Consumes: the full wired app. No external service — money is entirely in-app (no key/stub needed, unlike M3's geocode).

- [ ] **Step 1: Write the happy-path script**

Following the gate: sign in (reuse the existing auth fixture) → create a trip → set the currency (e.g. EUR) → add a day → add an activity with a cost, add a "Flight to Rome" activity with a cost, add an **unscheduled** trip-level cost (a backlog activity, e.g. "Travel insurance") → open the Itinerary/Daily/Trip lenses and assert the per-day subtotal and the trip total render → set a **budget below the total** → assert an `over-budget` warning appears in the conflict banner → raise the budget → assert it clears → set it below again and **dismiss** the warning → assert it stays dismissed → **undo** the last cost edit → assert the trip total reverts. Keep it one linear script; assert via visible text/roles as M2/M3's scripts do.

- [ ] **Step 2: Run all e2e + commit**

Run: `pnpm --filter web test:e2e`
Expected: PASS — M0, M1, M2, M3, and the new M4 script all green.

```bash
git add apps/web/e2e
git commit -m "test(e2e): M4 money & lenses happy-path script"
```

### Task I4: Full verification, docs, and PR

- [ ] **Step 1: Full local gate**

Run: `docker compose up -d && pnpm check` (typecheck + lint + unit + integration) then `pnpm --filter web test:e2e`.
Expected: everything green, including the golden rebuild, the diff round-trip (with cost/currency/budget), and all five e2e scripts.

- [ ] **Step 2: Retro note**

Append a short **Retro (2026-07-…)** section to `docs/milestones/M4-money-and-lenses.md`: what we learned, anything that changed from this plan, any debt parked for M5.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin m4-money-and-lenses
gh pr create --title "M4: money & lenses (costs, rollups, currency/budget, itinerary/daily/trip lenses)" --body "$(cat <<'EOF'
Implements M4 per docs/plans/2026-07-10-M4-money-and-lenses.md and the spec.
- Integer minor-unit Money (ADR-008); cost as an activity snapshot field, flights are activities (ADR-009); derived cost rollups on TripDetail; trip currency + budget attribute events; over-budget warn conflict.
- Three read-only lenses (itinerary / daily overview / full-trip overview) over the same projection. M3 debt paid (undo/redo in-flight guard; single start-date control).
- Domain and UI were built as independent workstreams meeting at the contracts change. No new dependency, no new env var, no DB migration.
Gate: all M0–M4 e2e green; rollup + diff round-trip + golden rebuild hold with money; lint wall green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: On merge** confirm the `migrate-production` job is a no-op (no schema change this milestone) and the deployed URL passes the gate demo. Check the milestone's exit-gate boxes and mark M4 done in `TODO.md` / bump `docs/milestones/README.md` "Current milestone" to M5 only after the gate demo passes on the deployed URL.

---

## Self-review (completed at authoring)

- **Spec coverage:** Money representation (ADR-008) → Task 1 + D1; cost as an activity field (ADR-009) → Task 1 + D1; rollups derived-not-stored → D2 + D3 (detail); currency & budget attribute events → Task 1 + D1 (state) + D3 (mutations/diff); over-budget conflict → D3 + I1; undo/revert correctness → D3 (diff round-trip with cost/currency/budget); three lenses → U3/U4/U5; money editors → U2; M3 debt paydown → U6; contract surface → Task 1; testing (property/golden/integration/e2e) → D2/D3/I1/I3; out-of-scope items are not built.
- **Placeholder scan:** none — every code step carries real code or a precise, bounded instruction against a named existing file/pattern (the `decide.ts`/`diff.ts` no-op/push shapes explicitly defer to the existing `SetTripStartDate` handling rather than inventing helpers).
- **Type consistency:** `Money`/`moneyEqual`/`rollupCosts`/`budgetRule`/`fmt`/`itineraryDays`/`itineraryUnscheduled`/`dailyRows`/`tripOverview`/`MoneyInput`/`TripMoneySettings` are each defined once and referenced with the same signatures downstream; `cost: Money.nullable().default(null)` on events is the single non-breaking mechanism, mirroring M3's `anchors` default; `TripDetail` rollup fields (`currency`, `budget`, `days[].costSubtotal`, `unscheduledCostSubtotal`, `tripCostTotal`, `budgetRemaining`) are produced in D3 and consumed unchanged by U1's mock and every lens.
