# M8 "Make it real" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a trip a lifecycle — rename, set dates, delete/restore, duplicate — then make the core add/move loop bearable, subtract two illegible surfaces, and give every surface a first-run and empty state.

**Architecture:** Lifecycle changes are ordinary commands through the existing pipeline (`command → decide → append events → update projections`). `TripState` gains a `status` field; the five consumers of that state are updated together. Duplicate is a *server* operation, not a domain command, because it creates a new stream. Waves run **A → B → C → D**, sequentially, in the main checkout.

**Tech Stack:** TypeScript strict, pnpm workspaces, Zod (`packages/contracts`), pure domain (`packages/domain`), Next.js App Router + Drizzle/Postgres (`apps/web`), Vitest + fast-check, Playwright.

## Global Constraints

- **Invariant 1:** no code path writes a planning projection table directly. `applyTripEvents` and `upsertTripDetail` in `apps/web/src/server/projections.ts` remain the only writers.
- **Invariant 4:** `packages/domain` performs no I/O and no wall-clock reads. **Consequence for this plan: the domain cannot mint UUIDs.** New day ids arrive on the command, exactly as `AddDay` already does.
- **Invariant 5:** contract changes require a `docs/contracts/CHANGELOG.md` entry and all consumers updated in the same PR. Types are inferred from Zod, never hand-written twice.
- **Witness floors are measured, never guessed.** Log the real count over a few runs, set the floor near **half** the observed minimum (`packages/domain/test/support/witness.ts`).
- **Do not trust a single `pnpm check` exit code** (KI-13). Run gates separately: `pnpm typecheck`, `pnpm lint`, per-package `vitest run`. Integration tests need env loaded: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run`.
- Conventional commits, scoped to one logical change.
- Anchor domain tests (`anchor-conflicts.test.ts`, `anchors-state.test.ts`, `anchors.int.test.ts`) stay green throughout — they are the D-1 tripwire.

---

# Wave A — Trip lifecycle

AGENTS.md makes the contract change its own reviewed step. Tasks A1–A9 are domain/server and land before any UI.

### Task A1: Lifecycle contracts

**Files:**
- Modify: `packages/contracts/src/trip.ts`
- Modify: `docs/contracts/CHANGELOG.md`
- Test: `packages/contracts/src/trip.test.ts` (create if absent)

**Interfaces:**
- Produces: `SetTripName`, `TripNameSetV1`, `SetTripDates`, `DeleteTrip`, `TripDeletedV1`, `RestoreTrip`, `TripRestoredV1`; `TripEvent`/`TripCommand`/`BatchableCommand` unions extended.

**Design note — why `SetTripDates` carries `newDayIds`:** extending a trip emits `DayAdded`, which requires a `dayId`. The domain may not mint UUIDs (Invariant 4), so the caller supplies them, exactly as the UI already does for `AddDay` (`crypto.randomUUID()` per day). The AI path needs no special handling — `apps/web/src/server/ai/idFields.ts` already mints new ids for manifest-classified uuid fields.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/trip.test.ts
import { describe, expect, it } from "vitest";
import { BatchableCommand, DeleteTrip, RestoreTrip, SetTripDates, SetTripName, TripCommand, TripEvent } from "./trip";

const tripId = "11111111-1111-4111-8111-111111111111";
const dayId = "22222222-2222-4222-8222-222222222222";

describe("lifecycle commands", () => {
  it("accepts SetTripName within name bounds", () => {
    expect(SetTripName.safeParse({ type: "SetTripName", tripId, name: "Japan" }).success).toBe(true);
    expect(SetTripName.safeParse({ type: "SetTripName", tripId, name: "" }).success).toBe(false);
  });

  it("accepts SetTripDates with ISO dates and new day ids", () => {
    const ok = SetTripDates.safeParse({
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-13", newDayIds: [dayId],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a non-ISO date", () => {
    expect(SetTripDates.safeParse({
      type: "SetTripDates", tripId, startDate: "07/07/2026", endDate: null, newDayIds: [],
    }).success).toBe(false);
  });

  it("defaults newDayIds to an empty array", () => {
    const parsed = SetTripDates.parse({ type: "SetTripDates", tripId, startDate: null, endDate: null });
    expect(parsed.newDayIds).toEqual([]);
  });

  it("accepts DeleteTrip and RestoreTrip", () => {
    expect(DeleteTrip.safeParse({ type: "DeleteTrip", tripId }).success).toBe(true);
    expect(RestoreTrip.safeParse({ type: "RestoreTrip", tripId }).success).toBe(true);
  });

  it("puts name and dates in BatchableCommand but never delete or restore", () => {
    const types = BatchableCommand.options.map((o) => o.shape.type.value);
    expect(types).toContain("SetTripName");
    expect(types).toContain("SetTripDates");
    expect(types).not.toContain("DeleteTrip");
    expect(types).not.toContain("RestoreTrip");
  });

  it("puts every lifecycle command in TripCommand and every event in TripEvent", () => {
    const commands = TripCommand.options.map((o) => o.shape.type.value);
    expect(commands).toEqual(expect.arrayContaining(["SetTripName", "SetTripDates", "DeleteTrip", "RestoreTrip"]));
    const events = TripEvent.options.map((o) => o.shape.type.value);
    expect(events).toEqual(expect.arrayContaining(["TripNameSet", "TripDeleted", "TripRestored"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/contracts exec vitest run src/trip.test.ts`
Expected: FAIL — `SetTripName` is not exported.

- [ ] **Step 3: Add the schemas**

In `packages/contracts/src/trip.ts`, after the `SetTripStartDate` block:

```ts
export const SetTripName = z.object({
  type: z.literal("SetTripName"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type SetTripName = z.infer<typeof SetTripName>;

export const TripNameSetV1 = z.object({
  type: z.literal("TripNameSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), name: z.string().min(1).max(200) }),
});
export type TripNameSetV1 = z.infer<typeof TripNameSetV1>;

// Sets the date range and reconciles day COUNT to match it (decide emits the
// DayAdded/DayRemoved events). `newDayIds` supplies ids for any days the
// reconcile has to append — the domain is pure and cannot mint UUIDs
// (Invariant 4), the same reason AddDay carries its own dayId.
export const SetTripDates = z.object({
  type: z.literal("SetTripDates"),
  tripId: z.string().uuid(),
  startDate: z.string().regex(ISO_DATE).nullable(),
  endDate: z.string().regex(ISO_DATE).nullable(),
  newDayIds: z.array(z.string().uuid()).default([]),
});
export type SetTripDates = z.infer<typeof SetTripDates>;

// Soft delete. The stream survives; `status` gates further commands and the
// summaries read model filters it out. RestoreTrip is the exact inverse.
export const DeleteTrip = z.object({
  type: z.literal("DeleteTrip"),
  tripId: z.string().uuid(),
});
export type DeleteTrip = z.infer<typeof DeleteTrip>;

export const TripDeletedV1 = z.object({
  type: z.literal("TripDeleted"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid() }),
});
export type TripDeletedV1 = z.infer<typeof TripDeletedV1>;

export const RestoreTrip = z.object({
  type: z.literal("RestoreTrip"),
  tripId: z.string().uuid(),
});
export type RestoreTrip = z.infer<typeof RestoreTrip>;

export const TripRestoredV1 = z.object({
  type: z.literal("TripRestored"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid() }),
});
export type TripRestoredV1 = z.infer<typeof TripRestoredV1>;

export const TripStatus = z.enum(["active", "deleted"]);
export type TripStatus = z.infer<typeof TripStatus>;
```

Add `TripNameSetV1, TripDeletedV1, TripRestoredV1` to the `TripEvent` union; add `SetTripName, SetTripDates, DeleteTrip, RestoreTrip` to `TripCommand`; add **only** `SetTripName, SetTripDates` to `BatchableCommand`. Add `status: TripStatus` to `TripSummary`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/contracts exec vitest run src/trip.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Add the changelog entry**

Prepend to `docs/contracts/CHANGELOG.md` under the format block:

```markdown
## 2026-07-28 — M8: trip lifecycle
- Added commands: `SetTripName`, `SetTripDates`, `DeleteTrip`, `RestoreTrip`
- Added events: `TripNameSetV1`, `TripDeletedV1`, `TripRestoredV1`
- Added: `TripStatus` enum; `status` on `TripSummary` and `TripDetail`
- `SetTripName`/`SetTripDates` joined `BatchableCommand` (AI-reachable);
  `DeleteTrip`/`RestoreTrip` deliberately did NOT — destructive and
  stream-level operations stay out of the derived tool surface
- `SetTripDates` carries `newDayIds` because the domain may not mint UUIDs
  (Invariant 4); it supersedes `SetTripStartDate`, which is left in place —
  deprecation plan deferred (see known-issues KI-15)
- Why: M8 — a trip could not be renamed or deleted by anyone
- Consumers updated: `packages/domain`, `apps/web` (routes, projections, AI
  tools, UI)
- Breaking? no — additive
```

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/trip.ts packages/contracts/src/trip.test.ts docs/contracts/CHANGELOG.md
git commit -m "feat(contracts): add trip lifecycle commands and events"
```

---

### Task A2: `TripState.status` and the two new reducer cases

**Files:**
- Modify: `packages/domain/src/trip/state.ts`
- Modify: `packages/domain/src/trip/evolve.ts`
- Test: `packages/domain/src/trip/evolve.test.ts` (existing)

**Interfaces:**
- Consumes: `TripDeletedV1`, `TripRestoredV1`, `TripNameSetV1` from Task A1.
- Produces: `TripState.status: "active" | "deleted"`, defaulting to `"active"` at `TripCreated`.

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/src/trip/evolve.test.ts`:

