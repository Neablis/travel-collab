# M9 Plan 1 — The step quota holds under concurrency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close KI-94 (and KI-97 with it) by reserving a request's full step budget at admission and refunding the unused part after it settles, so concurrent requests can no longer overshoot the global step ceiling together.

**Architecture:** `quota.ts` today pre-authorises **one** step at admission and settles the rest post-hoc, because the real step count does not exist until the turn ends. N requests in flight have therefore each charged 1, so they can jointly pass a global ceiling before any settles. The fix reserves `AI_MAX_STEPS_PER_REQUEST` atomically at admission and releases `reserved − actual` afterwards. That requires a **refund primitive the module deliberately does not have**, added here behind a reservation handle so it is not a free-floating decrement.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (`rate_limit_counters`), Vitest.

**Spec:** `docs/specs/2026-09-15-M9-assistant-and-new-trip-design.md` §5. Milestone: `docs/milestones/M9-ai-planning-partner.md` (gate box "The step ceiling holds under concurrency — KI-94").

**This is plan 1 of 8.** The others (transcript, theme vocabulary, four-turn new trip, grounding, draft trip, escalation, gate close) are separate documents. Plan 7 (escalation) depends on this one: escalation adds a charged step, and riding the existing hole would widen it. Nothing else depends on this plan.

## Global Constraints

- **`bump`'s clamp must not be relaxed.** `Math.max(1, Math.trunc(...))` exists so no caller can decrement usage. The refund is a **separate method**, never a negative `amount`.
- **A refund larger than its reservation must be impossible.** Release is reachable only through a reservation handle, and the SQL clamps the result at 0.
- **The refund must be conditional on the reserved window.** A fixed window can roll between reserve and release; a naive refund subtracts from a fresh window's count.
- **Reserving without reconciling is forbidden.** It would charge every one-step answer the full 32 and recreate KI-67 in reverse.
- `AI_MAX_STEPS_PER_REQUEST = 32` (`quota.ts:171`). Do not hard-code 32 anywhere else; import it.
- `settleAiSteps` **never refuses and never throws.** The work is already paid for. Releasing keeps that property — a failed release loses a refund, which is safe in the strict direction.
- **A test is not done until you have seen it fail for your reason** (CLAUDE.md rule 3). Every task below runs the test before the implementation exists.
- **Scoped change:** run the `minimal-check-subset` skill's output, not `pnpm check`. No e2e in this plan — nothing user-visible changes.

---

### Task 1: Prove the hole exists

A failing test that admits more concurrent requests than the global step ceiling can hold, and asserts the last one is refused. It fails today because each admission charges 1.

**Files:**
- Modify: `apps/web/src/server/quota.test.ts`

**Interfaces:**
- Consumes: `consumeQuota`, `aiStepQuotas`, `QuotaCounters` from `./quota` (all existing exports, unchanged signatures).
- Produces: `makeFakeCounters()` — a test helper other tasks reuse. Returns `{ counters: QuotaCounters; hitsFor(bucket: string): number }`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * An in-memory `QuotaCounters`. Shared by every test below: the policy logic is
 * what is under test, and a database would only add latency and flakiness.
 */
function makeFakeCounters(): { counters: QuotaCounters; hitsFor: (bucket: string) => number } {
  const rows = new Map<string, { windowStart: number; hits: number }>();
  return {
    counters: {
      async bump(bucket, windowStart, amount = 1) {
        const by = Math.max(1, Math.trunc(Number.isFinite(amount) ? amount : 1));
        const row = rows.get(bucket);
        if (row === undefined || windowStart.getTime() > row.windowStart) {
          rows.set(bucket, { windowStart: windowStart.getTime(), hits: by });
          return by;
        }
        row.hits += by;
        return row.hits;
      },
    },
    hitsFor: (bucket) => rows.get(bucket)?.hits ?? 0,
  };
}

