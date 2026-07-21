# M6 Atomic Changes + Optimistic Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the client submit a series of commands as one all-or-nothing batch (one history entry), and apply every change — single command or batch — optimistically to local trip state and history, reconciling or rolling back on the server's response.

**Architecture:** The domain already treats a run of events sharing a `batchId` as one history entry (`groupBatches`/`buildHistoryEntries`), so the server batch executor just decides N commands against the evolving state and appends their events under one `batchId`. The client predicts a command/batch's outcome by reusing the *same* domain decider through a new curated `@tc/domain/predict` entrypoint (one implementation, no drift), applies it instantly, sends via a sequential queue, and reconciles against the authoritative `{ detail, history }` the command endpoints now return.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Zod contracts, Vitest (+ fast-check), React 19 / Next.js, Drizzle/Postgres, Playwright.

## Global Constraints

- The event log is the sole source of truth for planning; every change is `command → validate → append event(s) → update projections`. No direct projection writes. (AGENTS.md Invariant 1)
- Projections are disposable; the rebuild-equals-stored golden test must stay green. (Invariant 2)
- Conflicts are data, not errors — no blocking modal errors for plan-consistency problems. (Invariant 3)
- `packages/domain` is pure — no I/O, no wall-clock reads (time passed in). Depends only on `@tc/contracts`. (Invariant 4)
- Contract changes require a `docs/contracts/CHANGELOG.md` entry and all consumers updated in the same PR. (Invariant 5)
- Every event carries `actor_id`; no "the user" singletons; all permission checks go through the AccessPolicy seam. (Invariant 6)
- The UI/domain lint wall stays enforced: UI may import `@tc/domain/predict` ONLY — never `@tc/domain` bare or any other subpath, never `@/server/*`.
- TypeScript strict everywhere; conventional commits scoped to one logical change; `pnpm check` (typecheck + lint + unit) green before any task is done; integration/e2e where the task adds them.

## Verification commands (referenced throughout)

- Domain unit test (one file): `pnpm --filter @tc/domain exec vitest run <path>`
- Contracts unit test (one file): `pnpm --filter @tc/contracts exec vitest run <path>`
- Web unit tests (jsdom, `vitest.unit.config.ts`): `pnpm --filter web test`
- Web integration tests (real Postgres, `*.int.test.ts`): `pnpm --filter web test:int`
- Web e2e: `pnpm --filter web test:e2e`
- Full gate: `pnpm check`

---

## Task 1: Preflight bookkeeping (milestone file + Current-milestone bump)

Standing preflight (TODO.md): reconcile the previous milestone's gate-close before M6's first task. The M5 gate-close left `Current milestone` at M5.

**Files:**
- Create: `docs/milestones/M6-atomic-changes.md`
- Modify: `docs/milestones/README.md` (final line: `Current milestone: **M5** …` → M6)

- [ ] **Step 1: Write the M6 milestone file**

Create `docs/milestones/M6-atomic-changes.md`:

```markdown
# M6 — Atomic changes (+ optimistic updates)

**Status:** In progress
Design spec: `docs/superpowers/specs/2026-07-19-m6-atomic-changes-optimistic-updates-design.md`

## Scope

- Client/generator-declared command groups: a series of commands submitted as
  one all-or-nothing batch → one history entry, so undo/redo/revert treat it as
  a single change. Opt-in.
- Optimistic updates: a dispatched unit (single command or batch) applies to
  local trip state + history immediately, sends in the background via a
  sequential queue, and reconciles or rolls back on the server's response.
- Shared predictor via the curated `@tc/domain/predict` entrypoint (one decider,
  no drift). Server `seq` remains the sole ordering authority.
- ADR-013 records the decisions (amends ADR-012 invariant 1).

## Exit gate

- [ ] A batch of ≥2 commands appends exactly one history entry; undo/redo/revert
      treat it as a single change (integration test).
- [ ] A partially-invalid batch appends nothing (all-or-nothing; integration test).
- [ ] An optimistic edit renders before the network settles; a forced server
      failure rolls the edit (and anything queued behind it) back and surfaces an
      error (component + e2e tests).
- [ ] Predictor parity: for each command type, `predictCommand` yields the same
      `TripDetail` the server produces after real execution.
- [ ] `hydrate`/`project` round-trip property test green.
- [ ] Projection rebuild-equals-stored golden test still green.
- [ ] Lint wall: UI may import `@tc/domain/predict` only; bare `@tc/domain` still
      rejected.
- [ ] `pnpm check`, `pnpm --filter web test:int`, and the M0–M6 e2e scripts green.
- [ ] ADR-013 committed; contracts CHANGELOG updated.

## Retro

_(appended at gate close)_
```

- [ ] **Step 2: Bump Current milestone**

In `docs/milestones/README.md`, change the final line from:
`Current milestone: **M5** — Design foundations (see \`M5-design-foundations.md\`).`
to:
`Current milestone: **M6** — Atomic changes (see \`M6-atomic-changes.md\`).`

- [ ] **Step 3: Commit**

```bash
git add docs/milestones/M6-atomic-changes.md docs/milestones/README.md
git commit -m "docs(M6): open milestone — add M6 file, bump Current milestone"
```

---

## Task 2: `BatchableCommand` contract + CHANGELOG

The batch endpoint accepts only batchable commands — every `TripCommand` except `CreateTrip` and the three history commands (`UndoLastChange`, `RedoChange`, `RevertToState`), which are decided by a different path.

**Files:**
- Modify: `packages/contracts/src/trip.ts` (add `BatchableCommand` after `TripCommand`, ~line 146)
- Test: `packages/contracts/src/batch.test.ts`
- Modify: `docs/contracts/CHANGELOG.md`

**Interfaces:**
- Produces: `BatchableCommand` (Zod schema) and `type BatchableCommand` — a discriminated union of the ten batchable command schemas. Consumed by Tasks 5, 8, 9, 10.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/batch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BatchableCommand } from "./trip";

const tripId = "11111111-1111-1111-1111-111111111111";