```ts
describe("lifecycle events", () => {
  const tripId = "11111111-1111-4111-8111-111111111111";
  const created = evolveTrip(null, {
    type: "TripCreated", version: 1, payload: { tripId, name: "Japan", createdBy: "u1" },
  });

  it("starts a trip active", () => {
    expect(created.status).toBe("active");
  });

  it("renames without touching anything else", () => {
    const renamed = evolveTrip(created, {
      type: "TripNameSet", version: 1, payload: { tripId, name: "Japan 2027" },
    });
    expect(renamed.name).toBe("Japan 2027");
    expect(renamed.days).toEqual(created.days);
  });

  it("round-trips delete and restore", () => {
    const deleted = evolveTrip(created, { type: "TripDeleted", version: 1, payload: { tripId } });
    expect(deleted.status).toBe("deleted");
    const restored = evolveTrip(deleted, { type: "TripRestored", version: 1, payload: { tripId } });
    expect(restored.status).toBe("active");
    expect(restored).toEqual(created);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/evolve.test.ts`
Expected: FAIL — `status` is undefined.

- [ ] **Step 3: Implement**

In `state.ts`, add to `TripState`:

```ts
  status: TripStatus; // "deleted" is a soft delete; the stream survives
```

and import `TripStatus` from `@tc/contracts`.

In `evolve.ts`, add `status: "active"` to the `TripCreated` return object, and add three cases to the switch:

```ts
    case "TripNameSet":
      return { ...state, name: event.payload.name };
    case "TripDeleted":
      return { ...state, status: "deleted" };
    case "TripRestored":
      return { ...state, status: "active" };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/evolve.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/trip/state.ts packages/domain/src/trip/evolve.ts packages/domain/src/trip/evolve.test.ts
git commit -m "feat(domain): add trip status to state and reduce lifecycle events"
```

---

### Task A3: `tripStatesEqual` compares `status`

`okUnlessNoOp` is built on this. Without it, `DeleteTrip` on an already-deleted trip reads as a real change.