it("refuses the request that would take the global step ceiling past its limit, even in flight", async () => {
  const policies = aiStepQuotas();
  const daily = dailyPolicy(policies);
  const { counters } = makeFakeCounters();
  const now = new Date("2026-09-15T12:00:00.000Z");

  // One more request than the global ceiling can fund at the full budget.
  const admissions = Math.floor(daily.global / AI_MAX_STEPS_PER_REQUEST) + 1;

  const decisions = await Promise.all(
    Array.from({ length: admissions }, (_unused, i) =>
      consumeQuota(policies, `user-${i}`, counters, now),
    ),
  );

  // Distinct users, so the per-user ceiling is untouched: the global one is the
  // only thing that can refuse here.
  expect(decisions.filter((d) => d.allowed).length).toBe(admissions - 1);
  const refused = decisions.find((d) => !d.allowed);
  expect(refused).toEqual(expect.objectContaining({ allowed: false, reason: "global" }));
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `pnpm --filter web test -- quota.test.ts -t "past its limit"`

Expected: FAIL. Every admission is allowed, because each charges 1 rather than the budget, so the received count is `admissions` and the expected is `admissions - 1`. **If it fails for any other reason — a missing import, a helper name clash — fix that and re-run until the failure is the assertion above.**

- [ ] **Step 3: Add the imports the test needs**

```ts
import { AI_MAX_STEPS_PER_REQUEST, aiStepQuotas, consumeQuota, dailyPolicy, type QuotaCounters } from "./quota";
```

`AI_MAX_STEPS_PER_REQUEST` is currently module-private (`quota.ts:171`). Export it:

```ts
export const AI_MAX_STEPS_PER_REQUEST = 32;
```

- [ ] **Step 4: Re-run and confirm the failure is still the assertion**

Run: `pnpm --filter web test -- quota.test.ts -t "past its limit"`
Expected: FAIL on the `toBe(admissions - 1)` assertion. Leave it red — Task 3 turns it green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/quota.test.ts apps/web/src/server/quota.ts
git commit -m "test(quota): a failing test for KI-94's concurrent global-ceiling overshoot

Admits one more concurrent request than the global step ceiling can fund at
the full budget and asserts the last is refused. Red today: admission charges
one step, so every request passes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The refund primitive

`release` on `QuotaCounters`, window-conditional and floored at zero.

**Files:**
- Modify: `apps/web/src/server/quota.ts` (the `QuotaCounters` interface at `:56-67`, and `pgCounters` at `:483-513`)
- Modify: `apps/web/src/server/quota.test.ts`

**Interfaces:**
- Consumes: `makeFakeCounters()` from Task 1 — extend it with `release`.
- Produces: `QuotaCounters.release(bucket: string, windowStart: Date, amount: number): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("release subtracts within the reserved window", async () => {
  const { counters, hitsFor } = makeFakeCounters();
  const w = new Date("2026-09-15T12:00:00.000Z");
  await counters.bump("b", w, 32);
  await counters.release("b", w, 30);
  expect(hitsFor("b")).toBe(2);
});

it("release does nothing once the window has rolled", async () => {
  const { counters, hitsFor } = makeFakeCounters();
  const w1 = new Date("2026-09-15T12:00:00.000Z");
  const w2 = new Date("2026-09-15T13:00:00.000Z");
  await counters.bump("b", w1, 32);
  await counters.bump("b", w2, 5); // window rolls; count restarts at 5
  await counters.release("b", w1, 30); // refund against the OLD window
  expect(hitsFor("b")).toBe(5);
});

it("release never drives a counter below zero", async () => {
  const { counters, hitsFor } = makeFakeCounters();
  const w = new Date("2026-09-15T12:00:00.000Z");
  await counters.bump("b", w, 3);
  await counters.release("b", w, 999);
  expect(hitsFor("b")).toBe(0);
});

it("release ignores a negative or fractional amount", async () => {
  const { counters, hitsFor } = makeFakeCounters();
  const w = new Date("2026-09-15T12:00:00.000Z");
  await counters.bump("b", w, 10);
  await counters.release("b", w, -5);
  await counters.release("b", w, 1.7);
  expect(hitsFor("b")).toBe(9); // -5 ignored, 1.7 truncated to 1
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter web test -- quota.test.ts -t "release"`
Expected: FAIL — `counters.release is not a function`, four times.

- [ ] **Step 3: Add `release` to the interface**

In `quota.ts`, inside `QuotaCounters` (after `bump`):

```ts
  /**
   * Give back `amount` of a reservation on `bucket`, **only if the row is still
   * in `windowStart`'s window**. A rolled window is left alone: the count there
   * belongs to a window this reservation never charged, and subtracting from it
   * would refund someone else's usage.
   *
   * Separate from `bump` rather than a negative `amount`, deliberately.
   * `bump` clamps to a positive integer so that no caller can decrement a
   * counter; relaxing that clamp would let an actor drain their own usage,
   * which is a worse hole than KI-94's. This method can only ever subtract,
   * never below zero, and is reachable only through a `StepReservation`.
   */
  release(bucket: string, windowStart: Date, amount: number): Promise<void>;
```

- [ ] **Step 4: Implement it in the fake, in the test file**

Inside `makeFakeCounters`'s returned `counters`, after `bump`:

```ts
      async release(bucket, windowStart, amount) {
        const by = Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0));
        const row = rows.get(bucket);
        if (row === undefined || row.windowStart !== windowStart.getTime()) return;
        row.hits = Math.max(0, row.hits - by);
      },
```

- [ ] **Step 5: Implement it in `pgCounters`**

In `quota.ts`, inside the object `pgCounters` returns, after `bump`:

```ts
    async release(bucket, windowStart, amount) {
      const by = Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0));
      if (by === 0) return;
      await database
        .update(rateLimitCounters)
        .set({ hits: sql`greatest(${rateLimitCounters.hits} - ${by}, 0)` })
        .where(
          and(
            eq(rateLimitCounters.bucket, bucket),
            // The window guard. `=` not `>=`: a refund is valid only against
            // the exact window it reserved in.
            eq(rateLimitCounters.windowStart, windowStart),
          ),
        );
    },
```

`and`, `eq` and `sql` are already imported from `drizzle-orm` at `quota.ts:25` — no import change is needed.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter web test -- quota.test.ts -t "release"`
Expected: PASS, four tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/server/quota.ts apps/web/src/server/quota.test.ts
git commit -m "feat(quota): a window-conditional refund primitive

release() subtracts from a counter only while it is still in the window the
reservation charged, floors at zero, and ignores negative or fractional
amounts. Separate from bump() so bump's positive-integer clamp — which is what
stops a caller decrementing usage — stays intact.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Reserve at admission, reconcile after

**Files:**
- Modify: `apps/web/src/server/quota.ts` (`consumeQuota` at `:289`, `settleAiSteps` at `:371`)
- Modify: `apps/web/src/server/ai/handleAskRequest.ts` (the admission charge and the settle call)
- Modify: `apps/web/src/server/quota.test.ts`

**Interfaces:**
- Consumes: `QuotaCounters.release` (Task 2); the failing test from Task 1.
- Produces:
  - `export interface StepReservation { readonly policies: readonly QuotaPolicy[]; readonly userId: string; readonly reserved: number; readonly windowStarts: ReadonlyMap<string, Date>; }`
  - `export async function reserveAiSteps(policies: readonly QuotaPolicy[], userId: string, counters?: QuotaCounters, now?: Date): Promise<{ decision: QuotaDecision; reservation: StepReservation | null }>`
  - `settleAiSteps` changes shape to `(reservation: StepReservation, steps: number, counters?: QuotaCounters) => Promise<void>`.

- [ ] **Step 1: Write the failing reconciliation test**

```ts
it("refunds the unused budget, so a one-step answer costs one step", async () => {
  const policies = aiStepQuotas();
  const daily = dailyPolicy(policies);
  const { counters, hitsFor } = makeFakeCounters();
  const now = new Date("2026-09-15T12:00:00.000Z");

  const { decision, reservation } = await reserveAiSteps(policies, "user-a", counters, now);
  expect(decision.allowed).toBe(true);
  expect(hitsFor(`${daily.name}:global`)).toBe(AI_MAX_STEPS_PER_REQUEST);

  await settleAiSteps(reservation!, 1, counters);
  expect(hitsFor(`${daily.name}:global`)).toBe(1);
  expect(hitsFor(`${daily.name}:user:user-a`)).toBe(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web test -- quota.test.ts -t "refunds the unused budget"`
Expected: FAIL — `reserveAiSteps is not exported`.

- [ ] **Step 3: Implement `reserveAiSteps`**

In `quota.ts`, after `consumeQuota`:

```ts
/**
 * What a reservation charged, and where. The `windowStarts` map is the whole
 * reason this is a value rather than a number: a release must target the exact
 * window its reservation charged, and by the time a turn ends the clock may
 * have moved into the next one.
 */
export interface StepReservation {
  readonly policies: readonly QuotaPolicy[];
  readonly userId: string;
  readonly reserved: number;
  readonly windowStarts: ReadonlyMap<string, Date>;
}

/**
 * Charge the FULL step budget up front, then let `settleAiSteps` give back what
 * the turn did not use (KI-94).
 *
 * The old shape charged one step and settled the rest afterwards, which bounded
 * a single actor's overshoot to one budget but bounded nothing under
 * concurrency: N requests in flight had each charged 1, so they could jointly
 * pass the global ceiling before any of them settled. Reserving the maximum
 * makes in-flight exposure exactly the reservation.
 *
 * Returns `reservation: null` whenever the decision refuses, so a caller cannot
 * settle against a turn that never ran.
 */
export async function reserveAiSteps(
  policies: readonly QuotaPolicy[],
  userId: string,
  counters: QuotaCounters = pgCounters(),
  now: Date = new Date(),
): Promise<{ decision: QuotaDecision; reservation: StepReservation | null }> {
  const windowStarts = new Map<string, Date>();
  for (const policy of policies) {
    const windowStart = windowStartFor(policy, now);
    const retryAfterSeconds = secondsUntilWindowEnd(policy, windowStart, now);
    windowStarts.set(policy.name, windowStart);

    let userCount: number;
    let globalCount: number;
    try {
      userCount = await counters.bump(
        `${policy.name}:user:${userId}`,
        windowStart,
        AI_MAX_STEPS_PER_REQUEST,
      );
      globalCount = await counters.bump(
        `${policy.name}:global`,
        windowStart,
        AI_MAX_STEPS_PER_REQUEST,
      );
    } catch {
      // Fail closed, exactly as `consumeQuota` does: a broken counter store must
      // not become an open door.
      return { decision: { allowed: false, reason: "unavailable", retryAfterSeconds }, reservation: null };
    }

    if (userCount > policy.perUser) {
      return { decision: { allowed: false, reason: "user", retryAfterSeconds }, reservation: null };
    }
    if (globalCount > policy.global) {
      return { decision: { allowed: false, reason: "global", retryAfterSeconds }, reservation: null };
    }
  }

  return {
    decision: { allowed: true },
    reservation: { policies, userId, reserved: AI_MAX_STEPS_PER_REQUEST, windowStarts },
  };
}
```

- [ ] **Step 4: Rewrite `settleAiSteps` to reconcile**

Replace the body of `settleAiSteps` (`quota.ts:371`). Keep its doc comment's "never refuses and never throws" paragraph, and replace the "how far it can be overshot" paragraph with the note in Step 6.

```ts
export async function settleAiSteps(
  reservation: StepReservation,
  steps: number,
  counters: QuotaCounters = pgCounters(),
): Promise<void> {
  const used = Number.isFinite(steps)
    ? Math.min(Math.max(Math.trunc(steps), 1), reservation.reserved)
    : reservation.reserved;
  const unused = reservation.reserved - used;
  if (unused <= 0) return;

  for (const policy of reservation.policies) {
    const windowStart = reservation.windowStarts.get(policy.name);
    if (windowStart === undefined) continue;
    try {
      await counters.release(`${policy.name}:user:${reservation.userId}`, windowStart, unused);
      await counters.release(`${policy.name}:global`, windowStart, unused);
    } catch {
      // A completed request is never failed over a counter. Losing a refund
      // over-counts, which errs toward refusing the NEXT request rather than
      // admitting it — the safe direction.
    }
  }
}
```

Note the inversion worth calling out in review: a non-finite `steps` now settles at the **full** reservation rather than returning early. Unknown usage keeps the conservative charge.

- [ ] **Step 5: Update the call site**

In `apps/web/src/server/ai/handleAskRequest.ts`, the admission stage calls `consumeQuota(aiStepQuotas(...), ...)` and the post-turn path calls `settleAiSteps(...)`. Change the admission call to `reserveAiSteps(...)`, carry the returned `reservation` to where the turn ends, and pass it to `settleAiSteps` in place of `(policies, userId, steps)`. Refuse exactly as before when `decision.allowed` is false — `quotaRefusal(decision)` is unchanged.

Leave the **request-count** layer (`aiQuotas`) alone. It charges 1 per request, which is correct: it meters calls, not cost.

- [ ] **Step 6: Correct the stale comment**

`settleAiSteps`'s doc comment says *"Filed as KI-78"*. That entry was renumbered to **KI-94** on merge (five branches allocated KI-77/78 the same night). Replace the whole "How far it can be overshot" paragraph with:

```
 * **In-flight exposure is now exactly the reservation.** `reserveAiSteps`
 * charges the full budget at admission and this releases what the turn did not
 * use, so N concurrent requests can hold at most N × budget and the global
 * ceiling is asserted against the real figure rather than against N × 1.
 * Closes KI-94 (filed as KI-78 and renumbered on merge) and KI-97 with it.
```

- [ ] **Step 7: Run both tests and confirm green**

Run: `pnpm --filter web test -- quota.test.ts quota.property.test.ts quota.int.test.ts`

Expected: PASS — including Task 1's concurrency test, which should now refuse the last admission. **Run all three quota suites, not just the unit one:** `quota.property.test.ts` drives the counter invariants (the `greatest(...)` window monotonicity guard `release` now sits beside) and `quota.int.test.ts` exercises the real Postgres path, which is the only place `pgCounters.release`'s SQL actually runs.

- [ ] **Step 8: Run the narrowed check subset**

Invoke the `minimal-check-subset` skill with the changed files (`quota.ts`, `quota.test.ts`, `handleAskRequest.ts`) and run exactly what it prints. Do **not** run `pnpm check`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/server/quota.ts apps/web/src/server/quota.test.ts apps/web/src/server/ai/handleAskRequest.ts
git commit -m "fix(quota): reserve the full step budget at admission, refund the rest

Closes KI-94 and KI-97. Admission charged one step and settled the remainder
afterwards, so N requests in flight had each charged 1 and could jointly pass
the global ceiling before any settled. reserveAiSteps now charges the full
budget and settleAiSteps releases the unused part, making in-flight exposure
exactly the reservation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Close the known issues

**Files:**
- Delete: `docs/known-issues/open/KI-094-ai-step-quota-admission-charge-one.md`
- Delete: `docs/known-issues/open/KI-097-tracking-only-ai-step-quota-admission.md`
- Create: `docs/known-issues/resolved/KI-094-ai-step-quota-admission-charge-one.md`
- Create: `docs/known-issues/resolved/KI-097-tracking-only-ai-step-quota-admission.md`

**Interfaces:**
- Consumes: the merged fix from Task 3.
- Produces: nothing code-facing.

- [ ] **Step 1: Move both entries with `git mv`**

```bash
git mv docs/known-issues/open/KI-094-ai-step-quota-admission-charge-one.md docs/known-issues/resolved/
git mv docs/known-issues/open/KI-097-tracking-only-ai-step-quota-admission.md docs/known-issues/resolved/
```

Use `git mv`, not delete-and-create: `KI-2026-08-30-d` records that a squash-merged PR makes the next branch's `git mv` reappear as a duplicate in both directories with no conflict. A rename keeps that detectable.

- [ ] **Step 2: Append a resolution line to each**

To both files, at the end:

```markdown
- **Resolved 2026-09-15**, M9 plan 1. `reserveAiSteps` charges the full step
  budget at admission and `settleAiSteps` releases the unused part through a
  new window-conditional `QuotaCounters.release`, so in-flight exposure is
  exactly the reservation. `bump`'s positive-integer clamp is untouched — the
  refund is a separate method reachable only through a `StepReservation`, and
  its SQL floors the result at zero. Regression test: a concurrent
  `Promise.all` of distinct users against the global bucket
  (`quota.test.ts`), which no previous quota test covered.
```

KI-97 is KI-94's tracking-only duplicate and its own entry says it closes with KI-94, never separately — which is what this step does.

- [ ] **Step 3: Tick the gate box**

In `docs/milestones/M9-ai-planning-partner.md`, the exit-gate box reading **"The step ceiling holds under concurrency — KI-94."** stays **unticked**. A box is ticked at gate close, not when its code merges (`TODO.md`'s standing rule). Instead append to that box's text:

```
      *(Implemented 2026-09-15, M9 plan 1 — `reserveAiSteps` + `release`.
      Confirm at the gate; do not rebuild.)*
```

- [ ] **Step 4: Verify nothing else references the entries as open**

```bash
grep -rn "KI-94\|KI-97" docs/ apps/ packages/ --include=*.md --include=*.ts | grep -v resolved/
```

Expected: only the M9 milestone file's gate box and this plan. Fix any line that still calls them open.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(known-issues): resolve KI-94 and KI-97

The step quota's admission charge now reserves the full budget and refunds the
unused part, so concurrent requests cannot jointly overshoot the global
ceiling. KI-97 is KI-94's tracking-only duplicate and closes with it, per its
own entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## What must not happen

- **`bump` does not gain a negative `amount`.** If a task feels like it wants one, it is the wrong task.
- **No reservation without reconciliation.** Shipping Task 3's `reserveAiSteps` without its `settleAiSteps` half charges every one-step answer 32 and is strictly worse than the bug being fixed.
- **`release` is never called outside `settleAiSteps`.** It takes a `StepReservation` for that reason; a bare bucket-and-amount decrement is the drain hazard KI-94's entry warns about.
- **The request-count layer (`aiQuotas`) is not touched.** It meters calls and is correct as it stands.