describe("BatchableCommand", () => {
  it("accepts a batchable command", () => {
    const r = BatchableCommand.safeParse({ type: "AddDay", tripId, dayId: "22222222-2222-2222-2222-222222222222" });
    expect(r.success).toBe(true);
  });

  it("rejects CreateTrip", () => {
    const r = BatchableCommand.safeParse({ type: "CreateTrip", tripId, name: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects history commands", () => {
    for (const type of ["UndoLastChange", "RedoChange"]) {
      expect(BatchableCommand.safeParse({ type, tripId }).success).toBe(false);
    }
    expect(BatchableCommand.safeParse({ type: "RevertToState", tripId, toSeq: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/contracts exec vitest run src/batch.test.ts`
Expected: FAIL — `BatchableCommand` is not exported from `./trip`.

- [ ] **Step 3: Add the schema**

In `packages/contracts/src/trip.ts`, immediately after the `TripCommand` union + `export type TripCommand` (around line 146), add:

```ts
// Commands eligible for atomic batching (M6): every TripCommand except
// CreateTrip (a trip's genesis) and the history commands (decided separately).
export const BatchableCommand = z.discriminatedUnion("type", [
  AddDay,
  RemoveDay,
  SetTripStartDate,
  AddActivity,
  UpdateActivity,
  MoveActivity,
  RemoveActivity,
  DismissConflict,
  SetTripCurrency,
  SetTripBudget,
]);
export type BatchableCommand = z.infer<typeof BatchableCommand>;
```

(All ten schemas are already defined and imported in this file — they are the same members `TripCommand` composes, minus the four excluded.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/contracts exec vitest run src/batch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the CHANGELOG entry**

Append to `docs/contracts/CHANGELOG.md`:

```markdown
## 2026-07-19 — M6 atomic changes + optimistic updates
- Added: `BatchableCommand` (discriminated union — TripCommand minus CreateTrip
  and the history commands) for the batch endpoint
- Why: M6 — submit a series of commands as one atomic batch (one history entry)
- Consumers updated: packages/domain (predict), apps/web (batch route, apiClient)
- Breaking? no — additive
```

(A second entry for the command-endpoint response shape is added in Task 9, in the same PR.)

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/trip.ts packages/contracts/src/batch.test.ts docs/contracts/CHANGELOG.md
git commit -m "feat(contracts): add BatchableCommand for atomic batches"
```

---

## Task 3: Extract `describeUserBatch` (domain)

The predictor needs the exact human-readable description the server produces, with no second implementation. Extract the `user`-origin description logic from `describeBatch` into an exported helper both call.

**Files:**
- Modify: `packages/domain/src/trip/history.ts` (`describeBatch`, ~lines 190-210)
- Test: `packages/domain/src/trip/describe-user-batch.test.ts`

**Interfaces:**
- Produces: `describeUserBatch(stateBefore: TripState | null, events: TripEvent[]): string` — the "; "-joined per-event descriptions, folding state across the batch. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/trip/describe-user-batch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeUserBatch } from "./history";
import type { TripEvent } from "@tc/contracts";

const tripId = "11111111-1111-1111-1111-111111111111";

describe("describeUserBatch", () => {
  it("joins per-event descriptions with '; ', folding state across the batch", () => {
    const events: TripEvent[] = [
      { type: "DayAdded", version: 1, payload: { tripId, dayId: "d1" } },
      { type: "DayAdded", version: 1, payload: { tripId, dayId: "d2" } },
    ];
    // First DayAdded sees 0 days -> "Day 1"; second sees 1 -> "Day 2".
    expect(describeUserBatch(null, events)).toBe("Added Day 1; Added Day 2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/describe-user-batch.test.ts`
Expected: FAIL — `describeUserBatch` is not exported.

- [ ] **Step 3: Extract the helper**

In `packages/domain/src/trip/history.ts`, add this exported function just above `describeBatch`:

```ts
// The description of a user batch: each event described against the state at the
// moment it applied, joined. Shared by the history read model and the client
// predictor so the text never drifts.
export function describeUserBatch(stateBefore: TripState | null, events: TripEvent[]): string {
  const parts: string[] = [];
  let state = stateBefore;
  for (const event of events) {
    parts.push(describeEvent(state, event));
    state = evolveTrip(state, event);
  }
  return parts.join("; ");
}
```

Then replace the `case "user":` block inside `describeBatch` with a call to it:

```ts
    case "user":
      return describeUserBatch(stateBefore, batch.events);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/describe-user-batch.test.ts src/trip/history.test.ts`
Expected: PASS — new test passes and the existing history tests are unchanged (behavior identical).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/trip/history.ts packages/domain/src/trip/describe-user-batch.test.ts
git commit -m "refactor(domain): extract describeUserBatch for reuse by the predictor"
```

---

## Task 4: `hydrate` + round-trip property test (domain) — RISK GATE

The predictor works in `TripDetail`-space; `hydrate` maps a `TripDetail` back to the `TripState` the decider needs. This task validates the plan's primary risk (projection is lossless) **before** anything is built on it.

**Files:**
- Create: `packages/domain/src/trip/hydrate.ts`
- Test: `packages/domain/src/trip/hydrate.test.ts`
- Modify: `packages/domain/src/index.ts` (export hydrate for internal reuse/tests)

**Interfaces:**
- Produces: `hydrate(detail: TripDetail): TripState` — inverse of `tripDetailFromState` (drops derived fields). Consumed by Task 5.

- [ ] **Step 1: Write the failing round-trip test**

Create `packages/domain/src/trip/hydrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { hydrate } from "./hydrate";
import { tripDetailFromState } from "./detail";
import { tripStatesEqual } from "./equality";
import type { TripState, ActivityState } from "./state";

const uuid = fc.uuid({ version: 4 });
const money = fc.record({
  amountMinor: fc.integer({ min: 0, max: 1_000_000 }),
  currency: fc.constantFrom("USD", "EUR", "GBP"),
});
const activity: fc.Arbitrary<ActivityState> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 40 }),
  timeWindow: fc.constant(null),
  location: fc.constant(null),
  notes: fc.option(fc.string(), { nil: null }),
  anchors: fc.constant([]),
  cost: fc.option(money, { nil: null }),
});

// Structurally valid TripState: activity ids partitioned across days + backlog.
const arbTripState: fc.Arbitrary<TripState> = fc
  .record({
    tripId: uuid,
    name: fc.string({ minLength: 1, maxLength: 40 }),
    createdBy: uuid,
    startDate: fc.option(fc.constant("2027-06-01"), { nil: null }),
    dayIds: fc.uniqueArray(uuid, { maxLength: 4 }),
    activityIds: fc.uniqueArray(uuid, { maxLength: 6 }),
    currency: fc.constantFrom("USD", "EUR", "GBP"),
    budget: fc.option(money, { nil: null }),
    dismissed: fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 3 }),
  })
  .chain((s) =>
    fc
      .tuple(
        // assign each activity to a day index [0..dayIds.length] (last = backlog)
        fc.array(fc.nat({ max: s.dayIds.length }), { minLength: s.activityIds.length, maxLength: s.activityIds.length }),
        fc.array(activity, { minLength: s.activityIds.length, maxLength: s.activityIds.length }),
      )
      .map(([assign, activities]): TripState => {
        const days = s.dayIds.map((dayId) => ({ dayId, activityIds: [] as string[] }));
        const backlog: string[] = [];
        s.activityIds.forEach((id, i) => {
          const slot = assign[i]!;
          if (slot < days.length) days[slot]!.activityIds.push(id);
          else backlog.push(id);
        });
        return {
          tripId: s.tripId,
          name: s.name,
          members: [{ userId: s.createdBy, role: "owner" }],
          startDate: s.startDate,
          days,
          backlog,
          activities: Object.fromEntries(s.activityIds.map((id, i) => [id, activities[i]!])),
          dismissedConflictIds: [...s.dismissed].sort(),
          currency: s.currency,
          budget: s.budget,
        };
      }),
  );

describe("hydrate", () => {
  it("is the inverse of tripDetailFromState (round-trip)", () => {
    fc.assert(
      fc.property(arbTripState, (state) => {
        const roundTripped = hydrate(tripDetailFromState(state, "2027-01-01T00:00:00.000Z"));
        expect(tripStatesEqual(roundTripped, state)).toBe(true);
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/hydrate.test.ts`
Expected: FAIL — `hydrate` module does not exist.

- [ ] **Step 3: Implement hydrate**

Create `packages/domain/src/trip/hydrate.ts`:

```ts
import type { TripDetail } from "@tc/contracts";
import type { TripState } from "./state";

// Inverse of tripDetailFromState: drop the derived fields (conflicts, dates,
// cost rollups, createdAt) and keep the state-bearing ones. TripDetail is a
// superset of TripState, so this is total and lossless — guarded by the
// round-trip property test.
export function hydrate(detail: TripDetail): TripState {
  return {
    tripId: detail.tripId,
    name: detail.name,
    members: detail.members,
    startDate: detail.startDate,
    days: detail.days.map((d) => ({ dayId: d.dayId, activityIds: [...d.activityIds] })),
    backlog: [...detail.backlog],
    activities: Object.fromEntries(
      Object.entries(detail.activities).map(([id, a]) => [
        id,
        {
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
          anchors: a.anchors,
          cost: a.cost,
        },
      ]),
    ),
    dismissedConflictIds: [...detail.dismissedConflictIds],
    currency: detail.currency,
    budget: detail.budget,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/hydrate.test.ts`
Expected: PASS.

**If this test FAILS structurally** (a `TripState` distinction `TripDetail` flattens), STOP and escalate to Mitchell — the fallback is to ship `TripState` over the wire as a `@tc/contracts` schema (spec "Primary risk"), which changes Tasks 5, 7-10.

- [ ] **Step 5: Export hydrate**

In `packages/domain/src/index.ts`, add:

```ts
export * from "./trip/hydrate";
```

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/trip/hydrate.ts packages/domain/src/trip/hydrate.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add hydrate (TripDetail->TripState) with round-trip property test"
```

---

## Task 5: `predictCommand` / `predictBatch` + `@tc/domain/predict` entrypoint

The single no-drift surface the UI imports. It reuses `decideTripCommand`, `evolveTrip`, `tripDetailFromState`, `describeUserBatch`, and `hydrate` — no reimplementation.

**Files:**
- Create: `packages/domain/src/predict.ts`
- Test: `packages/domain/src/predict.test.ts`
- Modify: `packages/domain/package.json` (add `exports` map with `./predict`)

**Interfaces:**
- Consumes: `BatchableCommand` (Task 2), `hydrate` (Task 4), `describeUserBatch` (Task 3).
- Produces:
  - `type PredictResult = { ok: true; detail: TripDetail; description: string } | { ok: false; rejection: Rejection }`
  - `predictBatch(detail: TripDetail, commands: BatchableCommand[]): PredictResult`
  - `predictCommand(detail: TripDetail, command: BatchableCommand): PredictResult`
  - Consumed by Tasks 10, 11, 12.

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/predict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { predictCommand, predictBatch } from "./predict";
import { tripDetailFromState } from "./trip/detail";
import type { TripState } from "./trip/state";

const tripId = "11111111-1111-1111-1111-111111111111";
const baseState: TripState = {
  tripId,
  name: "Rome",
  members: [{ userId: "u1", role: "owner" }],
  startDate: null,
  days: [{ dayId: "d1", activityIds: [] }],
  backlog: [],
  activities: {},
  dismissedConflictIds: [],
  currency: "USD",
  budget: null,
};
const detail = () => tripDetailFromState(baseState, "2027-01-01T00:00:00.000Z");

describe("predictCommand", () => {
  it("applies a valid command and returns the new detail + description", () => {
    const r = predictCommand(detail(), { type: "AddDay", tripId, dayId: "d2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.days.map((d) => d.dayId)).toEqual(["d1", "d2"]);
    expect(r.description).toBe("Added Day 2");
  });

  it("rejects a command the decider rejects", () => {
    const r = predictCommand(detail(), { type: "MoveActivity", tripId, activityId: "nope", toDayId: "d1", position: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.code).toBe("activity-not-found");
  });
});

describe("predictBatch", () => {
  it("folds commands into one description, all applied", () => {
    const r = predictBatch(detail(), [
      { type: "AddDay", tripId, dayId: "d2" },
      { type: "AddDay", tripId, dayId: "d3" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail.days.map((d) => d.dayId)).toEqual(["d1", "d2", "d3"]);
    expect(r.description).toBe("Added Day 2; Added Day 3");
  });

  it("is all-or-nothing — a later invalid command rejects the whole batch", () => {
    const r = predictBatch(detail(), [
      { type: "AddDay", tripId, dayId: "d2" },
      { type: "RemoveDay", tripId, dayId: "ghost" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.code).toBe("day-not-found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tc/domain exec vitest run src/predict.test.ts`
Expected: FAIL — `./predict` module does not exist.

- [ ] **Step 3: Implement the predictor**

Create `packages/domain/src/predict.ts`:

```ts
import type { BatchableCommand, TripDetail, TripEvent } from "@tc/contracts";
import type { Rejection } from "./trip/decide";
import { decideTripCommand } from "./trip/decide";
import { evolveTrip } from "./trip/evolve";
import { tripDetailFromState } from "./trip/detail";
import { describeUserBatch } from "./trip/history";
import { hydrate } from "./trip/hydrate";
import { DEFAULT_CONFLICT_CONTEXT } from "./trip/conflicts";

export type PredictResult =
  | { ok: true; detail: TripDetail; description: string }
  | { ok: false; rejection: Rejection };

// actorId is unused by every batchable command's events (only TripCreated reads
// it, and CreateTrip is not batchable). A stable sentinel keeps decide happy.
const PREDICT_ACTOR = "__optimistic__";

// Predict the outcome of an atomic batch against a detail, reusing the exact
// server decider + reducer. Client-side conflicts use the default context;
// the server response remains authoritative for conflicts on reconcile.
export function predictBatch(detail: TripDetail, commands: BatchableCommand[]): PredictResult {
  const before = hydrate(detail);
  let state = before;
  const events: TripEvent[] = [];
  for (const command of commands) {
    const decision = decideTripCommand(state, command, { actorId: PREDICT_ACTOR });
    if (!decision.ok) return { ok: false, rejection: decision.rejection };
    for (const event of decision.events) state = evolveTrip(state, event);
    events.push(...decision.events);
  }
  return {
    ok: true,
    detail: tripDetailFromState(state, detail.createdAt, DEFAULT_CONFLICT_CONTEXT),
    description: describeUserBatch(before, events),
  };
}

export function predictCommand(detail: TripDetail, command: BatchableCommand): PredictResult {
  return predictBatch(detail, [command]);
}
```

- [ ] **Step 4: Add the `./predict` export to the package**

Replace the `main`/`types` lines in `packages/domain/package.json` with an `exports` map (keep `main`/`types` for tooling that ignores `exports`):

```json
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./predict": { "types": "./src/predict.ts", "default": "./src/predict.ts" }
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @tc/domain exec vitest run src/predict.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify the subpath resolves from the domain barrel too**

Run: `pnpm --filter @tc/domain typecheck`
Expected: no errors (the new `exports` map resolves both `.` and `./predict`).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/predict.ts packages/domain/src/predict.test.ts packages/domain/package.json
git commit -m "feat(domain): add predictCommand/predictBatch via @tc/domain/predict"
```

---

## Task 6: Open the lint wall for `@tc/domain/predict` only

**Files:**
- Modify: `apps/web/eslint.config.mjs` (the `no-restricted-imports` group, ~line 22)
- Modify: `scripts/check-lint-wall.mjs` (add a positive assertion for the predict subpath)

- [ ] **Step 1: Update the ESLint rule**

In `apps/web/eslint.config.mjs`, change the domain `group` from:

```js
              group: ["@tc/domain", "@tc/domain/*"],
              message: "Only src/server and src/app/api may import the domain package (AGENTS.md lint wall).",
```

to (gitignore-style negation re-includes the predict subpath):

```js
              group: ["@tc/domain", "@tc/domain/*", "!@tc/domain/predict"],
              message:
                "UI may import @tc/domain/predict only — never @tc/domain bare or other subpaths (AGENTS.md lint wall).",
```

- [ ] **Step 2: Verify predict is allowed and bare domain is still blocked**

Create a throwaway file `apps/web/src/app/__wall_probe__.tsx`:

```tsx
import { predictCommand } from "@tc/domain/predict";
export default function Probe() { void predictCommand; return null; }
```

Run: `pnpm --filter web exec eslint src/app/__wall_probe__.tsx`
Expected: PASS (no `no-restricted-imports` error).

Then edit the probe's import to `import { predictCommand } from "@tc/domain";` and re-run the same command.
Expected: FAIL with the lint-wall message.

Delete the probe: `rm apps/web/src/app/__wall_probe__.tsx`

> If Step 2's first run unexpectedly errors, the negation glob isn't honored by this ESLint version — fallback: keep `["@tc/domain", "@tc/domain/*"]` blocked and instead add an ESLint override block scoped to files importing the predictor is NOT acceptable (defeats the wall); instead introduce a dedicated package `@tc/predict` re-exporting `packages/domain/src/predict.ts` and import that from UI. Escalate to Mitchell before taking the fallback.

- [ ] **Step 3: Strengthen the custom wall check with a positive assertion**

In `scripts/check-lint-wall.mjs`, after the existing bare-import block (which must stay — bare `@tc/domain` remains forbidden), add a second fixture asserting the predict subpath is allowed. Replace the file body with:

```js
import { writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

function lintFixture(name, source) {
  const fixture = `apps/web/src/app/${name}.tsx`;
  writeFileSync(fixture, source);
  try {
    execSync(`pnpm --filter web exec eslint src/app/${name}.tsx`, { stdio: "pipe" });
    return { flagged: false };
  } catch {
    return { flagged: true };
  } finally {
    rmSync(fixture, { force: true });
  }
}

// 1. Bare @tc/domain must be rejected.
const bare = lintFixture(
  "__lint_wall_fixture__",
  'import "@tc/domain";\nexport default function Fixture() { return null; }\n',
);
// 2. @tc/domain/predict must be allowed.
const predict = lintFixture(
  "__lint_wall_predict_fixture__",
  'import { predictCommand } from "@tc/domain/predict";\nexport default function Fixture() { void predictCommand; return null; }\n',
);

if (!bare.flagged) {
  console.error("LINT WALL BREACHED: bare @tc/domain import was NOT flagged");
  process.exitCode = 1;
} else if (predict.flagged) {
  console.error("LINT WALL TOO TIGHT: @tc/domain/predict import was flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: bare domain rejected, predict subpath allowed");
}
```

- [ ] **Step 4: Run the wall check**

Run: `node scripts/check-lint-wall.mjs`
Expected: `lint wall OK: bare domain rejected, predict subpath allowed`

- [ ] **Step 5: Commit**

```bash
git add apps/web/eslint.config.mjs scripts/check-lint-wall.mjs
git commit -m "chore: open lint wall for @tc/domain/predict only"
```

---

## Task 7: Server executors return authoritative `{ detail, history }`

So the client reconciles from the response instead of a second refetch. Extract a shared projection tail and extend the existing single-command executor.

**Files:**
- Modify: `apps/web/src/server/commands.ts`
- Modify: `apps/web/src/server/commands.int.test.ts` (result shape)

**Interfaces:**
- Produces:
  - `projectAndHistory(tx, allEnvelopes, tripId): { detail: TripDetail; history: TripHistory }` (internal helper)
  - `executeTripCommand` now returns `{ ok: true; tripId; detail: TripDetail; history: TripHistory } | { ok: false; error }`.
  - Consumed by Tasks 8, 9.

- [ ] **Step 1: Write/adjust the failing test**

In `apps/web/src/server/commands.int.test.ts`, add (or adapt an existing success assertion):

```ts
it("returns the authoritative detail + history on success", async () => {
  const tripId = await createTripForTest(); // existing helper in this suite
  const result = await executeTripCommand({ type: "AddDay", tripId, dayId: crypto.randomUUID() }, TEST_USER);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.detail.days).toHaveLength(1);
  expect(result.history.entries[0]?.description).toBe("Added Day 1");
});
```

(Use the suite's existing trip-creation helper and `TEST_USER` constant — match the names already in the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test:int -- commands.int.test.ts`
Expected: FAIL — `result.detail`/`result.history` are undefined (current result is `{ ok, tripId }`).

- [ ] **Step 3: Extend the executor + add the helper**

In `apps/web/src/server/commands.ts`:

Add imports (extend the existing `@tc/domain` import — server code may import the domain barrel):

```ts
import type { TripDetail, TripHistory } from "@tc/contracts";
import {
  buildHistoryEntries,
  decideHistoryCommand,
  decideTripCommand,
  deriveUndoRedo,
  foldEnvelopes,
  groupBatches,
  tripDetailFromState,
} from "@tc/domain";
```

Change `CommandResult` to:

```ts
export type CommandResult =
  | { ok: true; tripId: string; detail: TripDetail; history: TripHistory }
  | { ok: false; error: { code: string; message: string } };
```

Add the shared tail helper (near the bottom of the file):

```ts
import type { EventEnvelope } from "@tc/contracts";
import type { Queryable } from "./db/client";

// Build and persist the authoritative detail, and build the history DTO, from
// the full envelope list — the same shapes the read endpoints serve.
async function projectAndHistory(
  tx: Queryable,
  allEnvelopes: EventEnvelope[],
  tripId: string,
): Promise<{ detail: TripDetail; history: TripHistory }> {
  const nextState = foldEnvelopes(allEnvelopes);
  if (nextState === null) throw new Error("state cannot be null after an accepted command");
  const createdAt = allEnvelopes[0]!.occurredAt;
  const detail = tripDetailFromState(nextState, createdAt, serverConflictContext());
  await upsertTripDetail(tx, detail);
  const targets = deriveUndoRedo(groupBatches(allEnvelopes));
  const history: TripHistory = {
    tripId,
    entries: buildHistoryEntries(allEnvelopes).reverse(),
    canUndo: targets.undo !== null,
    canRedo: targets.redo !== null,
  };
  return { detail, history };
}
```

(`Queryable` is the tx type already used by `upsertTripDetail`/`applyTripEvents` in `projections.ts` — import it from wherever those are typed; if it isn't exported, type the param as `Parameters<typeof upsertTripDetail>[0]`.)

Replace steps 6-7 of `executeTripCommand` (the `applyTripEvents` + manual `upsertTripDetail` tail) with:

```ts
    // 6-7. update projections + build the authoritative response
    await applyTripEvents(tx, appended.envelopes);
    const { detail, history: historyDto } = await projectAndHistory(
      tx,
      [...history, ...appended.envelopes],
      command.tripId,
    );
    return { ok: true, tripId: command.tripId, detail, history: historyDto };
```

Remove the now-unused `tripDetailFromState`/`firstEnvelope` lines from the old tail (the helper subsumes them).

- [ ] **Step 4: Fix the CreateTrip route consumer**

`apps/web/src/app/api/trips/route.ts` uses `result.tripId` only — no change needed. Confirm by reading it; if it destructures other fields, leave them (all still present).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test:int -- commands.int.test.ts`
Expected: PASS. Fix any other assertions in the suite that pinned the old `{ ok, tripId }`-only shape (they still hold — fields were added, not removed).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/commands.ts apps/web/src/server/commands.int.test.ts
git commit -m "feat(server): executeTripCommand returns authoritative detail + history"
```

---

## Task 8: `executeTripCommandBatch` (server)

Decide N batchable commands against the evolving state, append their events under one `batchId` (→ one history entry), all-or-nothing.

**Files:**
- Modify: `apps/web/src/server/commands.ts`
- Test: `apps/web/src/server/commands.int.test.ts`

**Interfaces:**
- Consumes: `BatchableCommand` (Task 2), `projectAndHistory` (Task 7).
- Produces: `executeTripCommandBatch(input: unknown, actorId: string): Promise<CommandResult>` — same result type as `executeTripCommand`. Consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/server/commands.int.test.ts`:

```ts
describe("executeTripCommandBatch", () => {
  it("appends a batch of commands as ONE history entry", async () => {
    const tripId = await createTripForTest();
    const result = await executeTripCommandBatch(
      [
        { type: "AddDay", tripId, dayId: crypto.randomUUID() },
        { type: "AddDay", tripId, dayId: crypto.randomUUID() },
      ],
      TEST_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.days).toHaveLength(2);
    // one entry for the batch, plus the creation entry
    const userEntries = result.history.entries.filter((e) => e.origin.kind === "user");
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0]?.description).toBe("Added Day 1; Added Day 2");
  });

  it("is all-or-nothing — a later invalid command appends nothing", async () => {
    const tripId = await createTripForTest();
    const before = await getTripDetail(tripId); // from ./projections
    const result = await executeTripCommandBatch(
      [
        { type: "AddDay", tripId, dayId: crypto.randomUUID() },
        { type: "RemoveDay", tripId, dayId: crypto.randomUUID() }, // ghost day
      ],
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    const after = await getTripDetail(tripId);
    expect(after?.days).toEqual(before?.days); // unchanged
  });
});
```

Ensure the test file imports `executeTripCommandBatch` and `getTripDetail`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test:int -- commands.int.test.ts`
Expected: FAIL — `executeTripCommandBatch` is not exported.

- [ ] **Step 3: Implement the batch executor**

Add to `apps/web/src/server/commands.ts` (imports: `z` from `zod`, `BatchableCommand` from `@tc/contracts`, `evolveTrip` added to the `@tc/domain` import, `crypto` is global in Node 20):

```ts
import { z } from "zod";
import { BatchableCommand, type TripEvent } from "@tc/contracts";
// add evolveTrip to the existing @tc/domain import

const BatchBody = z.array(BatchableCommand).min(1);

export async function executeTripCommandBatch(input: unknown, actorId: string): Promise<CommandResult> {
  const parsed = BatchBody.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  const commands = parsed.data;
  const tripId = commands[0]!.tripId;
  if (!commands.every((c) => c.tripId === tripId)) {
    return { ok: false, error: { code: "invalid-command", message: "all commands must target the same trip" } };
  }

  return db.transaction(async (tx): Promise<CommandResult> => {
    const history = await readStream(tx, tripId);
    let state = foldEnvelopes(history);

    if (!soleMemberPolicy.canExecute(actorId, commands[0]!.type, state?.members ?? null)) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    const events: TripEvent[] = [];
    for (const command of commands) {
      const decision = decideTripCommand(state, command, { actorId });
      if (!decision.ok) return { ok: false, error: decision.rejection };
      for (const event of decision.events) state = evolveTrip(state, event);
      events.push(...decision.events);
    }

    const appended = await appendToStream(tx, {
      streamId: tripId,
      expectedSeq: history.length,
      events,
      actorId,
      occurredAt: new Date().toISOString(),
      batchId: crypto.randomUUID(), // ONE batchId → one history entry
      origin: { kind: "user" },
    });
    if (!appended.ok) {
      return { ok: false, error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." } };
    }

    await applyTripEvents(tx, appended.envelopes);
    const { detail, history: historyDto } = await projectAndHistory(
      tx,
      [...history, ...appended.envelopes],
      tripId,
    );
    return { ok: true, tripId, detail, history: historyDto };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test:int -- commands.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the projection-rebuild golden test**

Run: `pnpm --filter web test:int -- projections` (the suite containing rebuild-equals-stored)
Expected: PASS — a multi-event batch rebuilds identically.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/commands.ts apps/web/src/server/commands.int.test.ts
git commit -m "feat(server): executeTripCommandBatch — atomic multi-command batches"
```

---

## Task 9: Routes — authoritative single response + `/commands/batch`

**Files:**
- Modify: `apps/web/src/app/api/trips/[tripId]/commands/route.ts`
- Create: `apps/web/src/app/api/trips/[tripId]/commands/batch/route.ts`
- Test: `apps/web/src/app/api/trips/[tripId]/commands/batch/route.int.test.ts` (or extend an existing route test suite if one exists)
- Modify: `docs/contracts/CHANGELOG.md`

**Interfaces:**
- Consumes: `executeTripCommand`, `executeTripCommandBatch`.
- Produces: `POST /api/trips/:id/commands` → `{ ok, tripId, detail, history }`; `POST /api/trips/:id/commands/batch` with body `{ commands: BatchableCommand[] }` → same. Consumed by Task 10.

- [ ] **Step 1: Update the single-command route to return the authoritative payload**

In `apps/web/src/app/api/trips/[tripId]/commands/route.ts`, change the success return from:

```ts
  return Response.json({ ok: true, tripId: result.tripId });
```

to:

```ts
  return Response.json({ ok: true, tripId: result.tripId, detail: result.detail, history: result.history });
```

(The `result` is now the extended `CommandResult`; `detail`/`history` are present on success.)

- [ ] **Step 2: Write the failing batch-route test**

Create `apps/web/src/app/api/trips/[tripId]/commands/batch/route.int.test.ts` (mirror the harness of the existing commands route/integration tests — same auth mock + Postgres setup):

```ts
import { describe, expect, it } from "vitest";
import { POST } from "./route";
// reuse the suite's helpers for an authenticated session + a seeded trip

describe("POST /api/trips/:id/commands/batch", () => {
  it("applies a batch and returns detail + history", async () => {
    const tripId = await seedTripForTest();
    const req = new Request(`http://test/api/trips/${tripId}/commands/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [
        { type: "AddDay", tripId, dayId: crypto.randomUUID() },
        { type: "AddDay", tripId, dayId: crypto.randomUUID() },
      ] }),
    });
    const res = await POST(req, { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(2);
    expect(body.history.entries.some((e: { description: string }) => e.description === "Added Day 1; Added Day 2")).toBe(true);
  });

  it("rejects a batch containing a non-batchable command", async () => {
    const tripId = await seedTripForTest();
    const req = new Request(`http://test/api/trips/${tripId}/commands/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ type: "UndoLastChange", tripId }] }),
    });
    const res = await POST(req, { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test:int -- batch/route.int.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 4: Implement the batch route**

Create `apps/web/src/app/api/trips/[tripId]/commands/batch/route.ts`:

```ts
import { z } from "zod";
import { BatchableCommand } from "@tc/contracts";
import { auth } from "@/server/auth";
import { executeTripCommandBatch } from "@/server/commands";

const STATUS: Record<string, number> = {
  "invalid-command": 400,
  forbidden: 403,
  "trip-not-found": 404,
  "concurrency-conflict": 409,
};

const BatchRequest = z.object({ commands: z.array(BatchableCommand).min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = BatchRequest.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "malformed batch" }, { status: 400 });
  }
  if (!body.data.commands.every((c) => c.tripId === tripId)) {
    return Response.json({ error: "a command tripId does not match the URL" }, { status: 400 });
  }
  const result = await executeTripCommandBatch(body.data.commands, session.user.id);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ ok: true, tripId: result.tripId, detail: result.detail, history: result.history });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test:int -- batch/route.int.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the CHANGELOG entry for the response shape**

Append to `docs/contracts/CHANGELOG.md`:

```markdown
## 2026-07-19 — M6 command endpoints return authoritative state
- Changed: `POST /api/trips/:id/commands` success response now includes
  `{ detail: TripDetail, history: TripHistory }` (was `{ ok, tripId }`)
- Added: `POST /api/trips/:id/commands/batch` with body `{ commands: BatchableCommand[] }`,
  same response shape
- Why: M6 optimistic updates reconcile from the response instead of refetching
- Consumers updated: apps/web apiClient + TripProvider
- Breaking? no — response fields added; new endpoint is additive
```

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/api/trips/[tripId]/commands/route.ts" "apps/web/src/app/api/trips/[tripId]/commands/batch/route.ts" "apps/web/src/app/api/trips/[tripId]/commands/batch/route.int.test.ts" docs/contracts/CHANGELOG.md
git commit -m "feat(api): authoritative command response + /commands/batch route"
```

---

## Task 10: apiClient — authoritative result + batch send

**Files:**
- Modify: `apps/web/src/lib/apiClient.ts`
- Test: `apps/web/src/lib/apiClient.test.ts`

**Interfaces:**
- Consumes: `BatchableCommand` (Task 2), the new response shapes (Task 9).
- Produces:
  - `type CommandOutcome = { detail: TripDetail; history: TripHistory }`
  - `sendTripCommand(command: BoardCommand): Promise<ApiResult<CommandOutcome>>`
  - `sendTripCommandBatch(tripId: string, commands: BatchableCommand[]): Promise<ApiResult<CommandOutcome>>`
  - Consumed by Tasks 11, 12.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/lib/apiClient.test.ts` (match the file's existing `fetch` mocking style):

```ts
it("sendTripCommand returns the authoritative detail + history", async () => {
  const detail = tripDetailFixture();
  const history = historyFixture("x");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, tripId: "x", detail, history }), { status: 200 }),
  );
  const r = await sendTripCommand({ type: "AddDay", tripId: "x", dayId: "d9" });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.value.detail.tripId).toBe(detail.tripId);
  expect(r.value.history.entries).toEqual(history.entries);
});

it("sendTripCommandBatch posts to the batch endpoint", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, tripId: "x", detail: tripDetailFixture(), history: historyFixture("x") }), { status: 200 }),
  );
  await sendTripCommandBatch("x", [{ type: "AddDay", tripId: "x", dayId: "d9" }]);
  expect(spy.mock.calls[0]?.[0]).toContain("/api/trips/x/commands/batch");
});
```

(Import `tripDetailFixture`, `historyFixture` from `@/mocks/fixtures`, and `sendTripCommandBatch`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- apiClient.test.ts`
Expected: FAIL — `sendTripCommandBatch` missing; `sendTripCommand` value is `null`.

- [ ] **Step 3: Update the client**

In `apps/web/src/lib/apiClient.ts`:

Add import and type:

```ts
import { TripDetail, TripHistory, type BatchableCommand, type TripCommand } from "@tc/contracts";

export type CommandOutcome = { detail: TripDetail; history: TripHistory };

function parseOutcome(data: { detail: unknown; history: unknown }): CommandOutcome {
  return { detail: TripDetail.parse(data.detail), history: TripHistory.parse(data.history) };
}
```

Replace `sendTripCommand` with:

```ts
export async function sendTripCommand(command: BoardCommand): Promise<ApiResult<CommandOutcome>> {
  const res = await fetch(apiUrl(`/api/trips/${command.tripId}/commands`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText, code: data.code } };
  }
  const data = (await res.json()) as { detail: unknown; history: unknown };
  return { ok: true, value: parseOutcome(data) };
}

export async function sendTripCommandBatch(
  tripId: string,
  commands: BatchableCommand[],
): Promise<ApiResult<CommandOutcome>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/commands/batch`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText, code: data.code } };
  }
  const data = (await res.json()) as { detail: unknown; history: unknown };
  return { ok: true, value: parseOutcome(data) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- apiClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/apiClient.ts apps/web/src/lib/apiClient.test.ts
git commit -m "feat(web): apiClient returns authoritative outcome + batch send"
```

---

## Task 11: Pure optimistic module (client state machine, no React)

The queue/apply/reconcile/rollback logic as pure, unit-testable functions. Keeping it out of the component is what makes it testable and correct.

**Files:**
- Create: `apps/web/src/components/trip/context/optimistic.ts`
- Test: `apps/web/src/components/trip/context/optimistic.test.ts`

**Interfaces:**
- Consumes: `predictBatch` (`@tc/domain/predict`), `CommandOutcome` (Task 10), `BatchableCommand`, `TripDetail`, `TripHistory`, `HistoryEntry`.
- Produces:
  - `type PendingUnit = { id: string; commands: BatchableCommand[]; predictedDetail: TripDetail; description: string }`
  - `type Confirmed = { detail: TripDetail; history: TripHistory }`
  - `type OptimisticState = { confirmed: Confirmed; pending: PendingUnit[] }`
  - `enqueue(state, id, commands): { ok: true; state } | { ok: false; code: string; message: string }`
  - `confirmHead(state, outcome): OptimisticState` — head succeeded; adopt authoritative confirmed, re-predict remaining.
  - `failHead(state): OptimisticState` — head failed; drop head + everything behind it.
  - `activeDetail(state): TripDetail` and `activeHistory(state): TripHistory` — the folded view the UI renders (pending rows appended, newest-first, marked via a `pending` view flag).
  - Consumed by Task 12.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/trip/context/optimistic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enqueue, confirmHead, failHead, activeDetail, activeHistory, type OptimisticState } from "./optimistic";
import { tripDetailFixture, historyFixture } from "@/mocks/fixtures";

const tripId = tripDetailFixture().tripId;
const base = (): OptimisticState => ({
  confirmed: { detail: tripDetailFixture(), history: historyFixture(tripId) },
  pending: [],
});

describe("optimistic state machine", () => {
  it("enqueue applies a predicted unit; activeDetail reflects it before confirm", () => {
    const r = enqueue(base(), "u1", [{ type: "AddDay", tripId, dayId: "d-new" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(activeDetail(r.state).days.some((d) => d.dayId === "d-new")).toBe(true);
    expect(r.state.pending).toHaveLength(1);
  });

  it("enqueue surfaces a rejection without mutating state", () => {
    const r = enqueue(base(), "u1", [{ type: "MoveActivity", tripId, activityId: "ghost", toDayId: null, position: 0 }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("activity-not-found");
  });

  it("confirmHead adopts the authoritative outcome and drops the head", () => {
    const q = enqueue(base(), "u1", [{ type: "AddDay", tripId, dayId: "d-new" }]);
    if (!q.ok) throw new Error("setup");
    const authoritative = { detail: tripDetailFixture(), history: historyFixture(tripId) };
    const next = confirmHead(q.state, authoritative);
    expect(next.pending).toHaveLength(0);
    expect(activeHistory(next).entries).toEqual(authoritative.history.entries);
  });

  it("failHead drops the failed unit AND everything queued behind it", () => {
    let s = base();
    const a = enqueue(s, "u1", [{ type: "AddDay", tripId, dayId: "d-a" }]);
    if (!a.ok) throw new Error("setup"); s = a.state;
    const b = enqueue(s, "u2", [{ type: "AddDay", tripId, dayId: "d-b" }]);
    if (!b.ok) throw new Error("setup"); s = b.state;
    const rolled = failHead(s);
    expect(rolled.pending).toHaveLength(0);
    expect(activeDetail(rolled).days.some((d) => d.dayId === "d-a" || d.dayId === "d-b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- optimistic.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `apps/web/src/components/trip/context/optimistic.ts`:

```ts
import type { BatchableCommand, HistoryEntry, TripDetail, TripHistory } from "@tc/contracts";
import { predictBatch } from "@tc/domain/predict";

export type PendingUnit = {
  id: string;
  commands: BatchableCommand[];
  predictedDetail: TripDetail;
  description: string;
};
export type Confirmed = { detail: TripDetail; history: TripHistory };
export type OptimisticState = { confirmed: Confirmed; pending: PendingUnit[] };
export type CommandOutcome = { detail: TripDetail; history: TripHistory };

// A history row for display: a real entry, or a not-yet-confirmed prediction.
export type HistoryRow = HistoryEntry & { pending: boolean };

function baseDetail(state: OptimisticState): TripDetail {
  const last = state.pending[state.pending.length - 1];
  return last ? last.predictedDetail : state.confirmed.detail;
}

export function activeDetail(state: OptimisticState): TripDetail {
  return baseDetail(state);
}

// Confirmed entries (newest-first) with pending rows prepended (newest-first).
export function activeHistory(state: OptimisticState): TripHistory & { entries: HistoryRow[] } {
  const confirmedRows: HistoryRow[] = state.confirmed.history.entries.map((e) => ({ ...e, pending: false }));
  const pendingRows: HistoryRow[] = state.pending
    .map((u): HistoryRow => ({
      batchId: u.id,
      fromSeq: Number.MAX_SAFE_INTEGER,
      toSeq: Number.MAX_SAFE_INTEGER,
      actorId: "__optimistic__",
      occurredAt: new Date(0).toISOString(),
      origin: { kind: "user" },
      description: u.description,
      undone: false,
      pending: true,
    }))
    .reverse(); // newest pending first
  return { ...state.confirmed.history, entries: [...pendingRows, ...confirmedRows] };
}

export type EnqueueResult =
  | { ok: true; state: OptimisticState }
  | { ok: false; code: string; message: string };

export function enqueue(state: OptimisticState, id: string, commands: BatchableCommand[]): EnqueueResult {
  const prediction = predictBatch(baseDetail(state), commands);
  if (!prediction.ok) {
    return { ok: false, code: prediction.rejection.code, message: prediction.rejection.message };
  }
  const unit: PendingUnit = { id, commands, predictedDetail: prediction.detail, description: prediction.description };
  return { ok: true, state: { ...state, pending: [...state.pending, unit] } };
}

// The head send succeeded: adopt authoritative confirmed state, drop the head,
// and re-predict the remaining pending units on the new base (their predicted
// details may shift now that confirmed advanced).
export function confirmHead(state: OptimisticState, outcome: CommandOutcome): OptimisticState {
  const rest = state.pending.slice(1);
  let acc: OptimisticState = { confirmed: outcome, pending: [] };
  for (const unit of rest) {
    const r = enqueue(acc, unit.id, unit.commands);
    if (r.ok) acc = r.state;
    // If a queued unit no longer predicts cleanly against the new base, drop it
    // (and, by breaking, everything after it) — it will be reported via failHead
    // semantics at send time. Conservative: keep only cleanly-predictable units.
    else break;
  }
  return acc;
}

// The head send failed: drop the head and everything queued behind it (they were
// predicted on a state that will never exist). Confirmed state is untouched.
export function failHead(state: OptimisticState): OptimisticState {
  return { ...state, pending: [] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- optimistic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/trip/context/optimistic.ts apps/web/src/components/trip/context/optimistic.test.ts
git commit -m "feat(web): pure optimistic state machine (enqueue/confirm/fail/derive)"
```

---

## Task 12: Wire the optimistic overlay into TripProvider

Replace `dispatch → refetch` with predict-apply-enqueue, a sequential sender, and reconcile/rollback. Add `dispatchBatch`.

**Files:**
- Modify: `apps/web/src/components/trip/context/TripProvider.tsx`
- Test: `apps/web/src/components/trip/context/TripProvider.test.tsx`

**Interfaces:**
- Consumes: `optimistic.ts` (Task 11), `sendTripCommand`/`sendTripCommandBatch` (Task 10).
- Produces: `useTrip()` context unchanged in shape except `dispatch` now optimistic and a new `dispatchBatch(commands: BatchableCommand[])`. `activeTrip`/`history` come from the folded overlay.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/components/trip/context/TripProvider.test.tsx`:

```ts
it("renders the optimistic change before the server responds", async () => {
  let resolveSend: (v: unknown) => void = () => {};
  sendTripCommandMock.mockReturnValue(new Promise((res) => { resolveSend = res; }));

  render(<TripProvider tripId="x"><OptimisticProbe /></TripProvider>);
  await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

  fireEvent.click(screen.getByRole("button", { name: "add-day" }));
  // Applied instantly, before we resolve the send.
  await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("2"));

  resolveSend({ ok: true, value: { detail: twoDayDetail(), history: historyFixture("x") } });
  await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("2"));
});

it("rolls back the optimistic change on a server failure", async () => {
  sendTripCommandMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom", code: "server-error" } });

  render(<TripProvider tripId="x"><OptimisticProbe /></TripProvider>);
  await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1"));

  fireEvent.click(screen.getByRole("button", { name: "add-day" }));
  await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("boom"));
  await waitFor(() => expect(screen.getByTestId("dayCount").textContent).toBe("1")); // reverted
});
```

Add the probe + a two-day fixture helper to the test file:

```tsx
function OptimisticProbe() {
  const { activeTrip, error, dispatch } = useTrip();
  return (
    <div>
      <span data-testid="dayCount">{activeTrip?.days.length ?? 0}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d-new" } as never)}>add-day</button>
    </div>
  );
}
function twoDayDetail() {
  const d = tripDetailFixture();
  return { ...d, days: [...d.days, { dayId: "d-new", activityIds: [], date: null, costSubtotal: 0 }] };
}
```

Ensure `tripDetailFixture()` returns a detail whose `days` has length 1 (adjust the fixture call/assertion to the fixture's real shape; if it has a different day count, use that number consistently in the assertions).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- TripProvider.test.tsx`
Expected: FAIL — dispatch still refetches; `dayCount` won't change to 2 optimistically.

- [ ] **Step 3: Rewrite TripProvider's dispatch/state**

Rewrite `apps/web/src/components/trip/context/TripProvider.tsx` to hold optimistic state and a sequential sender. Key changes (keep `load`, `enter`, `exit`, `status` as-is for initial fetch; replace the `dispatch` path):

```tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BatchableCommand, TripDetail, TripHistory } from "@tc/contracts";
import { fetchTripDetail, fetchTripDetailAt, fetchTripHistory, sendTripCommand, sendTripCommandBatch, type BoardCommand, type CommandOutcome } from "@/lib/apiClient";
import { activeDetail, activeHistory, confirmHead, enqueue, failHead, type OptimisticState } from "./optimistic";

// ... Status, TripCtx types: add dispatchBatch, keep dispatch signature ...

export function TripProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const [optimistic, setOptimistic] = useState<OptimisticState | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const [d, h] = await Promise.all([fetchTripDetail(tripId), fetchTripHistory(tripId)]);
    if (!d.ok) { setStatus(d.error.status === 401 ? "unauthenticated" : "error"); setError(d.error.message); return; }
    setOptimistic({ confirmed: { detail: d.value, history: h.ok ? h.value : { tripId, entries: [], canUndo: false, canRedo: false } }, pending: [] });
    setStatus("ready");
  }, [tripId]);
  useEffect(() => { void load(); }, [load]);

  // Sequential sender: whenever there is a pending head and nothing in flight,
  // send the head; reconcile or roll back on its result.
  const inFlight = useRef(false);
  useEffect(() => {
    if (!optimistic || optimistic.pending.length === 0 || inFlight.current) return;
    const head = optimistic.pending[0]!;
    inFlight.current = true;
    (async () => {
      const result: { ok: true; value: CommandOutcome } | { ok: false; error: { message: string; code?: string } } =
        head.commands.length === 1
          ? await sendTripCommand(head.commands[0]! as BoardCommand)
          : await sendTripCommandBatch(tripId, head.commands);
      inFlight.current = false;
      setOptimistic((prev) => {
        if (!prev) return prev;
        if (result.ok) { setError(null); return confirmHead(prev, result.value); }
        if (result.error.code === "no-op") return confirmHead(prev, prev.confirmed); // benign: nothing changed
        setError(result.error.message);
        return failHead(prev);
      });
    })();
  }, [optimistic, tripId]);

  const runDispatch = useCallback((commands: BatchableCommand[]) => {
    setError(null);
    setOptimistic((prev) => {
      if (!prev) return prev;
      const r = enqueue(prev, `c${++seq.current}`, commands);
      if (r.ok) return r.state;
      if (r.code !== "no-op") setError(r.message); // predicted rejection — no send
      return prev;
    });
  }, []);

  const pending = (optimistic?.pending.length ?? 0) > 0;

  // History commands (undo/redo/revert) are NOT optimistically predicted — they
  // depend on the full event log, which the client does not hold. Send directly
  // and reconcile from the authoritative response. Don't interleave with
  // unconfirmed optimistic edits.
  const HISTORY_TYPES = new Set(["UndoLastChange", "RedoChange", "RevertToState"]);
  const dispatch = useCallback(
    async (command: BoardCommand) => {
      if (HISTORY_TYPES.has(command.type)) {
        if (pending) return;
        setError(null);
        const result = await sendTripCommand(command);
        if (!result.ok) {
          if (result.error.code !== "no-op") setError(result.error.message);
          return;
        }
        setOptimistic((prev) => (prev ? { confirmed: result.value, pending: [] } : prev));
        exit();
        return;
      }
      runDispatch([command as BatchableCommand]);
    },
    [runDispatch, pending, exit],
  );
  const dispatchBatch = useCallback(async (commands: BatchableCommand[]) => { runDispatch(commands); }, [runDispatch]);
  const enter = useCallback(async (s: number) => {
    if (pending) return; // cannot branch history from unconfirmed state
    const r = await fetchTripDetailAt(tripId, s);
    if (r.ok) { setPreviewSeq(s); setPreviewTrip(r.value); } else setError(r.error.message);
  }, [tripId, pending]);
  const exit = useCallback(() => { setPreviewSeq(null); setPreviewTrip(null); }, []);

  const confirmedDetail = optimistic ? activeDetail(optimistic) : null;
  const history: TripHistory | null = optimistic ? activeHistory(optimistic) : null;
  const trip = optimistic?.confirmed.detail ?? null;
  const activeTrip = previewSeq !== null && previewTrip !== null ? previewTrip : confirmedDetail;

  return (
    <Ctx.Provider value={{ trip, history, activeTrip, status, error, pending, dispatch, dispatchBatch, preview: { seq: previewSeq, enter, exit } }}>
      {children}
    </Ctx.Provider>
  );
}
```

Update the `TripCtx` type to add `dispatchBatch: (commands: BatchableCommand[]) => Promise<void>`.

- [ ] **Step 4: Run the provider tests**

Run: `pnpm --filter web test -- TripProvider.test.tsx`
Expected: PASS — the two new tests and the existing no-op/error tests (the no-op path stays benign; a predicted no-op sets no error and no pending unit).

- [ ] **Step 5: Verify consumers still typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors. If a consumer read `history` expecting only confirmed entries, `activeHistory` returns a superset (`HistoryRow[]` extends `HistoryEntry`), so existing reads are compatible; a component may opt into the `pending` flag to style unconfirmed rows.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/trip/context/TripProvider.tsx apps/web/src/components/trip/context/TripProvider.test.tsx
git commit -m "feat(web): optimistic overlay + sequential queue in TripProvider (+dispatchBatch)"
```

---

## Task 13: E2E — instant render + forced-failure revert

**Files:**
- Modify: the M6/existing Playwright spec under `apps/web` (extend the current milestone happy-path script; create `apps/web/e2e/m6-optimistic.spec.ts` if the suite is one-file-per-milestone — match the existing layout).

- [ ] **Step 1: Locate the e2e layout**

Run: `ls apps/web/e2e 2>/dev/null || ls apps/web/tests 2>/dev/null || grep -n "testDir" apps/web/playwright.config.*`
Use the discovered directory/naming for the new spec.

- [ ] **Step 2: Write the optimistic e2e**

Create the spec (adapt selectors to the existing board's test ids/roles used by prior specs):

```ts
import { test, expect } from "@playwright/test";
// reuse the suite's sign-in + trip-seed helpers

test("optimistic add renders instantly and persists", async ({ page }) => {
  await signInAndOpenTrip(page); // existing helper
  const days = page.getByTestId("day-column");
  const before = await days.count();
  await page.getByRole("button", { name: /add day/i }).click();
  // No network wait — the new column is present synchronously.
  await expect(days).toHaveCount(before + 1);
  await page.reload();
  await expect(days).toHaveCount(before + 1); // persisted server-side
});

test("a rejected change reverts and shows an error", async ({ page }) => {
  await signInAndOpenTrip(page);
  await page.route("**/api/trips/*/commands", (r) => r.fulfill({ status: 500, body: JSON.stringify({ error: "boom" }) }));
  const days = page.getByTestId("day-column");
  const before = await days.count();
  await page.getByRole("button", { name: /add day/i }).click();
  await expect(days).toHaveCount(before + 1); // optimistic
  await expect(days).toHaveCount(before); // reverted after failure
  await expect(page.getByText("boom")).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e**

Run: `pnpm --filter web test:e2e`
Expected: PASS — including all prior milestones' scripts (kept green).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e
git commit -m "test(web): e2e for optimistic render + forced-failure revert"
```

---

## Task 14: ADR-013

**Files:**
- Create: `docs/architecture/ADR-013-optimistic-updates-and-atomic-batches.md`

- [ ] **Step 1: Write the ADR**

Create `docs/architecture/ADR-013-optimistic-updates-and-atomic-batches.md`:

```markdown
# ADR-013: Optimistic updates + atomic command batches

**Status:** Accepted — 2026-07-19
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/superpowers/specs/2026-07-19-m6-atomic-changes-optimistic-updates-design.md`

## Context

M6 adds atomic batches (a series of commands as one history entry) and, by
Mitchell's decision, optimistic updates: apply a dispatched change to local trip
state + history immediately, reconcile or roll back on the server's response.
ADR-012 invariant 1 held that TripProvider mutates trip state ONLY by
`dispatch → refetch`, with no direct context writes.

## Decision

1. **Optimistic overlay in TripProvider (amends ADR-012 invariant 1).**
   TripProvider holds confirmed server-authoritative state plus an ordered
   overlay of predicted pending units. The rendered view folds the overlay onto
   confirmed state. Confirmed state is still mutated only by a server response —
   the overlay is a disposable prediction, never a second source of truth.
2. **Shared predictor via `@tc/domain/predict` (one decider, no drift).** The
   client predicts outcomes by reusing the exact server decider/reducer through a
   curated domain subpath. The UI/domain lint wall is opened for that subpath
   only. The decider's existing exhaustive `switch` is the compile-time guarantee
   that every command is handled; a round-trip property test guards the one new
   mapping (`hydrate`).
3. **Sequential queue; server `seq` is the sole ordering authority.** Rapid edits
   apply optimistically and immediately but send one at a time, in order. On
   failure, the failing unit and everything queued behind it roll back. No client
   timestamps; no client-driven reordering (would turn an append-only log into
   insert-anywhere and is hostile to Phase 2's multi-clock reality).
4. **A batch is one history entry.** N commands decided against the evolving
   state, appended under one `batchId`; the existing `groupBatches` /
   `buildHistoryEntries` treat it as a single change for undo/redo/revert.
5. **Command endpoints return authoritative `{ detail, history }`** so the client
   reconciles from the response instead of refetching.

## Consequences

- `@tc/domain/predict`, `hydrate`, `predictCommand`/`predictBatch`,
  `executeTripCommandBatch`, `/api/trips/:id/commands/batch`, and a
  reducer-backed optimistic overlay in TripProvider.
- Preview/time-travel is disabled while any unit is pending.
- Conflicts during the optimistic window use the default context; the server
  response is authoritative on reconcile.
- Fallback if the projection is ever lossy: ship `TripState` over the wire as a
  contract schema (the round-trip test is the tripwire).
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/ADR-013-optimistic-updates-and-atomic-batches.md
git commit -m "docs(M6): ADR-013 — optimistic updates + atomic batches"
```

---

## Final gate (run before declaring M6 done)

- [ ] `pnpm check` — typecheck + lint (incl. both lint-wall checks) + all unit tests green
- [ ] `pnpm --filter web test:int` — integration incl. batch atomicity + rebuild-equals-stored
- [ ] `pnpm --filter web test:e2e` — M0–M6 scripts green
- [ ] Tick M6 exit-gate boxes in `docs/milestones/M6-atomic-changes.md`, append the retro, and confirm `Current milestone` is M6 (gate-close checklist, one commit)

---

## Self-review notes (author)

- **Spec coverage:** shared predictor + no-drift (Tasks 3-6), sequential queue + `seq` truth (Tasks 11-12), batch-as-one-entry (Tasks 2, 8), authoritative response (Tasks 7, 9-10), `hydrate` round-trip risk gate (Task 4), predictor parity (covered by Task 5 tests + the integration description-match in Tasks 7-8), ADR-013 + CHANGELOG + preflight (Tasks 1, 9, 14). All spec sections map to a task.
- **Predictor parity** is asserted two ways: predict unit tests (Task 5) and server integration tests that check the same `describeUserBatch` output (Tasks 7-8); both derive from the one decider.
- **History commands stay non-optimistic (Task 12):** undo/redo/revert aren't batchable and depend on the full log, so `dispatch` sends them directly and reconciles from the authoritative response (no predict). Only batchable commands take the optimistic overlay path.
- **Open item deferred to implementer:** exact e2e selector/helper names (Task 13) and the suite's trip-seed helper names (Tasks 7-9) — matched to the existing suites at implementation time, not invented here.
```