**Files:**
- Modify: `packages/domain/src/trip/equality.ts:56`
- Test: `packages/domain/src/trip/equality.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

```ts
it("treats a status difference as a difference", () => {
  const a = baseState();                       // existing helper in this file
  const b = { ...a, status: "deleted" as const };
  expect(tripStatesEqual(a, b)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/equality.test.ts`
Expected: FAIL — returns `true`.

- [ ] **Step 3: Implement**

`equality.ts:56` — extend the first guard:

```ts
  if (a.tripId !== b.tripId || a.name !== b.name || a.startDate !== b.startDate) return false;
  if (a.status !== b.status) return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/equality.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/trip/equality.ts packages/domain/src/trip/equality.test.ts
git commit -m "feat(domain): compare trip status in tripStatesEqual"
```

---

### Task A4: `decideTripCommand` — rename, delete, restore, and the deleted-trip guard

**Files:**
- Modify: `packages/domain/src/trip/decide.ts`
- Test: `packages/domain/src/trip/decide.test.ts` (existing)

**Interfaces:**
- Produces: rejection codes `trip-deleted`, `trip-not-deleted`.

- [ ] **Step 1: Write the failing test**

```ts
describe("lifecycle commands", () => {
  const ctx = { actorId: "u1" };
  const tripId = "11111111-1111-4111-8111-111111111111";
  const active = evolveTrip(null, {
    type: "TripCreated", version: 1, payload: { tripId, name: "Japan", createdBy: "u1" },
  });
  const deleted = evolveTrip(active, { type: "TripDeleted", version: 1, payload: { tripId } });

  it("renames a trip", () => {
    const d = decideTripCommand(active, { type: "SetTripName", tripId, name: "Japan 2027" }, ctx);
    expect(d).toEqual({ ok: true, events: [{ type: "TripNameSet", version: 1, payload: { tripId, name: "Japan 2027" } }] });
  });

  it("rejects renaming to the same name as a no-op", () => {
    const d = decideTripCommand(active, { type: "SetTripName", tripId, name: "Japan" }, ctx);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.rejection.code).toBe("no-op");
  });

  it("deletes an active trip", () => {
    const d = decideTripCommand(active, { type: "DeleteTrip", tripId }, ctx);
    expect(d.ok && d.events[0]!.type).toBe("TripDeleted");
  });

  it("rejects every command on a deleted trip except RestoreTrip", () => {
    const blocked = decideTripCommand(deleted, { type: "SetTripName", tripId, name: "X" }, ctx);
    expect(blocked.ok === false && blocked.rejection.code).toBe("trip-deleted");
    const allowed = decideTripCommand(deleted, { type: "RestoreTrip", tripId }, ctx);
    expect(allowed.ok && allowed.events[0]!.type).toBe("TripRestored");
  });

  it("rejects restoring a trip that is not deleted", () => {
    const d = decideTripCommand(active, { type: "RestoreTrip", tripId }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("trip-not-deleted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/decide.test.ts`
Expected: FAIL — non-exhaustive switch / unknown command types.

- [ ] **Step 3: Implement**

In `decideCommand`, immediately after the `state === null` check and before the history-command branch:

```ts
  // A deleted trip accepts exactly one command: its own inverse. Everything
  // else is rejected rather than silently mutating a trip the user removed.
  if (state.status === "deleted" && command.type !== "RestoreTrip") {
    return reject("trip-deleted", "This trip has been deleted.");
  }
```

Then add three cases to the switch:

```ts
    case "SetTripName":
      return okUnlessNoOp(state, [
        { type: "TripNameSet", version: 1, payload: { tripId: command.tripId, name: command.name } },
      ]);
    case "DeleteTrip":
      return ok([{ type: "TripDeleted", version: 1, payload: { tripId: command.tripId } }]);
    case "RestoreTrip":
      if (state.status !== "deleted") {
        return reject("trip-not-deleted", "This trip is not deleted.");
      }
      return ok([{ type: "TripRestored", version: 1, payload: { tripId: command.tripId } }]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/decide.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/trip/decide.ts packages/domain/src/trip/decide.test.ts
git commit -m "feat(domain): decide rename, delete, and restore commands"
```

---

### Task A5: `SetTripDates` reconciliation

The meatiest decider. Reconciliation rules come from the spec §4.1.

**Files:**
- Modify: `packages/domain/src/trip/dates.ts` (add `daySpan`)
- Modify: `packages/domain/src/trip/decide.ts`
- Test: `packages/domain/src/trip/dates.test.ts`, `packages/domain/src/trip/decide.test.ts`

**Interfaces:**
- Produces: `daySpan(startIso: string, endIso: string): number` — inclusive day count.
- Produces: rejection codes `invalid-dates`, `not-enough-day-ids`.

- [ ] **Step 1: Write the failing test for `daySpan`**

```ts
// packages/domain/src/trip/dates.test.ts
import { describe, expect, it } from "vitest";
import { daySpan } from "./dates";

describe("daySpan", () => {
  it("counts inclusively", () => {
    expect(daySpan("2026-07-07", "2026-07-07")).toBe(1);
    expect(daySpan("2026-07-07", "2026-07-13")).toBe(7);
  });
  it("crosses a month boundary", () => {
    expect(daySpan("2026-07-30", "2026-08-02")).toBe(4);
  });
  it("returns a non-positive number when end precedes start", () => {
    expect(daySpan("2026-07-07", "2026-07-06")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/dates.test.ts`
Expected: FAIL — `daySpan` is not exported.

- [ ] **Step 3: Implement `daySpan`**

Append to `packages/domain/src/trip/dates.ts`:

```ts
// Inclusive day count between two ISO dates. Pure: built from explicit
// components via Date.UTC, never `new Date()`. Returns 0 or less when `end`
// precedes `start`; callers treat that as invalid.
export function daySpan(startIso: string, endIso: string): number {
  const toUtc = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.floor((toUtc(endIso) - toUtc(startIso)) / 86_400_000) + 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/dates.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing decider test**

Append to `decide.test.ts`:

```ts
describe("SetTripDates", () => {
  const ctx = { actorId: "u1" };
  const tripId = "11111111-1111-4111-8111-111111111111";
  const d1 = "aaaaaaaa-1111-4111-8111-111111111111";
  const d2 = "aaaaaaaa-2222-4111-8111-111111111111";
  const newIds = ["bbbbbbbb-1111-4111-8111-111111111111", "bbbbbbbb-2222-4111-8111-111111111111"];

  function tripWithDays(dayIds: string[]) {
    let s = evolveTrip(null, { type: "TripCreated", version: 1, payload: { tripId, name: "T", createdBy: "u1" } });
    for (const dayId of dayIds) s = evolveTrip(s, { type: "DayAdded", version: 1, payload: { tripId, dayId } });
    return s;
  }

  it("appends days when the range is longer than the current day count", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-09", newDayIds: newIds,
    }, ctx);
    expect(d.ok).toBe(true);
    expect(d.ok && d.events.map((e) => e.type)).toEqual(["TripStartDateSet", "DayAdded", "DayAdded"]);
  });

  it("removes from the TAIL when the range is shorter", () => {
    const d = decideTripCommand(tripWithDays([d1, d2]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok && d.events.filter((e) => e.type === "DayRemoved").map((e) => e.payload.dayId)).toEqual([d2]);
  });

  it("rejects an end date before the start date", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-09", endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("invalid-dates");
  });

  it("rejects an end date with no start date", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: null, endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("invalid-dates");
  });

  it("rejects rather than clamping when the range would leave zero days", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-06", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("invalid-dates");
  });

  it("rejects when too few new day ids were supplied", () => {
    const d = decideTripCommand(tripWithDays([d1]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-09", newDayIds: [newIds[0]!],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("not-enough-day-ids");
  });

  it("sets the start date only when endDate is null", () => {
    const d = decideTripCommand(tripWithDays([d1, d2]), {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: null, newDayIds: [],
    }, ctx);
    expect(d.ok && d.events.map((e) => e.type)).toEqual(["TripStartDateSet"]);
  });

  it("is a no-op when nothing changes", () => {
    let s = tripWithDays([d1]);
    s = evolveTrip(s, { type: "TripStartDateSet", version: 1, payload: { tripId, startDate: "2026-07-07" } });
    const d = decideTripCommand(s, {
      type: "SetTripDates", tripId, startDate: "2026-07-07", endDate: "2026-07-07", newDayIds: [],
    }, ctx);
    expect(d.ok === false && d.rejection.code).toBe("no-op");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/decide.test.ts -t SetTripDates`
Expected: FAIL — unknown command type.

- [ ] **Step 7: Implement the decider case**

Import `daySpan` in `decide.ts` and add:

```ts
    case "SetTripDates": {
      const { startDate, endDate } = command;
      if (startDate === null && endDate !== null) {
        return reject("invalid-dates", "An end date needs a start date.");
      }
      const events: TripEvent[] = [];
      if (state.startDate !== startDate) {
        events.push({
          type: "TripStartDateSet",
          version: 1,
          payload: { tripId: command.tripId, startDate },
        });
      }
      // A null endDate means "set the start only" — day count is untouched.
      if (startDate !== null && endDate !== null) {
        const target = daySpan(startDate, endDate);
        if (target < 1) {
          return reject("invalid-dates", "The end date cannot be before the start date.");
        }
        const current = state.days.length;
        if (target > current) {
          const needed = target - current;
          if (command.newDayIds.length < needed) {
            return reject(
              "not-enough-day-ids",
              `This range needs ${needed} more day(s); ${command.newDayIds.length} id(s) were supplied.`,
            );
          }
          for (const dayId of command.newDayIds.slice(0, needed)) {
            events.push({ type: "DayAdded", version: 1, payload: { tripId: command.tripId, dayId } });
          }
        } else if (target < current) {
          // Remove from the TAIL: day 1 stays pinned to startDate, so no
          // surviving day is silently redated (a day's ordinal IS its date).
          for (const day of state.days.slice(target)) {
            events.push({ type: "DayRemoved", version: 1, payload: { tripId: command.tripId, dayId: day.dayId } });
          }
        }
      }
      return okUnlessNoOp(state, events);
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/decide.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/trip/dates.ts packages/domain/src/trip/dates.test.ts packages/domain/src/trip/decide.ts packages/domain/src/trip/decide.test.ts
git commit -m "feat(domain): SetTripDates reconciles day count to the date range"
```

---

### Task A6: `diffTripStates` reconciles name and status

**This task is the highest-risk item in the plan.** `diff.ts:12` carries an explicit precondition — *"tripId/name/members never differ between two states of one trip (no rename/membership commands exist in Phase 1)"* — which Task A1 just falsified. `tripStatesEqual` compares `name`, so without this task undo/revert across a rename produces a state that does not equal its target and the M2 round-trip property goes red. Exactly KI-1's shape: a reconciliation step that silently emits nothing.

**Files:**
- Modify: `packages/domain/src/trip/diff.ts`
- Test: `packages/domain/src/trip/diff.property.test.ts` (existing)

- [ ] **Step 1: Write the failing tests**

Append to `diff.property.test.ts`:

```ts
describe("diffTripStates lifecycle reconciliation (M8)", () => {
  const tripId = "11111111-1111-4111-8111-111111111111";
  const base = evolveTrip(null, {
    type: "TripCreated", version: 1, payload: { tripId, name: "Japan", createdBy: "u1" },
  });

  it("emits a rename when the names differ", () => {
    const target = { ...base, name: "Japan 2027" };
    const events = diffTripStates(base, target);
    expect(events.map((e) => e.type)).toContain("TripNameSet");
    expect(tripStatesEqual(events.reduce(evolveTrip, base), target)).toBe(true);
  });

  it("emits a delete when the target is deleted", () => {
    const target = { ...base, status: "deleted" as const };
    const events = diffTripStates(base, target);
    expect(events.map((e) => e.type)).toEqual(["TripDeleted"]);
    expect(tripStatesEqual(events.reduce(evolveTrip, base), target)).toBe(true);
  });

  it("restores FIRST so later reconciliation applies to a live trip", () => {
    const current = { ...base, status: "deleted" as const };
    const target = { ...base, name: "Renamed" };
    const events = diffTripStates(current, target);
    expect(events[0]!.type).toBe("TripRestored");
    expect(tripStatesEqual(events.reduce(evolveTrip, current), target)).toBe(true);
  });

  it("deletes LAST so the delete is not applied before the rest of the diff", () => {
    const current = { ...base, name: "Old" };
    const target = { ...base, name: "New", status: "deleted" as const };
    const events = diffTripStates(current, target);
    expect(events[events.length - 1]!.type).toBe("TripDeleted");
    expect(tripStatesEqual(events.reduce(evolveTrip, current), target)).toBe(true);
  });

  it("emits nothing for identical states", () => {
    expect(diffTripStates(base, base)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/diff.property.test.ts -t "lifecycle reconciliation"`
Expected: FAIL — no `TripNameSet` emitted; the round-trip assertion is false.

- [ ] **Step 3: Implement**

First replace the stale precondition comment at `diff.ts:12-14`:

```ts
// Precondition: same stream — tripId and members never differ between two
// states of one trip (no membership commands exist yet). NAME and STATUS *can*
// differ as of M8 (SetTripName / DeleteTrip / RestoreTrip) and are reconciled
// in steps 0 and 8 below. This comment used to claim name was invariant too;
// M8 falsified it, and the round-trip property is what enforces the claim.
```

Insert **step 0**, before the existing step 1:

```ts
  // 0. Restore first: everything downstream should reconcile a live trip.
  if (working.status === "deleted" && target.status === "active") {
    push({ type: "TripRestored", version: 1, payload: { tripId: target.tripId } });
  }

  // 0b. Name.
  if (working.name !== target.name) {
    push({ type: "TripNameSet", version: 1, payload: { tripId: target.tripId, name: target.name } });
  }
```

Append **step 8**, after the existing step 7 (dismissals) and before `return events;`:

```ts
  // 8. Delete last: the whole state is reconciled before the trip is removed.
  if (working.status === "active" && target.status === "deleted") {
    push({ type: "TripDeleted", version: 1, payload: { tripId: target.tripId } });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/diff.property.test.ts`
Expected: PASS — including the pre-existing round-trip property.

- [ ] **Step 5: Extend the generator so the property actually exercises this**

In `packages/domain/test/support/tripGenerator.ts`, add `SetTripName`, `DeleteTrip`, and `RestoreTrip` to the generated command arbitrary. Then **measure** the witness count: run the property three times, log the observed counts, and set the floor near half the observed minimum, per `witness.ts`.

Run: `pnpm --filter @tc/domain exec vitest run src/trip/diff.property.test.ts` three times and record the counts before choosing the floor. Do not guess it.

- [ ] **Step 6: Run the full domain suite**

Run: `pnpm --filter @tc/domain exec vitest run`
Expected: PASS — in particular the M2 round-trip property and the KI-1 day-ordering regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/trip/diff.ts packages/domain/src/trip/diff.property.test.ts packages/domain/test/support/tripGenerator.ts
git commit -m "fix(domain): reconcile name and status in diffTripStates

The precondition comment claimed name never differs between two states of one
trip. SetTripName falsifies it, so undo/revert across a rename would not have
restored the name. Same shape as KI-1."
```

---

### Task A7: History descriptions for the new events

`describeEvent` is an exhaustive switch with no `default:` — Task A2's events make it fail typecheck until this lands.

**Files:**
- Modify: `packages/domain/src/trip/history.ts:179`
- Test: `packages/domain/src/trip/history.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

```ts
it("describes lifecycle events", () => {
  const tripId = "11111111-1111-4111-8111-111111111111";
  const state = evolveTrip(null, { type: "TripCreated", version: 1, payload: { tripId, name: "Japan", createdBy: "u1" } });
  expect(describeUserBatch(state, [{ type: "TripNameSet", version: 1, payload: { tripId, name: "Japan 2027" } }]))
    .toBe('Renamed the trip to "Japan 2027"');
  expect(describeUserBatch(state, [{ type: "TripDeleted", version: 1, payload: { tripId } }]))
    .toBe("Deleted the trip");
  expect(describeUserBatch(state, [{ type: "TripRestored", version: 1, payload: { tripId } }]))
    .toBe("Restored the trip");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/history.test.ts`
Expected: FAIL — typecheck error, switch not exhaustive.

- [ ] **Step 3: Implement**

Add to the `describeEvent` switch in `history.ts`:

```ts
    case "TripNameSet":
      return `Renamed the trip to "${event.payload.name}"`;
    case "TripDeleted":
      return "Deleted the trip";
    case "TripRestored":
      return "Restored the trip";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/trip/history.ts packages/domain/src/trip/history.test.ts
git commit -m "feat(domain): describe lifecycle events in history entries"
```

---

### Task A8: Projections carry status — `TripDetail`, `TripSummary`, `hydrate`

**Files:**
- Modify: `packages/contracts/src/detail.ts` (add `status`)
- Modify: `packages/domain/src/trip/detail.ts:17`
- Modify: `packages/domain/src/trip/project.ts`
- Modify: `packages/domain/src/trip/hydrate.ts`
- Test: `packages/domain/src/trip/hydrate.test.ts`, `packages/domain/src/trip/project.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// project.test.ts
it("projects name changes and filters nothing (status is carried, not applied)", () => {
  const summaries = projectTripSummaries([
    envelope({ type: "TripCreated", payload: { tripId, name: "Old", createdBy: "u1" } }),
    envelope({ type: "TripNameSet", payload: { tripId, name: "New" } }),
    envelope({ type: "TripDeleted", payload: { tripId } }),
  ]);
  expect(summaries[0]!.name).toBe("New");
  expect(summaries[0]!.status).toBe("deleted");
});

// hydrate.test.ts — extend the existing round-trip property's fixture
it("round-trips status", () => {
  const detail = tripDetailFromState({ ...baseState(), status: "deleted" }, "2026-07-28T00:00:00Z");
  expect(hydrate(detail).status).toBe("deleted");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tc/domain exec vitest run src/trip/project.test.ts src/trip/hydrate.test.ts`
Expected: FAIL — `status` is undefined on the summary.

- [ ] **Step 3: Implement**

`packages/contracts/src/detail.ts` — add to `TripDetail`, after `name`:

```ts
  status: TripStatus,
```

(import `TripStatus` from `./trip`).

`packages/domain/src/trip/detail.ts` — add `status: state.status,` to the returned object.

`packages/domain/src/trip/project.ts` — add cases so summaries track renames and status:

```ts
      case "TripNameSet": {
        const s = byStream.get(env.streamId);
        if (s !== undefined) s.name = event.payload.name;
        break;
      }
      case "TripDeleted": {
        const s = byStream.get(env.streamId);
        if (s !== undefined) s.status = "deleted";
        break;
      }
      case "TripRestored": {
        const s = byStream.get(env.streamId);
        if (s !== undefined) s.status = "active";
        break;
      }
```

and add `status: "active"` to the `TripCreated` object literal.

`packages/domain/src/trip/hydrate.ts` — carry `status: detail.status` into the returned `TripState`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tc/domain exec vitest run`
Expected: PASS — including the `hydrate` round-trip property from M6.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/detail.ts packages/domain/src/trip/detail.ts packages/domain/src/trip/project.ts packages/domain/src/trip/hydrate.ts packages/domain/src/trip/project.test.ts packages/domain/src/trip/hydrate.test.ts
git commit -m "feat(contracts,domain): carry trip status through detail and summary projections"
```

---

### Task A9: Server projections — migration, `applyTripEvents`, list filter

`applyTripEvents` currently handles only `TripCreated` (`projections.ts:22`, comment *"M1 events don't touch the summaries read model"*). Rename, delete, and restore all must reach `trip_summaries`, and `trip_summaries` has no `status` column yet.

**Files:**
- Modify: `apps/web/src/server/db/schema.ts:31-36`
- Create: `apps/web/drizzle/0004_*.sql` (generated)
- Modify: `apps/web/src/server/projections.ts`
- Test: `apps/web/src/server/projections.int.test.ts` (create)

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/web/src/server/projections.int.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { executeTripCommand } from "./commands";
import { listTripSummaries, rebuildProjections } from "./projections";
import { db } from "./db/client";
import { events, tripDetails, tripSummaries } from "./db/schema";

const actor = "u1";

describe("trip_summaries tracks lifecycle events", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("tracks rename, delete, and restore, and rebuild reproduces them", async () => {
    const tripId = crypto.randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Old" }, actor);
    await executeTripCommand({ type: "SetTripName", tripId, name: "New" }, actor);

    let rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)!.name).toBe("New");

    await executeTripCommand({ type: "DeleteTrip", tripId }, actor);
    rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)).toBeUndefined();

    await executeTripCommand({ type: "RestoreTrip", tripId }, actor);
    rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)!.status).toBe("active");

    // The golden guarantee: projections are disposable (Invariant 2).
    const before = await db.select().from(tripSummaries);
    await rebuildProjections();
    const after = await db.select().from(tripSummaries);
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run src/server/projections.int.test.ts`
Expected: FAIL — `status` column does not exist.

- [ ] **Step 3: Add the column and generate the migration**

`apps/web/src/server/db/schema.ts`, in `tripSummaries`:

```ts
  status: text("status").notNull().default("active"),
```

Then:

```bash
pnpm --filter web db:generate
```

Expected: a new `apps/web/drizzle/0004_*.sql` adding the column. Apply it:

```bash
pnpm --filter web db:migrate
```

- [ ] **Step 4: Teach `applyTripEvents` the new events**

Replace the switch in `projections.ts` (keeping `TripCreated`) with:

```ts
      case "TripCreated":
        await tx.insert(tripSummaries).values({
          tripId: event.payload.tripId,
          name: event.payload.name,
          members: [{ userId: event.payload.createdBy, role: "owner" }],
          createdAt: env.occurredAt,
          status: "active",
        });
        break;
      case "TripNameSet":
        await tx.update(tripSummaries)
          .set({ name: event.payload.name })
          .where(eq(tripSummaries.tripId, event.payload.tripId));
        break;
      case "TripDeleted":
        await tx.update(tripSummaries)
          .set({ status: "deleted" })
          .where(eq(tripSummaries.tripId, event.payload.tripId));
        break;
      case "TripRestored":
        await tx.update(tripSummaries)
          .set({ status: "active" })
          .where(eq(tripSummaries.tripId, event.payload.tripId));
        break;
      // Other planning events don't touch the summaries read model.
```

Filter the list — `listTripSummaries` is the trip-list source:

```ts
export async function listTripSummaries() {
  return db.select().from(tripSummaries).where(eq(tripSummaries.status, "active"));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run src/server/projections.int.test.ts`
Expected: PASS

- [ ] **Step 6: Run the whole integration suite**

Run: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run`
Expected: PASS — all pre-existing int tests including the event-store guarantees.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/server/db/schema.ts apps/web/drizzle apps/web/src/server/projections.ts apps/web/src/server/projections.int.test.ts
git commit -m "feat(server): track trip lifecycle in the summaries read model"
```

---

### Task A10: Trip routes — list filter and the deleted-trip detail response

**Files:**
- Modify: `apps/web/src/app/api/trips/[tripId]/route.ts`
- Test: `apps/web/src/app/api/trips/[tripId]/route.int.test.ts` (existing or create)

The `GET /api/trips` filter already fell out of Task A9's `listTripSummaries`. This task covers the detail route: a deleted trip returns **200 with `status: "deleted"`**, not 404, so an open tab or a back-navigation gets a legible restore state instead of a dead end.

- [ ] **Step 1: Write the failing test**

```ts
it("returns a deleted trip with status rather than 404", async () => {
  const tripId = crypto.randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Doomed" }, actor);
  await executeTripCommand({ type: "DeleteTrip", tripId }, actor);

  const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.trip.status).toBe("deleted");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run src/app/api/trips`
Expected: FAIL — `status` missing from the parsed detail.

- [ ] **Step 3: Implement**

No change is needed to the route's logic — `TripDetail.parse` now carries `status` from Task A8. Confirm the route still returns 404 only when `getTripDetail` returns `null`, and add a comment above the `detail === null` check:

```ts
  // A DELETED trip is NOT a 404: it returns 200 with status:"deleted" so the UI
  // can offer a restore instead of a dead end. Only a genuinely unknown id 404s.
```

- [ ] **Step 4: Run test to verify it passes**

Run: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run src/app/api/trips`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/trips
git commit -m "feat(server): a deleted trip returns 200 with status, not 404"
```

---

### Task A11: `POST /api/trips/[tripId]/duplicate`

Duplicate creates a **new stream**, so it is a server operation, not a `TripCommand`.

**Files:**
- Create: `apps/web/src/server/duplicateTrip.ts`
- Create: `apps/web/src/app/api/trips/[tripId]/duplicate/route.ts`
- Test: `apps/web/src/server/duplicateTrip.int.test.ts`

**Interfaces:**
- Produces: `duplicateTrip(sourceTripId: string, actorId: string): Promise<CommandResult>` — reuses `CommandResult` from `./commands`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/server/duplicateTrip.int.test.ts
it("copies planning state into a fresh stream with fresh ids", async () => {
  const tripId = crypto.randomUUID();
  const dayId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan" }, actor);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, actor);
  await executeTripCommand({ type: "AddActivity", tripId, activityId, dayId, title: "Ramen" }, actor);

  const result = await duplicateTrip(tripId, actor);
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.detail.name).toBe("Japan (copy)");
  expect(result.detail.tripId).not.toBe(tripId);
  expect(result.detail.days).toHaveLength(1);
  // Fresh ids: reusing source ids across streams is the KI-1 hazard.
  expect(result.detail.days[0]!.dayId).not.toBe(dayId);
  expect(Object.keys(result.detail.activities)[0]).not.toBe(activityId);
  expect(Object.values(result.detail.activities)[0]!.title).toBe("Ramen");

  // The source is untouched.
  const source = await getTripDetail(tripId);
  expect(source!.days[0]!.dayId).toBe(dayId);
});

it("does not copy the source trip's pages", async () => {
  const tripId = crypto.randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan" }, actor);
  await createPage({ title: "Packing", context: { tripId }, content: { type: "doc", content: [] } }, actor);

  const result = await duplicateTrip(tripId, actor);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Pages are a separate CRUD module (ADR-014); a duplicate copies planning
  // state only.
  const copied = await listPagesRaw(result.tripId);
  expect(copied).toHaveLength(0);
});

it("leaves a trip's pages intact across delete and restore", async () => {
  const tripId = crypto.randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan" }, actor);
  await createPage({ title: "Packing", context: { tripId }, content: { type: "doc", content: [] } }, actor);
  await executeTripCommand({ type: "DeleteTrip", tripId }, actor);
  await executeTripCommand({ type: "RestoreTrip", tripId }, actor);
  expect(await listPagesRaw(tripId)).toHaveLength(1);
});

it("refuses to duplicate a deleted trip", async () => {
  const tripId = crypto.randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Gone" }, actor);
  await executeTripCommand({ type: "DeleteTrip", tripId }, actor);
  const result = await duplicateTrip(tripId, actor);
  expect(result.ok === false && result.error.code).toBe("trip-deleted");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run src/server/duplicateTrip.int.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/server/duplicateTrip.ts
import { randomUUID } from "node:crypto";
import type { BatchableCommand } from "@tc/contracts";
import { diffTripStates, hydrate, type TripState } from "@tc/domain";
import { executeTripCommand, executeTripCommandBatch, type CommandResult } from "./commands";
import { getTripDetail } from "./projections";

// Every day and activity id is remapped to a fresh UUID. Reusing source ids
// across streams is the KI-1 hazard (its post-mortem notes fork-with-lineage
// will want to preserve day ids — that is M11's decision to make, not a
// precedent this should set), and it keeps the two streams fully independent.
function remapIds(state: TripState, tripId: string): TripState {
  const dayIds = new Map(state.days.map((d) => [d.dayId, randomUUID()]));
  const activityIds = new Map(Object.keys(state.activities).map((id) => [id, randomUUID()]));
  const remap = (m: Map<string, string>, id: string): string => m.get(id) ?? id;
  return {
    ...state,
    tripId,
    days: state.days.map((d) => ({
      dayId: remap(dayIds, d.dayId),
      activityIds: d.activityIds.map((id) => remap(activityIds, id)),
    })),
    backlog: state.backlog.map((id) => remap(activityIds, id)),
    activities: Object.fromEntries(
      Object.entries(state.activities).map(([id, a]) => [remap(activityIds, id), a]),
    ),
    // Dismissals are OCCURRENCE-scoped (KI-14) and a fresh trip has had no
    // occurrences; conflict ids also embed the old day/activity ids.
    dismissedConflictIds: [],
  };
}

export async function duplicateTrip(sourceTripId: string, actorId: string): Promise<CommandResult> {
  const source = await getTripDetail(sourceTripId);
  if (source === null) {
    return { ok: false, error: { code: "not-found", message: "This trip does not exist." } };
  }
  if (!source.members.some((m) => m.userId === actorId)) {
    return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
  }
  if (source.status === "deleted") {
    return { ok: false, error: { code: "trip-deleted", message: "This trip has been deleted." } };
  }

  const tripId = randomUUID();
  const created = await executeTripCommand(
    { type: "CreateTrip", tripId, name: `${source.name} (copy)` },
    actorId,
  );
  if (!created.ok) return created;
  // Planning state only. The source's Notebook pages are NOT copied: pages are
  // a separate CRUD module referencing trips by id (ADR-014), and cloning prose
  // is template machinery, which is M11's bet.

  // diffTripStates was built for exactly this transformation: given an empty
  // state and a target, emit the events that produce the target. Turning those
  // events back into commands keeps the copy inside the normal pipeline.
  //
  // The target's name must be the COPY's name, not the source's. CreateTrip
  // above already set "<name> (copy)"; if the target still carried the source
  // name the diff would emit a TripNameSet stripping the suffix straight back
  // off — the copy would silently end up sharing the original's name.
  const copyName = `${source.name} (copy)`;
  const target = { ...remapIds(hydrate(source), tripId), name: copyName };
  const empty = hydrate(created.detail);
  const commands = diffTripStates(empty, target).map((e) => eventToCommand(e, tripId));
  if (commands.length === 0) return created;

  return executeTripCommandBatch(commands, actorId);
}

// The diff emits the same event set the batchable commands produce, so the
// mapping is total over what diffTripStates can return for an empty→target run.
function eventToCommand(event: ReturnType<typeof diffTripStates>[number], tripId: string): BatchableCommand {
  switch (event.type) {
    case "DayAdded":
      return { type: "AddDay", tripId, dayId: event.payload.dayId };
    case "TripStartDateSet":
      return { type: "SetTripDates", tripId, startDate: event.payload.startDate, endDate: null, newDayIds: [] };
    case "TripCurrencySet":
      return { type: "SetTripCurrency", tripId, currency: event.payload.currency };
    case "TripBudgetSet":
      return { type: "SetTripBudget", tripId, budget: event.payload.budget };
    case "TripNameSet":
      return { type: "SetTripName", tripId, name: event.payload.name };
    case "ActivityAdded":
      return {
        type: "AddActivity", tripId,
        activityId: event.payload.activityId,
        dayId: event.payload.dayId ?? undefined,
        title: event.payload.title,
        timeWindow: event.payload.timeWindow,
        location: event.payload.location,
        notes: event.payload.notes,
        anchors: event.payload.anchors,
        cost: event.payload.cost,
      };
    case "ActivityMoved":
      return {
        type: "MoveActivity", tripId,
        activityId: event.payload.activityId,
        toDayId: event.payload.toDayId,
        position: event.payload.position,
      };
    default:
      throw new Error(`duplicateTrip: unexpected event ${event.type} from an empty-state diff`);
  }
}
```

Route:

```ts
// apps/web/src/app/api/trips/[tripId]/duplicate/route.ts
import { auth } from "@/server/auth";
import { duplicateTrip } from "@/server/duplicateTrip";

export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const result = await duplicateTrip(tripId, session.user.id);
  if (!result.ok) {
    const status = result.error.code === "not-found" ? 404 : result.error.code === "forbidden" ? 403 : 400;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: from `apps/web`, `set -a && . ./.env.local && set +a && pnpm exec vitest run src/server/duplicateTrip.int.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/duplicateTrip.ts apps/web/src/server/duplicateTrip.int.test.ts "apps/web/src/app/api/trips/[tripId]/duplicate"
git commit -m "feat(server): duplicate a trip into a fresh stream with fresh ids"
```

---

### Task A12: AI tool surface

**Files:**
- Modify: `apps/web/src/server/ai/idFields.ts`
- Modify: `apps/web/src/server/ai/handleAiRequest.ts` (system prompt)
- Test: `apps/web/src/server/ai/idFields.test.ts` (existing enforcement test)

`SetTripName` and `SetTripDates` became AI-reachable the moment Task A1 put them in `BatchableCommand` — tools are *derived* (ADR-015). Two consequences to handle.

- [ ] **Step 1: Run the existing enforcement test to see it fail**

Run: `pnpm --filter web exec vitest run src/server/ai/idFields.test.ts`
Expected: FAIL — `SetTripDates.newDayIds` is a uuid-bearing field the manifest has not classified. This test exists precisely to catch that.

- [ ] **Step 2: Classify `newDayIds` in the manifest**

In `idFields.ts`, classify `SetTripDates.newDayIds` as **minted** (server generates fresh ids), matching how `AddDay.dayId` is treated. The model must never emit a UUID.

- [ ] **Step 3: Run the enforcement test to verify it passes**

Run: `pnpm --filter web exec vitest run src/server/ai/idFields.test.ts`
Expected: PASS

- [ ] **Step 4: Add the two system-prompt rules**

In `handleAiRequest.ts`, add to the system prompt:

```
- Prefer SetTripDates over SetTripStartDate. SetTripDates sets the range AND
  matches the number of days to it; SetTripStartDate only moves day 1.
- Only set the trip name if the trip still has a placeholder name (for example
  "New trip") or the user explicitly asked you to rename it. Never rename a
  trip the user has already named as a side effect of another request.
```

- [ ] **Step 5: Run the AI suite**

Run: `pnpm --filter web exec vitest run src/server/ai`
Expected: PASS

- [ ] **Step 6: Live-prompt check — mocked tests cannot cover this (KI-11)**

Run the deployed/dev app and prompt: *"Create a 5 day trip to Rochester NY starting 2026-08-03 with lunches"*. Read `meta` in the response and confirm: `steps` well under 32, `resolutionErrors` empty, the trip is **named** and **dated**, and the day count matches the range. KI-11 is explicit that seven consecutive real-model bugs were invisible to the mocked suite; two overlapping date tools is exactly the kind of thing only a live call reveals.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/server/ai
git commit -m "feat(ai): expose trip name and dates as tools, guard renaming in the prompt"
```

---

### Task A13: Rename in the trip header

**Files:**
- Modify: `apps/web/src/components/trip/TripHeader.tsx`
- Test: `apps/web/src/components/trip/TripHeader.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```tsx
it("dispatches SetTripName when the title is edited", async () => {
  const onCommand = vi.fn();
  render(<TripHeader tripId={tripId} name="Japan" onCommand={onCommand} /* …existing props */ />);
  await userEvent.click(screen.getByRole("button", { name: /rename trip/i }));
  const input = screen.getByRole("textbox", { name: /trip name/i });
  await userEvent.clear(input);
  await userEvent.type(input, "Japan 2027{Enter}");
  expect(onCommand).toHaveBeenCalledWith({ type: "SetTripName", tripId, name: "Japan 2027" });
});

it("does not dispatch when the name is unchanged", async () => {
  const onCommand = vi.fn();
  render(<TripHeader tripId={tripId} name="Japan" onCommand={onCommand} /* … */ />);
  await userEvent.click(screen.getByRole("button", { name: /rename trip/i }));
  await userEvent.type(screen.getByRole("textbox", { name: /trip name/i }), "{Enter}");
  expect(onCommand).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/trip/TripHeader.test.tsx`
Expected: FAIL — no rename control.

- [ ] **Step 3: Implement**

Add an inline edit affordance to `TripHeader`: the title renders as text with a "Rename trip" button; activating it swaps in an `Input` (aria-label `Trip name`) seeded with the current name. Enter or blur commits via `onCommand({ type: "SetTripName", tripId, name })`; Escape cancels. Skip the dispatch when the trimmed value equals the current name or is empty — the domain would reject it as a no-op anyway, and a rejected command is a worse UX than doing nothing.

Use the existing `Input` and `Button` primitives from `components/ui` — the M5 lint wall bans raw text/control elements outside `components/ui/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/trip/TripHeader.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/trip/TripHeader.tsx apps/web/src/components/trip/TripHeader.test.tsx
git commit -m "feat(web): rename a trip from the header"
```

---

### Task A14: Date range in the settings sheet

**Files:**
- Modify: `apps/web/src/components/lenses/TripDateControl.tsx`
- Modify: `apps/web/src/components/trip/SettingsSheet.tsx`
- Test: `apps/web/src/components/lenses/TripDateControl.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("dispatches SetTripDates with enough fresh day ids to cover the range", async () => {
  const onCommand = vi.fn();
  render(<TripDateControl tripId={tripId} startDate={null} endDate={null} dayCount={1} onCommand={onCommand} />);
  await userEvent.type(screen.getByLabelText(/start date/i), "2026-07-07");
  await userEvent.type(screen.getByLabelText(/end date/i), "2026-07-09");
  await userEvent.click(screen.getByRole("button", { name: /set dates/i }));

  const command = onCommand.mock.calls[0]![0];
  expect(command.type).toBe("SetTripDates");
  expect(command.startDate).toBe("2026-07-07");
  expect(command.endDate).toBe("2026-07-09");
  // 3-day range against 1 existing day → 2 new ids needed; send a safe surplus.
  expect(command.newDayIds.length).toBeGreaterThanOrEqual(2);
});

it("warns before shrinking a range that would drop days", async () => {
  const onCommand = vi.fn();
  render(<TripDateControl tripId={tripId} startDate="2026-07-07" endDate="2026-07-09" dayCount={3} onCommand={onCommand} />);
  await userEvent.clear(screen.getByLabelText(/end date/i));
  await userEvent.type(screen.getByLabelText(/end date/i), "2026-07-07");
  await userEvent.click(screen.getByRole("button", { name: /set dates/i }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(/2 days.*backlog/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/lenses/TripDateControl.test.tsx`
Expected: FAIL — no end-date field.

- [ ] **Step 3: Implement**

Extend `TripDateControl` from a single start date to a range: `startDate` + `endDate` inputs and a "Set dates" button. Compute `newDayIds` client-side as `Array.from({ length: needed }, () => crypto.randomUUID())` where `needed = max(0, daySpan(start, end) - dayCount)` — mirroring how the board already mints a `dayId` per `AddDay`. Send a small surplus so an off-by-one never trips `not-enough-day-ids`.

When the new range is **shorter** than the current day count, confirm first via the existing `Dialog` primitive (M5's rule: Dialog for destructive-confirm only), naming how many days will be dropped and that their activities move to the backlog rather than being deleted.

`SettingsSheet` passes the new `endDate` and `dayCount` props through from `TripDetail` (`detail.days.length`, and the last day's `date`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/lenses/TripDateControl.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lenses/TripDateControl.tsx apps/web/src/components/lenses/TripDateControl.test.tsx apps/web/src/components/trip/SettingsSheet.tsx
git commit -m "feat(web): set a trip date range that reconciles day count"
```

---

### Task A15: Delete, duplicate, and the undo toast

**Files:**
- Modify: `apps/web/src/app/page.tsx` (trip list)
- Modify: `apps/web/src/components/trip/SettingsSheet.tsx`
- Create: `apps/web/src/components/ui/toast.tsx`
- Test: `apps/web/src/app/page.test.tsx`, `apps/web/src/components/ui/toast.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("deletes a trip and offers an undo that restores it", async () => {
  // fetch is mocked to return one trip, then 200s for the command calls
  render(<Home />);
  await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
  await userEvent.click(screen.getByRole("button", { name: /^delete$/i })); // confirm dialog

  const toast = await screen.findByRole("status");
  expect(toast).toHaveTextContent(/deleted "japan"/i);

  await userEvent.click(within(toast).getByRole("button", { name: /undo/i }));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(`/api/trips/${tripId}/commands`),
    expect.objectContaining({ body: expect.stringContaining('"RestoreTrip"') }),
  );
});

it("duplicates a trip and navigates to the copy", async () => {
  render(<Home />);
  await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /duplicate/i }));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(`/api/trips/${tripId}/duplicate`),
    expect.objectContaining({ method: "POST" }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/page.test.tsx`
Expected: FAIL — no trip-actions control.

- [ ] **Step 3: Implement**

Add a per-row actions menu (existing `Popover` primitive) to the trip list with **Duplicate** and **Delete**. Delete confirms via `Dialog`, then `POST /api/trips/:id/commands` with `{ type: "DeleteTrip", tripId }`, removes the row, and raises a toast.

Create a minimal `Toast` in `components/ui/toast.tsx`: `role="status"`, a message, an optional action button, and an auto-dismiss timer. Keep it to what this milestone needs — the undo action and a dismiss. The undo button dispatches `{ type: "RestoreTrip", tripId }` and reloads the list.

Duplicate calls `POST /api/trips/:id/duplicate` and routes to the new `tripId` on 201.

Also add Delete and Duplicate to `SettingsSheet` for the in-trip path; delete there routes back to the trip list and raises the same toast.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/page.test.tsx src/components/ui/toast.test.tsx`
Expected: PASS

- [ ] **Step 5: Run every gate separately (KI-13 — do not trust one `pnpm check`)**

```bash
pnpm typecheck && pnpm lint
```

Then per-package: `pnpm --filter @tc/contracts exec vitest run`, `pnpm --filter @tc/domain exec vitest run`, `pnpm --filter web exec vitest run`, and the int suite via the `set -a` recipe.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.tsx apps/web/src/components/ui/toast.tsx apps/web/src/components/ui/toast.test.tsx apps/web/src/components/trip/SettingsSheet.tsx
git commit -m "feat(web): delete and duplicate trips, with undo on delete"
```

---

# Wave B — Subtraction

### Task B1: Retire the anchors UI, keep the domain dormant

**Files:**
- Delete: `apps/web/src/components/board/AnchorEditor.tsx`, `apps/web/src/components/board/AnchorEditor.test.tsx`
- Modify: `apps/web/src/components/board/ActivityEditor.tsx`
- Modify: `packages/domain/src/trip/conflicts.ts` (dormancy note)
- Keep untouched: `anchor-conflicts.test.ts`, `anchors-state.test.ts`, `apps/web/src/server/anchors.int.test.ts`

- [ ] **Step 1: Verify no production trip carries an anchor**

⚠️ **Do this before deleting anything.** After the UI is gone, an activity with an existing anchor keeps firing anchor-violation conflicts that no surface can explain or clear.

```bash
psql "$PRODUCTION_DATABASE_URL" -c "select count(*) from trip_details where doc::text like '%\"anchors\":[{%';"
```

Expected: `0`. If non-zero, list the affected trips and clear those anchors with an `UpdateActivity` command (`anchors: []`) per activity **before** proceeding — never by writing the projection directly (Invariant 1).

- [ ] **Step 2: Write the failing test**

In `ActivityEditor.test.tsx`:

```tsx
it("offers no anchor affordance", () => {
  render(<ActivityEditor {...props} />);
  expect(screen.queryByText(/anchor/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/board/ActivityEditor.test.tsx`
Expected: FAIL — anchor controls are present.

- [ ] **Step 4: Remove the UI**

```bash
git rm apps/web/src/components/board/AnchorEditor.tsx apps/web/src/components/board/AnchorEditor.test.tsx
```

Remove the `AnchorEditor` import, its render, and any anchor state from `ActivityEditor.tsx`. `UpdateActivity` keeps its `anchors` field (contract unchanged); the editor simply stops sending it, so existing values pass through untouched.

- [ ] **Step 5: Add the dormancy note**

At the top of the anchor rules in `packages/domain/src/trip/conflicts.ts`:

```ts
// DORMANT BY DECISION (Mitchell, 2026-07-28) — known-issues.md § "Dormant by
// decision", D-1. No UI reaches anchors: AnchorEditor and its entry points were
// removed in M8 because anchors were never made legible (and `publicHoliday`
// had a permissive stub oracle, so it could never fire at all).
//
// These rules and their tests stay ON PURPOSE. If a change of yours breaks
// them, the build fails — that is the tripwire working. DECIDE: revive anchors
// with a real UI, or delete the feature. Do not reflexively repair code no user
// can reach.
```

- [ ] **Step 6: Run tests to verify**

Run: `pnpm --filter web exec vitest run src/components/board` and `pnpm --filter @tc/domain exec vitest run src/trip/`
Expected: PASS — anchor domain tests still green (the tripwire).

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/components/board packages/domain/src/trip/conflicts.ts
git commit -m "refactor(web): retire the anchors UI, keep the domain dormant (D-1)"
```

---

### Task B2: Retire `ConflictContext.timezone`

**Files:**
- Modify: `packages/domain/src/trip/conflicts.ts`
- Modify: `apps/web/src/server/conflictContext.ts`
- Modify: `apps/web/src/server/config.ts` (drop `TRIP_TIMEZONE`)
- Modify: `docs/architecture/ADR-006-*.md`

- [ ] **Step 1: Confirm it is genuinely unread**

```bash
grep -rn "timezone\|TRIP_TIMEZONE" packages/ apps/web/src --include=*.ts --include=*.tsx
```

Expected: only the definition, the injection, and the config read — no rule consumes it. If any rule does, stop and document why it stays instead.

- [ ] **Step 2: Remove the field**

Drop `timezone` from `ConflictContext` and `DEFAULT_CONFLICT_CONTEXT`, from `serverConflictContext()`, and `TRIP_TIMEZONE` from `config.ts`.

- [ ] **Step 3: Run typecheck and the domain suite**

Run: `pnpm typecheck && pnpm --filter @tc/domain exec vitest run`
Expected: PASS

- [ ] **Step 4: Amend ADR-006**

Append a dated amendment recording that `timezone` was specified but never read by any rule, and was removed in M8; note that a future time-zone-aware rule reintroduces it deliberately rather than inheriting dead config.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/trip/conflicts.ts apps/web/src/server/conflictContext.ts apps/web/src/server/config.ts docs/architecture
git commit -m "refactor(domain): remove the unread ConflictContext.timezone (ADR-006 amended)"
```

---

### Task B3: Notebook back to plain notes

**Files:**
- Modify: `apps/web/src/components/pages/editor/PageEditor.tsx`
- Delete: `apps/web/src/components/pages/editor/MacroSuggestionList.tsx`, `apps/web/src/components/pages/editor/useMacroSuggestion.ts`
- Modify: `packages/pages/src/templates.ts`
- Test: `apps/web/src/components/pages/editor/PageEditor.test.tsx`

⚠️ **`MacroNodeExtension` must stay registered.** `PageContent` is stored TipTap JSON; unregistering the extension drops existing macro nodes on the next save. Authoring leaves, rendering stays.

- [ ] **Step 1: Write the failing tests**

```tsx
it("offers no macro autocomplete", async () => {
  render(<PageEditor {...props} />);
  await userEvent.type(screen.getByRole("textbox"), "{{");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("preserves an existing macro node through load, edit, and save", async () => {
  const onSave = vi.fn();
  const content = {
    type: "doc",
    content: [{ type: "macro", attrs: { name: "cost.trip", params: {} } }],
  };
  render(<PageEditor content={content} onSave={onSave} {...props} />);
  await userEvent.type(screen.getByRole("textbox"), "hello");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  const saved = onSave.mock.calls[0]![0];
  expect(JSON.stringify(saved)).toContain('"macro"');
  expect(JSON.stringify(saved)).toContain("cost.trip");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run src/components/pages/editor/PageEditor.test.tsx`
Expected: FAIL — the autocomplete listbox appears.

- [ ] **Step 3: Remove authoring, keep rendering**

```bash
git rm apps/web/src/components/pages/editor/MacroSuggestionList.tsx apps/web/src/components/pages/editor/useMacroSuggestion.ts
```

In `PageEditor.tsx`, remove the suggestion plugin wiring and those imports. **Keep `MacroNodeExtension` in the extensions array** and add:

```ts
// Macro AUTHORING left the primary surface in M8 (seven macros is not a
// vocabulary; the block renderers never had a design pass). RENDERING stays
// registered on purpose: page content is stored ProseMirror JSON, so
// unregistering this extension would silently DROP existing macro nodes on the
// next save. The authoring vocabulary returns in M14.
```

- [ ] **Step 4: Make the seeded templates plain**

In `packages/pages/src/templates.ts`, replace macro nodes in the Trip Overview and Day Sheet `content` with plain headings and paragraphs — a starter that prompts writing, not a page full of objects nobody can author. Keep both titles and their `buildContext` bindings unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run src/components/pages` and `pnpm --filter @tc/pages exec vitest run`
Expected: PASS — the registry and macro resolver tests are untouched and stay green.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/components/pages packages/pages/src/templates.ts
git commit -m "refactor(web): pull the Notebook back to plain notes, keep macro rendering"
```

---

# Wave C — Core-loop ergonomics

### Task C1: Quick-add an activity

**Files:**
- Modify: `apps/web/src/components/board/Column.tsx`
- Test: `apps/web/src/components/board/board.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("adds an activity by title and clears the input for the next one", async () => {
  const onCommand = vi.fn();
  render(<Column day={day} dayIndex={0} onCommand={onCommand} {...props} />);
  const input = screen.getByRole("textbox", { name: /add to day 1/i });
  await userEvent.type(input, "Ramen{Enter}");
  expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: "AddActivity", dayId: day.dayId, title: "Ramen",
  }));
  expect(input).toHaveValue("");
});

it("ignores an empty or whitespace-only title", async () => {
  const onCommand = vi.fn();
  render(<Column day={day} dayIndex={0} onCommand={onCommand} {...props} />);
  await userEvent.type(screen.getByRole("textbox", { name: /add to day 1/i }), "   {Enter}");
  expect(onCommand).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/board/board.test.tsx`
Expected: FAIL — no quick-add input.

- [ ] **Step 3: Implement**

Add an `Input` at the foot of each column, `aria-label={`Add to Day ${dayIndex + 1}`}`. On Enter with a non-empty trimmed value, dispatch `{ type: "AddActivity", tripId, activityId: crypto.randomUUID(), dayId, title }` and clear the field, keeping focus so several can be typed in a row.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/board/board.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board
git commit -m "feat(web): quick-add an activity from the column foot"
```

---

### Task C2: Add an activity by searching for a place

**Files:**
- Create: `apps/web/src/components/board/AddPlaceButton.tsx`
- Modify: `apps/web/src/components/board/Column.tsx`
- Test: `apps/web/src/components/board/AddPlaceButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("creates an activity titled from the picked place, with its location", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results: [{ lat: 43.1, lng: -77.6, canonicalName: "Rochester, NY", countryCode: "US" }] }),
  });
  const onCommand = vi.fn();
  render(<AddPlaceButton tripId={tripId} dayId={dayId} dayIndex={0} onCommand={onCommand} />);

  await userEvent.click(screen.getByRole("button", { name: /add a place to day 1/i }));
  await userEvent.type(screen.getByRole("searchbox", { name: /search for a place/i }), "rochester{Enter}");
  await userEvent.click(await screen.findByRole("option", { name: /rochester, ny/i }));

  expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: "AddActivity",
    dayId,
    title: "Rochester, NY",
    location: { name: "Rochester, NY", lat: 43.1, lng: -77.6, countryCode: "US" },
  }));
});

it("says so when the search returns nothing", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
  render(<AddPlaceButton tripId={tripId} dayId={dayId} dayIndex={0} onCommand={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /add a place to day 1/i }));
  await userEvent.type(screen.getByRole("searchbox", { name: /search for a place/i }), "zzzz{Enter}");
  expect(await screen.findByText(/no places found/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/board/AddPlaceButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

A `Popover`-hosted search: a `searchbox` posting to `/api/geocode?q=`, results as `role="option"` rows. Picking one dispatches a single `AddActivity` with `title` = `canonicalName` and `location` = the full result, then closes. Reuse the fetch/error shape already in `LocationInput.tsx` (including its "Could not search for that place" failure text) rather than inventing a second geocode client.

Render it in `Column.tsx` beside the quick-add input.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/board/AddPlaceButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board
git commit -m "feat(web): add an activity by searching for a place"
```

---

### Task C3: Move an activity without dragging

Drag-and-drop already works and is the thing to protect. This is the keyboard and touch path.

**Files:**
- Modify: `apps/web/src/components/board/ActivityCard.tsx`
- Test: `apps/web/src/components/board/board.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("moves an activity to another day from its menu", async () => {
  const onCommand = vi.fn();
  render(<Board detail={detailWithTwoDays} onCommand={onCommand} {...props} />);
  await userEvent.click(screen.getByRole("button", { name: /actions for ramen/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /move to…/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /day 2/i }));
  expect(onCommand).toHaveBeenCalledWith({
    type: "MoveActivity", tripId, activityId, toDayId: day2Id, position: 0,
  });
});

it("offers the backlog as a move target", async () => {
  const onCommand = vi.fn();
  render(<Board detail={detailWithTwoDays} onCommand={onCommand} {...props} />);
  await userEvent.click(screen.getByRole("button", { name: /actions for ramen/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /move to…/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /backlog/i }));
  expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ toDayId: null }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/board/board.test.tsx`
Expected: FAIL — no actions menu.

- [ ] **Step 3: Implement**

Add a per-card actions `Popover` with "Move to…", listing every day (`Day N`, with its date when set) plus Backlog, excluding the activity's current location. Dispatch `MoveActivity` with `position: 0` (top of the target). Leave every existing drag handler untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/board/board.test.tsx`
Expected: PASS — including the existing drag tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board
git commit -m "feat(web): move an activity from a menu as well as by dragging"
```

---

### Task C4: The KI-5 sync indicator

Quick-add is a rapid-fire command generator pointed straight at KI-5: commands still queued behind the one in flight are dropped on navigation with no error and no visual difference. `pending` is already exposed on `useTrip()`; this makes it visible, per KI-5's recorded fix path.

**Files:**
- Create: `apps/web/src/components/trip/SyncIndicator.tsx`
- Modify: `apps/web/src/components/trip/TripHeader.tsx`
- Test: `apps/web/src/components/trip/SyncIndicator.test.tsx`
- Modify: `docs/known-issues.md`

- [ ] **Step 1: Write the failing test**

```tsx
it("says saving while commands are in flight", () => {
  render(<SyncIndicator pending={2} />);
  expect(screen.getByRole("status")).toHaveTextContent(/saving/i);
});

it("says all changes saved when the queue is drained", () => {
  render(<SyncIndicator pending={0} />);
  expect(screen.getByRole("status")).toHaveTextContent(/all changes saved/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/trip/SyncIndicator.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

A small `role="status"` element rendering "Saving…" when `pending > 0` and "All changes saved" otherwise. Render it in `TripHeader`, fed from `useTrip().pending`. Deliberately **no** `beforeunload` guard — the recorded direction is a visible indicator, not blocked navigation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/trip/SyncIndicator.test.tsx`
Expected: PASS

- [ ] **Step 5: Update KI-5**

In `docs/known-issues.md`, record that M8 landed the visible sync indicator — the first half of the recorded fix path — and that the underlying silent-drop-on-navigation risk remains open for M13, where concurrent multi-actor writes make it more consequential.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/trip docs/known-issues.md
git commit -m "feat(web): show sync state so unsaved work is visible (KI-5)"
```

---

# Wave D — First-run and empty states

### Task D1: First-run state for a new trip

**Files:**
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx`
- Test: `apps/web/src/components/board/TripBoardScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("shows a first-run state naming the next actions when a trip has no days", () => {
  render(<TripBoardScreen detail={{ ...detail, days: [], backlog: [] }} {...props} />);
  const panel = screen.getByRole("region", { name: /get started/i });
  expect(within(panel).getByRole("button", { name: /set dates/i })).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: /add a day/i })).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
});

it("shows the board once the trip has a day", () => {
  render(<TripBoardScreen detail={detailWithOneDay} {...props} />);
  expect(screen.queryByRole("region", { name: /get started/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/board/TripBoardScreen.test.tsx`
Expected: FAIL — a bare empty grid renders.

- [ ] **Step 3: Implement**

When `detail.days.length === 0 && detail.backlog.length === 0`, render a `region` labelled "Get started" in place of the empty grid, with three actions: **Set dates** (opens `SettingsSheet`), **Add a day** (dispatches `AddDay`), **Ask AI** (opens the compose panel). Compose from the existing `EmptyState` primitive; no new primitives.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/board/TripBoardScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board
git commit -m "feat(web): first-run state for a brand-new trip"
```

---

### Task D2: Empty states across every surface

**Files:**
- Modify: `apps/web/src/components/board/Column.tsx`, `apps/web/src/components/lenses/MapLens.tsx`, `TimelineLens.tsx`, `ItineraryLens.tsx`, `apps/web/src/components/pages/NotebookScreen.tsx`, `apps/web/src/components/board/HistoryPanel.tsx`
- Test: one case per surface in each component's existing test file

Each empty state says **what the surface is** and offers **one** next action.

| Surface | Condition | Message | Action |
|---|---|---|---|
| Day column | no activities | "Nothing planned yet" | focus quick-add |
| Backlog | empty | "Ideas you haven't scheduled land here" | — |
| Map | no located activities | "No activities have a location yet" | "Add a place" |
| Timeline | no timed activities | "No activities have a time yet" | "Set a time" |
| Itinerary | no days | "This trip has no days yet" | "Add a day" |
| Notebook | no pages | "No notes yet" | "New page" |
| History | only the creation entry | "Changes you make will show up here" | — |

- [ ] **Step 1: Write one failing test per surface**

```tsx
// e.g. MapLens.test.tsx
it("explains the empty map and offers the next action", () => {
  render(<MapLens detail={{ ...detail, activities: {} }} {...props} />);
  expect(screen.getByText(/no activities have a location yet/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /add a place/i })).toBeInTheDocument();
});
```

Write the equivalent for each row of the table above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run src/components/lenses src/components/pages src/components/board`
Expected: FAIL — one per surface.

- [ ] **Step 3: Implement**

Render `EmptyState` (or `EmptyChip` where inline) per the table. Copy is interaction design, not visual craft — no palette or layout changes; M10 owns those.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): give every surface an empty state with a next action"
```

---

### Task D3: M8 e2e and gate close

**Files:**
- Create: `apps/web/e2e/m8-make-it-real.spec.ts`
- Modify: `TODO.md`, `docs/milestones/M8-make-it-real.md`, `docs/milestones/README.md`, `docs/STATUS.md`
- Delete: `docs/plans/2026-07-28-M8-make-it-real.md`

- [ ] **Step 1: Write the e2e script — it *is* the exit gate**

```ts
// apps/web/e2e/m8-make-it-real.spec.ts
test("create, name, date, build, reorder, rename, delete", async ({ page }) => {
  await signIn(page);                                  // e2e/helpers.ts
  await page.getByLabel("Trip name").fill("Rochester");
  await page.getByRole("button", { name: "Create trip" }).click();

  await page.getByRole("button", { name: /trip settings/i }).click();
  await page.getByLabel(/start date/i).fill("2026-08-03");
  await page.getByLabel(/end date/i).fill("2026-08-05");
  await page.getByRole("button", { name: /set dates/i }).click();
  await expect(page.getByRole("region", { name: /day 3/i })).toBeVisible();

  await page.getByRole("textbox", { name: /add to day 1/i }).fill("Coffee");
  await page.getByRole("textbox", { name: /add to day 1/i }).press("Enter");
  await expect(page.getByText("Coffee")).toBeVisible();

  await page.getByRole("button", { name: /add a place to day 2/i }).click();
  await page.getByRole("searchbox", { name: /search for a place/i }).fill("Niagara Falls");
  await page.getByRole("searchbox", { name: /search for a place/i }).press("Enter");
  await page.getByRole("option").first().click();
  await expect(page.getByText(/niagara/i)).toBeVisible();

  await page.getByRole("button", { name: /actions for coffee/i }).click();
  await page.getByRole("menuitem", { name: /move to…/i }).click();
  await page.getByRole("menuitem", { name: /day 3/i }).click();

  await page.getByRole("button", { name: /rename trip/i }).click();
  await page.getByRole("textbox", { name: /trip name/i }).fill("Rochester 2026");
  await page.getByRole("textbox", { name: /trip name/i }).press("Enter");
  await expect(page.getByText("Rochester 2026")).toBeVisible();

  await expect(page.getByText(/all changes saved/i)).toBeVisible();  // KI-5

  await page.goto("/");
  await page.getByRole("button", { name: /trip actions for rochester 2026/i }).click();
  await page.getByRole("menuitem", { name: /delete/i }).click();
  await page.getByRole("button", { name: /^delete$/i }).click();
  await expect(page.getByText("Rochester 2026")).not.toBeVisible();

  await page.getByRole("button", { name: /undo/i }).click();          // restore
  await expect(page.getByText("Rochester 2026")).toBeVisible();
});
```

**Wait for each mutating action's confirming response before the next** (the `m6-optimistic.spec.ts` pattern) — KI-5 means a rapid unconfirmed sequence can genuinely lose commands, and that would surface here as a confusing flake.

- [ ] **Step 2: Run every e2e script**

Run: `pnpm --filter web exec playwright test --workers=1`
Expected: PASS — m8 plus every prior milestone's script.

- [ ] **Step 3: Run every gate separately (KI-13)**

```bash
pnpm typecheck && pnpm lint
```

Then per-package vitest and the int suite via the `set -a` recipe. Re-run any single failure in isolation before believing it.

- [ ] **Step 4: Run the gate-close checklist**

Per `docs/milestones/README.md`, in **one commit**:
1. Tick M8 in `TODO.md`.
2. Check every exit-gate box in `docs/milestones/M8-make-it-real.md`.
3. Append the retro note to that milestone file.
4. Bump **Current milestone** at the bottom of `docs/milestones/README.md` to **M9**.
5. Update `docs/STATUS.md`.
6. Delete this plan — `docs/plans/README.md` makes plans staging-area artifacts, removed at gate close once anything durable is promoted to an ADR, milestone note, or known issue.

- [ ] **Step 5: Confirm the gate's actual criterion**

The gate is not the test suite. It is: **you run that script without asking how anything works.** If any step needed explanation, that is a finding for the retro, not a box to tick.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(M8): gate close — make it real"
```

---

## Notes carried forward

- **New known issue to file during Wave A** (referenced by the changelog entry in Task A1): **KI-15 — `SetTripStartDate` is superseded by `SetTripDates` but not deprecated.** Both remain in `BatchableCommand`, so the AI sees two overlapping date tools, mitigated only by a system-prompt preference. The `TripStartDateSetV1` event must be kept for replay regardless. Needs a deprecation plan; deliberately not done in M8 (spec decision 6).
- **KI-2** (money formatting differs between UI and domain) becomes fixable in Wave A, which touches `packages/domain` — its recorded fix path says "when a domain change is next in scope." Out of M8's scope; note it, do not fold it in.
