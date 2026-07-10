# M3 Place & Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** Turn ordinal days into real calendar dates; add map / timeline / calendar lenses over the same projection; add date-anchored activities whose constraints become soft `warn` conflicts when the trip's dates shift — all through the one command pipeline, undo/revert-correct via the existing ADR-005 machinery.

**Architecture:** Same as M0–M2 (ADR-001/002/003/005) plus two new mechanism decisions. Dates are **derived, not stored** (`deriveDayDates`, exposed on `TripDetail.days[].date`) reusing the existing `SetTripStartDate`/`TripStartDateSet` — no new events. Anchors ride on the existing activity commands/events. The pure conflict engine gains an injected `ctx` (holiday oracle + timezone) so it evaluates external/temporal facts without I/O (ADR-006). Geocoding is a server-internal `Geocoder` port + LocationIQ adapter, called as pre-command enrichment (ADR-007); the domain never geocodes. Spec: `docs/specs/2026-07-09-M3-place-and-time-design.md`.

**Tech Stack:** Everything M2 used, plus exactly **one** new runtime dependency: `maplibre-gl` (map rendering). Dates use plain ISO string math — no date library. `date-holidays` is explicitly deferred (publicHoliday is inert in M3).

## Global Constraints

- Read `AGENTS.md` before starting. Its invariants override convenience, always.
- Node >= 20, pnpm >= 9. All commands run from the repo root unless stated. Local Postgres for integration tests: `docker compose up -d` (port 5433); dev server on 3001. Never hardcode a port/URL; use the existing `apps/web/src/config.ts` / `apps/web/src/server/config.ts` defaults.
- **Branch:** create `m3-place-and-time` from `main` (isolated worktree recommended via superpowers:using-git-worktrees). One PR at the end (Task I4). CI green before merge.
- Events are forever: never edit stored events; all new event schemas are `version: 1`; event payloads use explicit `null`, never missing keys. New optional fields on **existing** event payloads MUST use `.default(...)` so `TripEvent.parse` still accepts every previously stored event (verified by a test in Task 1).
- `packages/domain` does **no I/O, no clock reads, no randomness** (invariant 4). `deriveDayDates` and `detectConflicts` construct dates only from explicit `YYYY-MM-DD` components (`Date.UTC(...)`), never `new Date()`/`Date.now()`. The holiday oracle and timezone are **passed in** via `ctx`.
- No writes to `trip_summaries` or `trip_details` outside `apps/web/src/server/projections.ts` (invariant 1). UI code (including `src/mocks`) may import only `@tc/contracts` + the typed client, never `@tc/domain` (lint wall). Geocoding I/O lives only under `apps/web/src/server/**`.
- Every command still goes `command → validate → append → project`; every event carries `actor_id`; all permission checks go through `AccessPolicy`. The `/api/geocode` route requires an authenticated session, exactly like `/commands`.
- **No DB migration is required.** Anchors live in the `events.payload` jsonb; day dates live in the `trip_details.doc` jsonb. Nothing changes the SQL schema. The only new environment value is `LOCATIONIQ_API_KEY` (Task S1 / I4).
- Commit after every task with the exact message given (conventional commits).
- **Known red window:** `pnpm typecheck` fails between Task 1 and Task D2 (the grown `ActivityView`/`ActivityState`/event payloads make projections and `TripDetail` literals in tests miss `anchors`/`date`). Task 1 verifies the contracts package only; the workspace goes green again from Task D2 onward. Do not "fix" this early by weakening types.

## Workstreams & parallel dispatch (AGENTS.md workstream model)

**Task 1 (Contracts) is the meeting point — it lands and is reviewed/merged first.** After Task 1, three workstreams are **mutually independent** and can be dispatched as **parallel subagents**:

| Track | Tasks | Depends on | Independent of |
|---|---|---|---|
| **D — Domain** (pure anchor/date/conflict logic) | D1, D2, D3 | Task 1 only | UI track, geocoding track |
| **S-geo — Server geocoding** (Geocoder port + adapter + route) | S1 | Task 1 only | Domain track, UI track |
| **U — UI** (map/timeline/calendar/anchor editor **against MSW mocks**) | U1 → (U2, U3, U4, U5) | Task 1 only (U1 first, then U2–U5 parallel) | Domain track, geocoding track |

The domain track and the UI track **never touch the same files** and share no runtime state — the UI builds entirely against contract-derived MSW mocks (U1), exactly as M1/M2 did. Within a track, order is D1→D2→D3 and U1→{U2,U3,U4,U5}.

**Integration tasks run after their tracks converge** (a single coordinating session, not parallel):
- **I1 (server wiring)** needs Track D merged (calls the new domain signatures).
- **I2 (wire UI to real API)** needs Track U + I1 + S1 merged.
- **I3 (e2e)** and **I4 (retro + PR)** need everything.

A dependency at a glance:

```
Task 1 ──┬──► D1 ► D2 ► D3 ─────────────┐
         ├──► S1 ──────────────────────┤
         └──► U1 ►┬─ U2 ─┐             ├──► I1 ► I2 ► I3 ► I4
                  ├─ U3 ─┤             │
                  ├─ U4 ─┤─────────────┘
                  └─ U5 ─┘
```

---

### Task 1: Contracts — Anchor union, activity anchors, day date, location country

**Files:**
- Modify: `packages/contracts/src/activity.ts`, `packages/contracts/src/detail.ts`, `packages/contracts/src/index.ts` (already re-exports `./activity`, `./detail` — no change if so; verify)
- Modify: `docs/contracts/CHANGELOG.md`
- Test: `packages/contracts/test/anchors.test.ts` (create; mirror the existing contracts test layout — if none, create `test/` and confirm `pnpm --filter @tc/contracts test` picks it up)

**Interfaces:**
- Produces (consumed by every later task):
  - `Weekday` — `z.enum(["mon","tue","wed","thu","fri","sat","sun"])`.
  - `Anchor` — discriminated union on `kind`: `{kind:"dayOfWeek", days: Weekday[]}` | `{kind:"dateRange", from, to}` (ISO dates, `from <= to`) | `{kind:"timeOfDay", window: TimeWindow}` | `{kind:"publicHoliday", country}` (ISO-3166 alpha-2). Exposed as `z.array(Anchor)`.
  - `Location` gains optional `countryCode` (ISO-3166 alpha-2, uppercase).
  - `AddActivity`/`UpdateActivity` gain `anchors` (command-side: omitted = unchanged, explicit array replaces, `[]` clears).
  - `ActivityAddedV1`/`ActivityUpdatedV1` payloads gain `anchors: z.array(Anchor).default([])` (default = non-breaking for stored events).
  - `ActivityView` gains `anchors: Anchor[]`; `TripDetail.days[]` gains `date: z.string().nullable()`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/test/anchors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  Anchor,
  Location,
  TripCommand,
  TripEvent,
  TripDetail,
} from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";

describe("M3 anchor + place/time contracts", () => {
  it("parses every anchor kind and rejects a backwards dateRange", () => {
    expect(Anchor.parse({ kind: "dayOfWeek", days: ["mon", "tue"] }).kind).toBe("dayOfWeek");
    expect(Anchor.parse({ kind: "dateRange", from: "2026-10-31", to: "2026-10-31" }).kind).toBe("dateRange");
    expect(Anchor.parse({ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }).kind).toBe("timeOfDay");
    expect(Anchor.parse({ kind: "publicHoliday", country: "FR" }).kind).toBe("publicHoliday");
    expect(() => Anchor.parse({ kind: "dateRange", from: "2026-10-31", to: "2026-10-01" })).toThrow();
    expect(() => Anchor.parse({ kind: "publicHoliday", country: "fra" })).toThrow();
  });

  it("Location accepts an optional uppercase countryCode", () => {
    expect(Location.parse({ name: "Rome", lat: 41.9, lng: 12.5, countryCode: "IT" }).countryCode).toBe("IT");
    expect(Location.parse({ name: "Rome" }).countryCode).toBeUndefined();
  });

  it("AddActivity/UpdateActivity carry anchors", () => {
    const add = TripCommand.parse({
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Market",
      anchors: [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }],
    });
    expect(add.type).toBe("AddActivity");
    const upd = TripCommand.parse({ type: "UpdateActivity", tripId: TRIP, activityId: A1, anchors: [] });
    expect(upd.type).toBe("UpdateActivity");
  });

  it("previously-stored ActivityAdded/Updated events (no anchors field) still parse, defaulting to []", () => {
    const added = TripEvent.parse({
      type: "ActivityAdded", version: 1,
      payload: { tripId: TRIP, activityId: A1, dayId: null, title: "Market", timeWindow: null, location: null, notes: null },
    });
    if (added.type !== "ActivityAdded") throw new Error("wrong type");
    expect(added.payload.anchors).toEqual([]);
    const updated = TripEvent.parse({
      type: "ActivityUpdated", version: 1,
      payload: { tripId: TRIP, activityId: A1, title: "Market", timeWindow: null, location: null, notes: null },
    });
    if (updated.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(updated.payload.anchors).toEqual([]);
  });

  it("TripDetail day carries a nullable derived date and activity carries anchors", () => {
    const detail = {
      tripId: TRIP, name: "Rome", startDate: "2026-10-12",
      members: [{ userId: "u1", role: "owner" }],
      days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12" }],
      backlog: [], conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
      activities: { [A1]: { activityId: A1, title: "Market", timeWindow: null, location: null, notes: null, anchors: [] } },
    };
    expect(TripDetail.parse(detail).days[0]!.date).toBe("2026-10-12");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @tc/contracts test`
Expected: FAIL — `Anchor` not exported.

- [ ] **Step 3: Implement — `packages/contracts/src/activity.ts`**

Add near the top (after `TimeWindow`, before `Location`):

```ts
export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;

const ISO_DATE_A = /^\d{4}-\d{2}-\d{2}$/;

// Constraint on WHEN an activity may fall. All four ship in M3; the first three
// evaluate live (domain Task D3), publicHoliday is inert (permissive stub).
export const Anchor = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("dayOfWeek"), days: z.array(Weekday).min(1) }),
    z.object({ kind: z.literal("dateRange"), from: z.string().regex(ISO_DATE_A), to: z.string().regex(ISO_DATE_A) }),
    z.object({ kind: z.literal("timeOfDay"), window: TimeWindow }),
    z.object({ kind: z.literal("publicHoliday"), country: z.string().regex(/^[A-Z]{2}$/) }),
  ])
  .superRefine((a, ctx) => {
    if (a.kind === "dateRange" && a.from > a.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "from must be <= to" });
    }
  });
export type Anchor = z.infer<typeof Anchor>;
```

Change `Location` to add `countryCode` (keep the existing lat/lng refine):

```ts
export const Location = z
  .object({
    name: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/).optional(), // populated by the geocoder (ADR-007)
  })
  .refine((l) => (l.lat === undefined) === (l.lng === undefined), {
    message: "lat and lng must be provided together",
  });
export type Location = z.infer<typeof Location>;
```

`AddActivity` gains `anchors: z.array(Anchor).optional()`; `UpdateActivity` gains `anchors: z.array(Anchor).optional()` (omitted = unchanged; an explicit array replaces the set). Add the field to both objects.

`ActivityAddedV1.payload` and `ActivityUpdatedV1.payload` each gain:

```ts
    anchors: z.array(Anchor).default([]),
```

- [ ] **Step 4: Implement — `packages/contracts/src/detail.ts`**

`ActivityView` gains `anchors: z.array(Anchor)`; import `Anchor` from `./activity` (extend the existing `{ Location, TimeWindow }` import). `TripDetail.days` element gains `date`:

```ts
  days: z.array(
    z.object({ dayId: z.string().uuid(), activityIds: z.array(z.string().uuid()), date: z.string().nullable() }),
  ),
```

`packages/contracts/src/index.ts` — confirm it re-exports `./activity` and `./detail` (it does via `export *`); no change needed.

- [ ] **Step 5: Run the contracts tests**

Run: `pnpm --filter @tc/contracts test && pnpm --filter @tc/contracts typecheck`
Expected: PASS. (Root `pnpm typecheck` is EXPECTED to fail until Task D2 — the red window.)

- [ ] **Step 6: Changelog + commit**

Append to `docs/contracts/CHANGELOG.md`:

```markdown
## 2026-07-09 — M3 place & time schemas
- Added: `Weekday`, `Anchor` (union: dayOfWeek | dateRange | timeOfDay | publicHoliday)
- Added: `anchors` on `AddActivity`/`UpdateActivity` (optional) and on
  `ActivityAddedV1`/`ActivityUpdatedV1` payloads (`z.array(Anchor).default([])`)
- Added: `Location.countryCode` (optional, ISO-3166 alpha-2)
- Added: `ActivityView.anchors`; `TripDetail.days[].date` (nullable derived date)
- Why: M3 — date-anchored activities, derived day dates, geocoded locations
- Consumers updated: `@tc/domain` (state/evolve/decide/diff/equality/conflicts/
  detail), `apps/web` (projection wiring, mocks, lens UI) — same PR
- Breaking? no — event payload additions default, so `TripEvent.parse` accepts
  all previously stored events unchanged; DTO additions are new required fields
  produced only by the updated projection
```

```bash
git add packages/contracts docs/contracts/CHANGELOG.md
git commit -m "feat(contracts): anchors, derived day date, location countryCode"
```

---

## Track D — Domain (parallelizable with Tracks S-geo and U after Task 1)

### Task D1: Domain — `deriveDayDates` + day dates on the detail

**Files:**
- Create: `packages/domain/src/trip/dates.ts`
- Modify: `packages/domain/src/trip/detail.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/test/dates.property.test.ts`

**Interfaces:**
- Produces: `deriveDayDates(startDate: string | null, dayCount: number): (string | null)[]` (pure); `tripDetailFromState` now populates `days[].date`.

- [ ] **Step 1: Write `deriveDayDates`**

`packages/domain/src/trip/dates.ts`:

```ts
// Pure ISO-date math. NO wall-clock reads — dates are built only from explicit
// YYYY-MM-DD components via Date.UTC (deterministic), never `new Date()`.
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Day 1 is pinned to startDate; day i (0-indexed) = startDate + i days.
// startDate === null → every day is undated (ordinal-only).
export function deriveDayDates(startDate: string | null, dayCount: number): (string | null)[] {
  if (startDate === null) return Array.from({ length: dayCount }, () => null);
  return Array.from({ length: dayCount }, (_, i) => addDaysIso(startDate, i));
}
```

`packages/domain/src/index.ts` — add `export * from "./trip/dates";`.

- [ ] **Step 2: Populate the date in `tripDetailFromState`**

In `packages/domain/src/trip/detail.ts`, import `deriveDayDates` and change the `days` mapping to attach the derived date by index:

```ts
import { deriveDayDates } from "./dates";
// ...
  const dayDates = deriveDayDates(state.startDate, state.days.length);
  // ...
    days: state.days.map((d, i) => ({ dayId: d.dayId, activityIds: [...d.activityIds], date: dayDates[i]! })),
```

(`dayDates[i]` is `string | null`; the `!` asserts the index exists — `deriveDayDates` returns exactly `state.days.length` entries.)

- [ ] **Step 3: Write the property test**

`packages/domain/test/dates.property.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveDayDates } from "../src";

const isoDate = fc
  .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2099, 11, 31)) })
  .map((d) => d.toISOString().slice(0, 10));

describe("deriveDayDates", () => {
  it("null start → all null, length preserved", () => {
    fc.assert(fc.property(fc.nat({ max: 60 }), (n) => {
      expect(deriveDayDates(null, n)).toEqual(Array.from({ length: n }, () => null));
    }));
  });

  it("day 0 is the start date; consecutive days differ by exactly one calendar day", () => {
    const utcMs = (iso: string): number => {
      const [y, m, d] = iso.split("-").map(Number);
      return Date.UTC(y!, m! - 1, d!);
    };
    fc.assert(fc.property(isoDate, fc.integer({ min: 1, max: 60 }), (start, n) => {
      const dates = deriveDayDates(start, n) as string[];
      expect(dates[0]).toBe(start);
      for (let i = 1; i < n; i++) {
        expect((utcMs(dates[i]!) - utcMs(dates[i - 1]!)) / 86_400_000).toBe(1);
      }
    }));
  });

  it("shifting the trip start forward by K then back by K reproduces the same day dates (drag-the-vacation identity)", () => {
    fc.assert(fc.property(isoDate, fc.integer({ min: 1, max: 30 }), fc.integer({ min: -20, max: 20 }), (start, n, k) => {
      const shift = (iso: string, days: number): string => {
        const [y, m, d] = iso.split("-").map(Number);
        const dt = new Date(Date.UTC(y!, m! - 1, d!));
        dt.setUTCDate(dt.getUTCDate() + days);
        return dt.toISOString().slice(0, 10);
      };
      const base = deriveDayDates(start, n);
      const there = deriveDayDates(shift(start, k), n);
      const back = deriveDayDates(shift(shift(start, k), -k), n);
      expect(back).toEqual(base);
      expect(there).not.toBe(base); // different array identity; values differ when k != 0
    }));
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @tc/domain test packages/domain/test/dates.property.test.ts`
Expected: PASS.

```bash
git add packages/domain
git commit -m "feat(domain): deriveDayDates + derived day date on TripDetail"
```

### Task D2: Domain — anchors in state, evolve, equality, diff, decide

**Files:**
- Modify: `packages/domain/src/trip/state.ts`, `evolve.ts`, `equality.ts`, `decide.ts`, `diff.ts`
- Modify: domain tests that build `TripState`/`ActivityState` literals (add `anchors: []`)
- Test: `packages/domain/test/anchors-state.test.ts` (create); extend `packages/domain/test/diff.property.test.ts`

**Interfaces:**
- Consumes: Task 1 `Anchor`.
- Produces: `ActivityState.anchors: Anchor[]`; `activityStatesEqual` compares anchors; `diffTripStates` emits anchors in `ActivityAdded`/`ActivityUpdated` snapshots; `decideTripCommand` sets anchors on add/update (unchanged-when-omitted; a same-anchors update is a rejected `no-op`).

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/anchors-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Anchor } from "@tc/contracts";
import { decideTripCommand, evolveTrip, tripDetailFromState, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const CTX = { actorId: "u1" };
const TOD: Anchor = { kind: "timeOfDay", window: { start: "08:00", end: "13:00" } };

function withActivity(anchors: Anchor[]): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }],
    startDate: null, days: [], backlog: [A1],
    activities: { [A1]: { title: "Market", timeWindow: null, location: null, notes: null, anchors } },
    dismissedConflictIds: [],
  };
}

describe("anchors in domain state", () => {
  it("AddActivity carries anchors into state; the detail exposes them", () => {
    const decision = decideTripCommand(
      { tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], startDate: null, days: [], backlog: [], activities: {}, dismissedConflictIds: [] },
      { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Market", anchors: [TOD] },
      CTX,
    );
    if (!decision.ok) throw new Error(decision.rejection.code);
    const state = evolveTrip({ tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }], startDate: null, days: [], backlog: [], activities: {}, dismissedConflictIds: [] }, decision.events[0]!);
    expect(state.activities[A1]!.anchors).toEqual([TOD]);
    expect(tripDetailFromState(state, "2026-07-09T00:00:00.000Z").activities[A1]!.anchors).toEqual([TOD]);
  });

  it("UpdateActivity with omitted anchors leaves them unchanged; explicit [] clears", () => {
    const state = withActivity([TOD]);
    const omit = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, title: "Renamed" }, CTX);
    if (!omit.ok) throw new Error(omit.rejection.code);
    const afterOmit = evolveTrip(state, omit.events[0]!);
    expect(afterOmit.activities[A1]!.anchors).toEqual([TOD]);

    const clear = decideTripCommand(afterOmit, { type: "UpdateActivity", tripId: TRIP, activityId: A1, anchors: [] }, CTX);
    if (!clear.ok) throw new Error(clear.rejection.code);
    expect(evolveTrip(afterOmit, clear.events[0]!).activities[A1]!.anchors).toEqual([]);
  });

  it("re-setting the identical anchor set is a no-op", () => {
    const state = withActivity([TOD]);
    const decision = decideTripCommand(state, { type: "UpdateActivity", tripId: TRIP, activityId: A1, anchors: [TOD] }, CTX);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.rejection.code).toBe("no-op");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test packages/domain/test/anchors-state.test.ts`
Expected: FAIL (typecheck: `anchors` missing on `ActivityState`).

- [ ] **Step 3: Implement**

`packages/domain/src/trip/state.ts` — `ActivityState` gains `anchors`:

```ts
import type { Anchor, Location, TimeWindow, TripMember } from "@tc/contracts";

export type ActivityState = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
};
```

`packages/domain/src/trip/evolve.ts` — the `ActivityAdded` and `ActivityUpdated` branches read `anchors` from the payload:

```ts
    case "ActivityAdded": {
      const { activityId, dayId, title, timeWindow, location, notes, anchors } = event.payload;
      const next: TripState = {
        ...state,
        activities: { ...state.activities, [activityId]: { title, timeWindow, location, notes, anchors } },
      };
      // ...unchanged day/backlog placement...
    }
    case "ActivityUpdated": {
      const { activityId, title, timeWindow, location, notes, anchors } = event.payload;
      return {
        ...state,
        activities: { ...state.activities, [activityId]: { title, timeWindow, location, notes, anchors } },
      };
    }
```

`packages/domain/src/trip/equality.ts` — add anchor comparison and use it in `activityStatesEqual`:

```ts
import type { Anchor } from "@tc/contracts";

// Canonical string per anchor — order-insensitive within an anchor's own list
// fields, so equality doesn't spuriously fail on weekday ordering.
function anchorKey(a: Anchor): string {
  switch (a.kind) {
    case "dayOfWeek": return `dow:${[...a.days].sort().join(",")}`;
    case "dateRange": return `range:${a.from}_${a.to}`;
    case "timeOfDay": return `tod:${a.window.start}-${a.window.end}`;
    case "publicHoliday": return `hol:${a.country}`;
  }
}

// Anchor LIST order is significant (the update snapshot preserves it), so we
// compare positionally by canonical key.
function sameAnchors(a: readonly Anchor[], b: readonly Anchor[]): boolean {
  return a.length === b.length && a.every((x, i) => anchorKey(x) === anchorKey(b[i]!));
}
```

Add `&& sameAnchors(a.anchors, b.anchors)` to the `activityStatesEqual` return expression. Export `anchorKey` (Task D3 reuses it for conflict ids): add `export` to it.

`packages/domain/src/trip/decide.ts` — `AddActivity` payload gains `anchors: command.anchors ?? []`; `UpdateActivity` payload gains `anchors: command.anchors === undefined ? current.anchors : command.anchors`. (The existing `okUnlessNoOp` wrapper now catches same-anchors updates automatically, because `activityStatesEqual` compares anchors.)

`packages/domain/src/trip/diff.ts` — step 4 (`ActivityAdded`) payload gains `anchors: a.anchors`; step 5 (`ActivityUpdated`) payload gains `anchors: a.anchors`.

- [ ] **Step 4: Fix the red window mechanically**

Run: `pnpm typecheck`
Every remaining error is an `ActivityState` or `ActivityView`/`ActivityAdded` literal missing `anchors` — in `packages/domain/test/*.test.ts` and `apps/web/src/mocks/fixtures.ts`. Add `anchors: []` to each activity literal, and `date: null` to each `TripDetail` day literal where the compiler flags it. No other change this step.

- [ ] **Step 5: Extend the diff round-trip property test to exercise anchors**

In `packages/domain/test/diff.property.test.ts`, add an anchors fixture and thread it into the `AddActivity`/`UpdateActivity` builder cases so histories include anchor edits:

```ts
const ANCHORS = [
  undefined,
  [{ kind: "dayOfWeek", days: ["mon", "tue", "wed", "thu", "fri"] }],
  [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }],
  [] as [],
] as const;
```

In `case 3` (AddActivity) add `anchors: ANCHORS[raw.c % ANCHORS.length]` and in `case 4` (UpdateActivity) add `anchors: ANCHORS[raw.b % ANCHORS.length]`. The round-trip invariant (`tripStatesEqual(applied, target)`) now covers anchor add/change/clear — proving undo/revert of anchor edits is exact.

- [ ] **Step 6: Run + commit**

Run: `pnpm typecheck && pnpm --filter @tc/domain test`
Expected: PASS (including the extended round-trip, 300 runs).

```bash
git add packages/domain apps/web/src/mocks
git commit -m "feat(domain): anchors in state/evolve/equality/diff/decide (undo-revert correct)"
```

### Task D3: Domain — conflict context + the anchor-violation rule

**Files:**
- Modify: `packages/domain/src/trip/conflicts.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/test/anchor-conflicts.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 `Anchor`/`Conflict`, Task D1 `deriveDayDates`, Task D2 `anchorKey`.
- Produces: `ConflictContext` type + `DEFAULT_CONFLICT_CONTEXT`; `detectConflicts(state, ctx?)` (default = stub); a new `anchorRule` producing `warn` conflicts of `kind: "anchor-violation"` with content-derived ids `anchor-violation:<activityId>:<anchorKey>`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/anchor-conflicts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Anchor } from "@tc/contracts";
import { DEFAULT_CONFLICT_CONTEXT, detectConflicts, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// A one-day trip whose only activity carries `anchors`, pinned to `startDate`.
function dated(startDate: string | null, anchors: Anchor[], timeWindow: TripState["activities"][string]["timeWindow"] = null): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }],
    startDate, days: [{ dayId: DAY, activityIds: [A1] }], backlog: [],
    activities: { [A1]: { title: "Market", timeWindow, location: null, notes: null, anchors } },
    dismissedConflictIds: [],
  };
}

describe("anchor-violation rule", () => {
  it("dayOfWeek: violated when the derived weekday is excluded, satisfied otherwise", () => {
    // 2026-10-12 is a Monday. Anchor allows only weekends → violated.
    const bad = detectConflicts(dated("2026-10-12", [{ kind: "dayOfWeek", days: ["sat", "sun"] }]));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.kind).toBe("anchor-violation");
    expect(bad[0]!.severity).toBe("warn");
    expect(bad[0]!.id).toBe(`anchor-violation:${A1}:dow:sat,sun`);
    // Allow Monday → satisfied.
    expect(detectConflicts(dated("2026-10-12", [{ kind: "dayOfWeek", days: ["mon"] }]))).toHaveLength(0);
  });

  it("dateRange: violated outside [from,to], satisfied inside", () => {
    expect(detectConflicts(dated("2026-10-12", [{ kind: "dateRange", from: "2026-10-01", to: "2026-10-10" }]))).toHaveLength(1);
    expect(detectConflicts(dated("2026-10-12", [{ kind: "dateRange", from: "2026-10-12", to: "2026-10-12" }]))).toHaveLength(0);
  });

  it("timeOfDay: violated when the activity window escapes the opening window; evaluated even when undated", () => {
    const outside = detectConflicts(dated(null, [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }], { start: "12:00", end: "14:00" }));
    expect(outside).toHaveLength(1);
    const inside = detectConflicts(dated(null, [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }], { start: "09:00", end: "11:00" }));
    expect(inside).toHaveLength(0);
    // No time window on the activity → dormant.
    expect(detectConflicts(dated(null, [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }], null))).toHaveLength(0);
  });

  it("date-based anchors go dormant when the trip is undated", () => {
    expect(detectConflicts(dated(null, [{ kind: "dayOfWeek", days: ["sat"] }]))).toHaveLength(0);
    expect(detectConflicts(dated(null, [{ kind: "dateRange", from: "2026-01-01", to: "2026-01-02" }]))).toHaveLength(0);
  });

  it("publicHoliday is inert under the default (permissive) context", () => {
    expect(detectConflicts(dated("2026-10-12", [{ kind: "publicHoliday", country: "US" }]))).toHaveLength(0);
    // Prove the seam is real: a strict oracle would flag it.
    const strict = { ...DEFAULT_CONFLICT_CONTEXT, isPublicHoliday: () => false };
    expect(detectConflicts(dated("2026-10-12", [{ kind: "publicHoliday", country: "US" }]), strict)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test packages/domain/test/anchor-conflicts.test.ts`
Expected: FAIL — `DEFAULT_CONFLICT_CONTEXT` not exported.

- [ ] **Step 3: Implement in `packages/domain/src/trip/conflicts.ts`**

Add imports and the context type at the top:

```ts
import type { Anchor } from "@tc/contracts";
import { deriveDayDates } from "./dates";
import { anchorKey } from "./equality";

// Facts the pure engine cannot compute itself, injected by the caller (ADR-006).
export type ConflictContext = {
  isPublicHoliday: (countryCode: string, isoDate: string) => boolean;
  timezone: string;
};

// M3 default = the inert stub. `isPublicHoliday: () => true` means a
// publicHoliday anchor is ALWAYS satisfied (never a conflict). The rule really
// calls the oracle, so wiring `date-holidays` later is a one-line swap.
export const DEFAULT_CONFLICT_CONTEXT: ConflictContext = {
  isPublicHoliday: () => true,
  timezone: "America/Los_Angeles",
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Weekday of a YYYY-MM-DD as a pure calendar fact (explicit UTC components — not
// a wall-clock read; timezone-independent for a plain date).
function weekdayOf(iso: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

function anchorViolated(anchor: Anchor, date: string | null, tw: TimeWindow | null, ctx: ConflictContext): boolean {
  switch (anchor.kind) {
    case "dayOfWeek":
      return date !== null && !anchor.days.includes(weekdayOf(date));
    case "dateRange":
      return date !== null && (date < anchor.from || date > anchor.to);
    case "timeOfDay":
      return tw !== null && !(anchor.window.start <= tw.start && tw.end <= anchor.window.end);
    case "publicHoliday":
      return date !== null && !ctx.isPublicHoliday(anchor.country, date);
  }
}
```

Change the `Rule` type to `(state: TripState, ctx: ConflictContext) => Conflict[]`, give the existing `timeOverlapRule`/`geographyRule` an unused `_ctx` parameter, and add the anchor rule:

```ts
const anchorRule: Rule = (state, ctx) => {
  const conflicts: Conflict[] = [];
  const dayDates = deriveDayDates(state.startDate, state.days.length);
  const dateOf = new Map<string, string | null>();       // activityId → derived date (null = backlog/undated)
  state.days.forEach((day, i) => day.activityIds.forEach((id) => dateOf.set(id, dayDates[i]!)));
  for (const [id, activity] of Object.entries(state.activities)) {
    const date = dateOf.get(id) ?? null;
    for (const anchor of activity.anchors) {
      if (!anchorViolated(anchor, date, activity.timeWindow, ctx)) continue;
      const where = date ? `${date}` : "an unscheduled slot";
      conflicts.push({
        id: `anchor-violation:${id}:${anchorKey(anchor)}`,
        kind: "anchor-violation",
        severity: "warn",
        subjects: [id],
        description: `"${activity.title}" has an anchor its current placement (${where}) does not satisfy.`,
        resolutions: ["Shift the trip's dates", "Move the activity to a different day", "Edit or remove the anchor"],
      });
    }
  }
  return conflicts;
};
```

Register it: `const rules: Rule[] = [timeOverlapRule, geographyRule, anchorRule];`. Change the export:

```ts
export function detectConflicts(state: TripState, ctx: ConflictContext = DEFAULT_CONFLICT_CONTEXT): Conflict[] {
  return rules.flatMap((rule) => rule(state, ctx)).sort((a, b) => a.id.localeCompare(b.id));
}
```

`packages/domain/src/index.ts` already re-exports `./trip/conflicts` — `ConflictContext`/`DEFAULT_CONFLICT_CONTEXT` come along. Confirm `detail.ts`'s `detectConflicts(state)` call still compiles (it does — `ctx` defaults).

- [ ] **Step 4: Run + commit**

Run: `pnpm typecheck && pnpm --filter @tc/domain test`
Expected: PASS (all domain suites, including the golden rebuild and diff round-trip).

```bash
git add packages/domain
git commit -m "feat(domain): injected ConflictContext + anchor-violation rule (ADR-006)"
```

---

## Track S-geo — Server geocoding (parallelizable with Tracks D and U after Task 1)

### Task S1: Server — `Geocoder` port, LocationIQ adapter, `/api/geocode`

**Files:**
- Create: `apps/web/src/server/geocoding/geocoder.ts`, `apps/web/src/server/geocoding/locationiq.ts`, `apps/web/src/server/geocoding/index.ts`
- Modify: `apps/web/src/server/config.ts` (add `locationIqApiKey`)
- Create: `apps/web/src/app/api/geocode/route.ts`
- Test: `apps/web/src/server/geocoding/locationiq.test.ts`

**Interfaces:**
- Consumes: Task 1 `GeocodeResult` shape (defined here; `Location.countryCode`).
- Produces: `Geocoder` interface; `createLocationIQGeocoder(apiKey)`; `getGeocoder()`; `GET /api/geocode?q=` → `{ results: GeocodeResult[] }` (session-guarded). Consumed by U2's location input at wiring time (I2).

- [ ] **Step 1: Write the port + failing adapter test**

`apps/web/src/server/geocoding/geocoder.ts`:

```ts
export interface GeocodeResult {
  lat: number;
  lng: number;
  canonicalName: string;
  countryCode?: string; // ISO-3166 alpha-2, uppercase
}

// The swappable seam (ADR-007). Callers depend only on this; each adapter hides
// its vendor. We persist normalized GeocodeResults, never raw vendor payloads.
export interface Geocoder {
  forward(query: string, opts?: { limit?: number }): Promise<GeocodeResult[]>;
}
```

`apps/web/src/server/geocoding/locationiq.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocationIQGeocoder } from "./locationiq";

afterEach(() => vi.unstubAllGlobals());

describe("LocationIQ geocoder adapter", () => {
  it("builds the request and normalizes the response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { lat: "41.8902", lon: "12.4922", display_name: "Colosseum, Rome, Italy", address: { country_code: "it" } },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await createLocationIQGeocoder("KEY123").forward("Colosseum", { limit: 3 });
    expect(results).toEqual([
      { lat: 41.8902, lng: 12.4922, canonicalName: "Colosseum, Rome, Italy", countryCode: "IT" },
    ]);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("key")).toBe("KEY123");
    expect(url.searchParams.get("q")).toBe("Colosseum");
    expect(url.searchParams.get("limit")).toBe("3");
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
    await expect(createLocationIQGeocoder("K").forward("x")).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test apps/web/src/server/geocoding/locationiq.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter + factory + config**

`apps/web/src/server/geocoding/locationiq.ts`:

```ts
import type { Geocoder, GeocodeResult } from "./geocoder";

const BASE = "https://us1.locationiq.com/v1/search";

type LocationIQRow = {
  lat: string;
  lon: string;
  display_name: string;
  address?: { country_code?: string };
};

export function createLocationIQGeocoder(apiKey: string): Geocoder {
  return {
    async forward(query, opts) {
      const url = new URL(BASE);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", String(opts?.limit ?? 5));
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
      const rows = (await res.json()) as LocationIQRow[];
      return rows.map<GeocodeResult>((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lon),
        canonicalName: r.display_name,
        countryCode: r.address?.country_code?.toUpperCase(),
      }));
    },
  };
}
```

In `apps/web/src/server/config.ts`, add to the exported config object:

```ts
  locationIqApiKey: process.env.LOCATIONIQ_API_KEY ?? "",
```

`apps/web/src/server/geocoding/index.ts`:

```ts
import { serverConfig } from "../config"; // match the existing export name in config.ts
import { createLocationIQGeocoder } from "./locationiq";
import type { Geocoder } from "./geocoder";

export type { Geocoder, GeocodeResult } from "./geocoder";

// One place picks the provider (ADR-007 seam). Swapping vendors is one line here.
export function getGeocoder(): Geocoder {
  const key = serverConfig.locationIqApiKey;
  if (!key) throw new Error("LOCATIONIQ_API_KEY is not set");
  return createLocationIQGeocoder(key);
}
```

> If `config.ts` exports the config under a different name than `serverConfig`, use that name — do not rename the existing export.

- [ ] **Step 4: The route (session-guarded, like `/commands`)**

`apps/web/src/app/api/geocode/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/server/auth"; // match how /commands imports the session helper
import { getGeocoder } from "@/server/geocoding";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });
  const results = await getGeocoder().forward(q, { limit: 5 });
  return NextResponse.json({ results });
}
```

> Open `apps/web/src/app/api/trips/[tripId]/commands/route.ts` and copy its exact session-check import/shape rather than assuming `auth()` — keep it consistent with the codebase.

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter web test apps/web/src/server/geocoding/locationiq.test.ts && pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/server/geocoding apps/web/src/server/config.ts apps/web/src/app/api/geocode
git commit -m "feat(server): Geocoder port + LocationIQ adapter + /api/geocode (ADR-007)"
```

---

## Track U — UI against MSW mocks (parallelizable with Tracks D and S-geo after Task 1)

> All UI tasks import only `@tc/contracts` + the typed client. They build against MSW; nothing here imports `@tc/domain`. jsdom cannot run WebGL, so map/timeline/calendar logic is extracted into **pure, tested helper functions**; the visual shell is verified in the browser preview at the gate (Task I3).

### Task U1: UI — fixtures + mocks for anchors, day dates, geocode

**Files:**
- Modify: `apps/web/src/mocks/fixtures.ts`, `apps/web/src/mocks/handlers.ts`

**Interfaces:**
- Produces: a sample `TripDetail` carrying `days[].date` + `activities[].anchors`; `applyMock` handles `anchors` on add/update and recomputes `days[].date` on `SetTripStartDate`; `makeTripHandlers` gains a `geocode?: GeocodeResult[]` option served at `GET /api/geocode`.

- [ ] **Step 1: Extend fixtures**

In `apps/web/src/mocks/fixtures.ts`, add `date` to each day (null unless the fixture has a `startDate`) and `anchors: []` (or a sample anchor) to each activity. Add a geocode fixture export:

```ts
export const sampleGeocodeResults = [
  { lat: 41.8902, lng: 12.4922, canonicalName: "Colosseum, Rome, Italy", countryCode: "IT" },
  { lat: 41.9029, lng: 12.4534, canonicalName: "Vatican Museums, Vatican City", countryCode: "VA" },
];
```

- [ ] **Step 2: Teach the mock about anchors + derived dates + geocode**

`apps/web/src/mocks/handlers.ts` — add a local date helper (the mock stands in for the projection; it may NOT import `@tc/domain`):

```ts
function deriveMockDayDates(startDate: string | null, count: number): (string | null)[] {
  if (startDate === null) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, i) => {
    const [y, m, d] = startDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    dt.setUTCDate(dt.getUTCDate() + i);
    return dt.toISOString().slice(0, 10);
  });
}
function rederiveDates(detail: TripDetail): void {
  const dates = deriveMockDayDates(detail.startDate, detail.days.length);
  detail.days.forEach((day, i) => (day.date = dates[i]!));
}
```

In `applyMock`: call `rederiveDates(next)` at the end of the `SetTripStartDate`, `AddDay`, and `RemoveDay` cases; in `AddActivity` set `anchors: command.anchors ?? []`; in `UpdateActivity` add `if (command.anchors !== undefined) activity.anchors = command.anchors;`.

In `makeTripHandlers`, add to `options` a `geocode?: GeocodeResult[]` and a handler:

```ts
    http.get("/api/geocode", ({ request }) => {
      const q = new URL(request.url).searchParams.get("q")?.trim();
      return HttpResponse.json({ results: q ? (options?.geocode ?? []) : [] });
    }),
```

Import the `GeocodeResult` type locally (define a matching structural type in the mock file to avoid importing server code):

```ts
type GeocodeResult = { lat: number; lng: number; canonicalName: string; countryCode?: string };
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/mocks
git commit -m "test(ui): MSW fixtures/handlers for anchors, day dates, geocode"
```

### Task U2: UI — anchor editor + geocoded location input

**Files:**
- Modify: `apps/web/src/components/board/ActivityEditor.tsx`
- Create: `apps/web/src/components/board/AnchorEditor.tsx`, `apps/web/src/components/board/LocationInput.tsx`
- Test: `apps/web/src/components/board/AnchorEditor.test.tsx`, `apps/web/src/components/board/LocationInput.test.tsx`

**Interfaces:**
- Consumes: `Anchor`, `Location` from `@tc/contracts`; U1's `/api/geocode` mock.
- Produces: `AnchorEditor({ value, onChange })` (value: `Anchor[]`); `LocationInput({ value, onChange })` — a place-name box that calls `/api/geocode`, lists results, and calls `onChange(Location)` with the picked `{name, lat, lng, countryCode}`. `ActivityEditor` renders both and includes `anchors`/`location` in the command it emits.

- [ ] **Step 1: Write failing component tests**

`apps/web/src/components/board/LocationInput.test.tsx` (drives the mocked `/api/geocode`, picks a result, asserts `onChange` receives a full `Location`):

```tsx
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocationInput } from "./LocationInput";

const server = setupServer(
  http.get("/api/geocode", () =>
    HttpResponse.json({ results: [{ lat: 41.89, lng: 12.49, canonicalName: "Colosseum, Rome, Italy", countryCode: "IT" }] }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("LocationInput", () => {
  it("geocodes on search and emits the picked Location", async () => {
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText(/place/i), "Colosseum");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    const pick = await screen.findByText(/Colosseum, Rome/i);
    await userEvent.click(pick);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ name: "Colosseum, Rome, Italy", lat: 41.89, lng: 12.49, countryCode: "IT" }),
    );
  });
});
```

`apps/web/src/components/board/AnchorEditor.test.tsx` (add a `dayOfWeek` anchor, remove it):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnchorEditor } from "./AnchorEditor";

describe("AnchorEditor", () => {
  it("adds and removes an anchor", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<AnchorEditor value={[]} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/anchor kind/i), "dayOfWeek");
    await userEvent.click(screen.getByRole("button", { name: /add anchor/i }));
    expect(onChange).toHaveBeenCalledWith([{ kind: "dayOfWeek", days: ["mon", "tue", "wed", "thu", "fri"] }]);
    rerender(<AnchorEditor value={[{ kind: "dayOfWeek", days: ["mon"] }]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `pnpm --filter web test apps/web/src/components/board/AnchorEditor.test.tsx` → FAIL (module missing).

`apps/web/src/components/board/AnchorEditor.tsx` — a controlled list editor. Minimum viable, functional styling. Each kind adds a sensible default (`dayOfWeek` → Mon–Fri; `dateRange` → today..today via a date input; `timeOfDay` → 08:00–13:00; `publicHoliday` → a 2-letter country input). Render existing anchors with a **Remove** button; a `kind` `<select>` (label "anchor kind") + **Add anchor** button appends the default for that kind and calls `onChange(next)`.

`apps/web/src/components/board/LocationInput.tsx` — a `"use client"` component: a text box (placeholder "place name"), a **Search** button that `fetch("/api/geocode?q=...")`, renders `results` as clickable rows; clicking a row calls `onChange({ name: r.canonicalName, lat: r.lat, lng: r.lng, countryCode: r.countryCode })`. Show the current `value?.name` when set, with a **Clear** button calling `onChange(null)`.

Wire both into `ActivityEditor.tsx`: render `<LocationInput>` and `<AnchorEditor>`, keep their values in local state, and include `location` and `anchors` in the `AddActivity`/`UpdateActivity` command the editor already emits.

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/board`
Expected: PASS.

```bash
git add apps/web/src/components/board
git commit -m "feat(ui): anchor editor + geocoded location input"
```

### Task U3: UI — Map lens (MapLibre + OpenFreeMap)

**Files:**
- Modify: `apps/web/package.json` (add `maplibre-gl`)
- Create: `apps/web/src/components/lenses/mapData.ts`, `apps/web/src/components/lenses/MapLens.tsx`
- Test: `apps/web/src/components/lenses/mapData.test.ts`

**Interfaces:**
- Consumes: `TripDetail`.
- Produces: `activityPins(detail): { activityId, title, lat, lng, dayId: string | null }[]` (pure — only activities with coordinates) and `unlocatedActivities(detail)`; `MapLens({ detail })` renders the map + an off-map list.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter web add maplibre-gl
```
Expected: `maplibre-gl` in `apps/web/package.json` dependencies. (This is the one sanctioned new runtime dep — Global Constraints.)

- [ ] **Step 2: Write the pure helper test**

`apps/web/src/components/lenses/mapData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { activityPins, unlocatedActivities } from "./mapData";

const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: null }], backlog: [A2],
  activities: {
    [A1]: { activityId: A1, title: "Colosseum", timeWindow: null, location: { name: "Colosseum", lat: 41.89, lng: 12.49 }, notes: null, anchors: [] },
    [A2]: { activityId: A2, title: "Idea", timeWindow: null, location: null, notes: null, anchors: [] },
  },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
};

describe("map data", () => {
  it("returns a pin only for located activities, tagged with its day", () => {
    expect(activityPins(detail)).toEqual([{ activityId: A1, title: "Colosseum", lat: 41.89, lng: 12.49, dayId: DAY }]);
  });
  it("lists located-less activities separately", () => {
    expect(unlocatedActivities(detail).map((a) => a.activityId)).toEqual([A2]);
  });
});
```

- [ ] **Step 3: Implement the helper + view**

`apps/web/src/components/lenses/mapData.ts`:

```ts
import type { TripDetail } from "@tc/contracts";

export type ActivityPin = { activityId: string; title: string; lat: number; lng: number; dayId: string | null };

export function activityPins(detail: TripDetail): ActivityPin[] {
  const dayOf = new Map<string, string>();
  for (const day of detail.days) for (const id of day.activityIds) dayOf.set(id, day.dayId);
  const pins: ActivityPin[] = [];
  for (const [id, a] of Object.entries(detail.activities)) {
    if (a.location?.lat !== undefined && a.location.lng !== undefined) {
      pins.push({ activityId: id, title: a.title, lat: a.location.lat, lng: a.location.lng, dayId: dayOf.get(id) ?? null });
    }
  }
  return pins;
}

export function unlocatedActivities(detail: TripDetail) {
  return Object.values(detail.activities).filter((a) => a.location?.lat === undefined);
}
```

`apps/web/src/components/lenses/MapLens.tsx` — a `"use client"` component. On mount (with `activityPins(detail).length`), dynamically import `maplibre-gl`, create a `Map` with `style: "https://tiles.openfreemap.org/styles/liberty"` (keyless — ADR-007), add a `Marker` per pin, and `fitBounds` to the pins. Render the OpenStreetMap attribution (MapLibre includes it via the style). Below the map, render `unlocatedActivities(detail)` as a small list ("Not on the map — add a place"). Guard all MapLibre calls behind `typeof window !== "undefined"` and clean up the map in the effect's teardown.

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/lenses/mapData.test.ts && pnpm --filter web typecheck`
Expected: PASS. (The MapLens shell is verified visually in Task I3; jsdom can't run WebGL.)

```bash
git add apps/web/src/components/lenses apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): map lens (MapLibre + OpenFreeMap) over located activities"
```

### Task U4: UI — Timeline lens

**Files:**
- Create: `apps/web/src/components/lenses/timelineData.ts`, `apps/web/src/components/lenses/TimelineLens.tsx`
- Test: `apps/web/src/components/lenses/timelineData.test.ts`

**Interfaces:**
- Consumes: `TripDetail`.
- Produces: `timelineRows(detail): { dayId, date, ordinal, timed: {activityId,title,start,end}[], untimed: {activityId,title}[] }[]` (pure, days in order); `TimelineLens({ detail })`.

- [ ] **Step 1: Write the pure helper test**

`apps/web/src/components/lenses/timelineData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { timelineRows } from "./timelineData";

const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12",
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1, A2], date: "2026-10-12" }], backlog: [],
  activities: {
    [A1]: { activityId: A1, title: "Museum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null, anchors: [] },
    [A2]: { activityId: A2, title: "Wander", timeWindow: null, location: null, notes: null, anchors: [] },
  },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
};

describe("timelineRows", () => {
  it("splits timed (sorted by start) from untimed per day, in day order", () => {
    const [row] = timelineRows(detail);
    expect(row!.ordinal).toBe(1);
    expect(row!.date).toBe("2026-10-12");
    expect(row!.timed).toEqual([{ activityId: A1, title: "Museum", start: "09:00", end: "11:00" }]);
    expect(row!.untimed).toEqual([{ activityId: A2, title: "Wander" }]);
  });
});
```

- [ ] **Step 2: Implement + run + commit**

`timelineData.ts` — build one row per day (ordinal = index+1, `date` from `day.date`), splitting each day's activities into `timed` (has `timeWindow`, sorted by `start`) and `untimed`. `TimelineLens.tsx` renders rows as horizontal tracks; timed items positioned/labelled by their window, untimed listed under the day. Functional styling.

Run: `pnpm --filter web test apps/web/src/components/lenses/timelineData.test.ts` → PASS.

```bash
git add apps/web/src/components/lenses
git commit -m "feat(ui): timeline lens"
```

### Task U5: UI — Calendar lens + start-date shift control

**Files:**
- Create: `apps/web/src/components/lenses/calendarData.ts`, `apps/web/src/components/lenses/CalendarLens.tsx`, `apps/web/src/components/lenses/TripDateControl.tsx`
- Test: `apps/web/src/components/lenses/calendarData.test.ts`, `apps/web/src/components/lenses/TripDateControl.test.tsx`

**Interfaces:**
- Consumes: `TripDetail`; emits `SetTripStartDate` via an `onCommand` prop.
- Produces: `calendarCells(detail): { date, inTrip, ordinal, activityIds }[]` (pure — a padded month grid covering the trip's derived date span; `ordinal`/`activityIds` set on trip days, empty on padding); `CalendarLens({ detail, onCommand })`; `TripDateControl({ startDate, onCommand })` — a date input that issues `SetTripStartDate` (set/clear) — this is where "drag the vacation" lives (drag-to-shift is a later polish; a date input satisfies the gate).

- [ ] **Step 1: Write the pure helper test**

`apps/web/src/components/lenses/calendarData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { calendarCells } from "./calendarData";

const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12",
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-12" }], backlog: [],
  activities: { [A1]: { activityId: A1, title: "X", timeWindow: null, location: null, notes: null, anchors: [] } },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
};

describe("calendarCells", () => {
  it("marks the trip day with its ordinal and activities; padding days are not in-trip", () => {
    const cells = calendarCells(detail);
    const tripDay = cells.find((c) => c.date === "2026-10-12")!;
    expect(tripDay.inTrip).toBe(true);
    expect(tripDay.ordinal).toBe(1);
    expect(tripDay.activityIds).toEqual([A1]);
    expect(cells.every((c) => (c.date === "2026-10-12" ? c.inTrip : !c.inTrip || c.ordinal !== undefined))).toBe(true);
  });

  it("undated trip → no cells", () => {
    expect(calendarCells({ ...detail, startDate: null, days: [{ dayId: DAY, activityIds: [A1], date: null }] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement + run + commit**

`calendarData.ts` — if `startDate` is null return `[]`; else build a grid from the month of the first derived date through the month of the last, week-aligned (Mon-start), each cell `{ date, inTrip, ordinal?, activityIds }` where trip days (matched by `day.date`) get `ordinal = index+1` and their `activityIds`. `CalendarLens.tsx` renders the grid, highlighting in-trip cells and showing activity counts; `TripDateControl.tsx` renders a `<input type="date">` bound to `startDate` that dispatches `{ type: "SetTripStartDate", tripId, startDate: value || null }` through `onCommand`, plus a **Clear dates** button dispatching `startDate: null`. `TripDateControl.test.tsx` asserts setting/clearing emits the right command via a mocked `onCommand`.

Run: `pnpm --filter web test apps/web/src/components/lenses` → PASS.

```bash
git add apps/web/src/components/lenses
git commit -m "feat(ui): calendar lens + trip start-date shift control"
```

---

## Integration (single coordinating session — runs after the tracks merge)

### Task I1: Server — thread `ctx` + verify no migration; integration test

**Files:**
- Create: `apps/web/src/server/conflictContext.ts`
- Modify: the projection call sites — `apps/web/src/server/projections.ts`, `apps/web/src/server/commands.ts`, `apps/web/src/server/history.ts` (any caller of `projectTripDetails`/`tripDetailFromState`)
- Test: `apps/web/src/server/anchors.int.test.ts` (create)

**Interfaces:**
- Consumes: Track D (`projectTripDetails`/`tripDetailFromState` now accept an optional `ConflictContext`; `detectConflicts(state, ctx)`).
- Produces: a server-built `ConflictContext` passed explicitly at the projection entry points (honoring ADR-006 — "constructed in `src/server`").

- [ ] **Step 1: Make the domain projection entry points accept `ctx` (thread it to `detectConflicts`)**

In `packages/domain/src/trip/detail.ts`, give both functions an optional ctx and pass it through:

```ts
import { detectConflicts, DEFAULT_CONFLICT_CONTEXT, type ConflictContext } from "./conflicts";

export function tripDetailFromState(state: TripState, createdAt: string, ctx: ConflictContext = DEFAULT_CONFLICT_CONTEXT): TripDetail {
  // ...
    conflicts: detectConflicts(state, ctx),
  // ...
}

export function projectTripDetails(envelopes: EventEnvelope[], ctx: ConflictContext = DEFAULT_CONFLICT_CONTEXT): TripDetail[] {
  // ...pass ctx into tripDetailFromState(state, createdAt, ctx)...
}
```

Run: `pnpm --filter @tc/domain test` → PASS (defaults keep every existing test green). Commit this domain tweak on the branch:

```bash
git add packages/domain && git commit -m "feat(domain): thread ConflictContext through projection entry points"
```

- [ ] **Step 2: Build the server context and pass it in**

`apps/web/src/server/conflictContext.ts`:

```ts
import type { ConflictContext } from "@tc/domain";
import { serverConfig } from "./config";

// The M3 injection point (ADR-006). Permissive holiday stub — publicHoliday
// anchors stay inert until `date-holidays` is wired here. Timezone is fixed for
// now; per-activity zones are deferred.
export function serverConflictContext(): ConflictContext {
  return {
    isPublicHoliday: () => true,
    timezone: serverConfig.timezone ?? "America/Los_Angeles",
  };
}
```

(Add `timezone: process.env.TRIP_TIMEZONE ?? "America/Los_Angeles"` to `serverConfig` in `config.ts`, or inline the literal if you prefer — either satisfies the seam.)

Grep the call sites and pass `serverConflictContext()`:

```bash
grep -rn "projectTripDetails\|tripDetailFromState" apps/web/src/server
```

At each — the command pipeline (`commands.ts`), the rebuild (`projections.ts` `rebuildProjections`), and the replay-at-seq (`history.ts`) — pass `serverConflictContext()` as the extra argument.

- [ ] **Step 3: Integration test — a date shift recomputes anchor conflicts, and rebuild reproduces them**

`apps/web/src/server/anchors.int.test.ts` — using the existing integration harness (real Postgres, the command pipeline): create a trip, add a day, add an activity **on that day** with a `dayOfWeek` anchor that excludes the day-1 weekday for a chosen `startDate`; assert the projected `TripDetail.conflicts` contains an `anchor-violation`; issue `SetTripStartDate` to a value where the anchor is satisfied; assert the conflict disappears. Then `rebuildProjections()` and assert the rebuilt detail equals the live one (conflicts included). Mirror the setup style of `apps/web/src/server/commands.int.test.ts`.

- [ ] **Step 4: Run + commit**

Run: `docker compose up -d && pnpm --filter web test:int apps/web/src/server/anchors.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS; lint wall green.

```bash
git add apps/web/src/server
git commit -m "feat(server): inject ConflictContext at projection entry points (ADR-006)"
```

### Task I2: Wire the lenses + editors into the trip screen against the real API

**Files:**
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx` (add a lens switcher), `apps/web/src/app/trips/[tripId]/page.tsx` if needed
- Test: `apps/web/src/components/board/TripBoardScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: U2–U5 components; the real `/api/geocode` (S1) and `/commands` endpoints.

- [ ] **Step 1: Add a lens switcher**

In `TripBoardScreen.tsx`, add tabs **Board | Map | Timeline | Calendar** (local state, default Board). Board stays exactly as-is. Map/Timeline render `<MapLens detail=…>` / `<TimelineLens detail=…>`. Calendar renders `<CalendarLens detail=… onCommand=…>` and the `<TripDateControl>` above it, both dispatching through the screen's existing command-post path. The activity editor (with U2's anchor/location editors) is reachable from every lens that shows an activity.

- [ ] **Step 2: Extend the screen test**

Add a test asserting the switcher renders each lens and that `TripDateControl` posts a `SetTripStartDate` command (via the MSW `onCommand` spy already used by `TripBoardScreen.test.tsx`), and that a formerly-conflicted anchor badge appears/clears when the mocked detail changes `startDate`.

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/board && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS.

```bash
git add apps/web/src/components apps/web/src/app
git commit -m "feat(ui): lens switcher wiring map/timeline/calendar + date control into the trip screen"
```

### Task I3: E2E — the M3 gate demo script

**Files:**
- Create: `apps/web/e2e/m3-place-and-time.spec.ts` (match the existing e2e layout/harness used by M1/M2)

**Interfaces:**
- Consumes: the full wired app; a test `LOCATIONIQ_API_KEY` (or stub the `/api/geocode` route in the e2e harness the way M2 stubs external bits).

- [ ] **Step 1: Write the happy-path script**

Following the gate: sign in (reuse the M0/M1 auth fixture) → create a trip → add two days → set a start date (assert the calendar shows the derived dates) → add an activity, geocode a place, assert a map pin → add a `dayOfWeek` anchor that the current day-1 weekday violates → assert an `anchor-violation` conflict badge → shift the start date so it's satisfied → assert the badge clears → clear the date → assert anchors dormant → undo the shift → assert dates and the conflict return. Keep it one linear script; assert via visible text/roles as M2's script does.

- [ ] **Step 2: Run all e2e + commit**

Run: `pnpm --filter web test:e2e`
Expected: PASS — M0, M1, M2, and the new M3 script all green.

```bash
git add apps/web/e2e
git commit -m "test(e2e): M3 place & time happy-path script"
```

### Task I4: Full verification, docs, and PR

- [ ] **Step 1: Full local gate**

Run: `docker compose up -d && pnpm check` (typecheck + lint + unit + integration) then `pnpm --filter web test:e2e`.
Expected: everything green, including the golden rebuild, the diff round-trip (with anchors), and all four e2e scripts.

- [ ] **Step 2: Configure the geocoding key for deploys**

```bash
vercel env add LOCATIONIQ_API_KEY production   # paste the LocationIQ key
vercel env add LOCATIONIQ_API_KEY preview
```
Add `LOCATIONIQ_API_KEY=` to `.env.example` with a comment pointing at ADR-007. (If Vercel access is unavailable, STOP and hand this step to Mitchell.)

- [ ] **Step 3: Retro note**

Append a short **Retro (2026-07-…)** section to `docs/milestones/M3-place-and-time.md`: what we learned, anything that changed from this plan, any debt parked for M4.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin m3-place-and-time
gh pr create --title "M3: place & time (map/timeline/calendar, date anchors, geocoding)" --body "$(cat <<'EOF'
Implements M3 per docs/plans/2026-07-09-M3-place-and-time.md and the spec.
- Derived day dates (no new events); anchors on activities; injected ConflictContext (ADR-006); OpenFreeMap + LocationIQ geocoding (ADR-007).
- Domain / geocoding / UI were built as independent workstreams meeting at the contracts change.
Gate: all M0–M3 e2e green; diff round-trip + golden rebuild hold with anchors; lint wall green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: On merge** confirm the `migrate-production` job is a no-op (no schema change this milestone) and the deployed URL passes the gate demo. Check the milestone's exit-gate boxes and mark M3 done in `TODO.md` only after the gate demo passes on the deployed URL.

---

## Self-review (completed at authoring)

- **Spec coverage:** dates/derivation → Task 1 + D1 + I1; anchors shape → Task 1; anchor evaluation + ctx (ADR-006) → D3; undo/revert correctness → D2 (diff round-trip with anchors); geocoding + Geocoder seam (ADR-007) → S1; three lenses → U3/U4/U5; drag-the-vacation → U5 + I3; contract surface → Task 1; testing (property/golden/e2e) → D1/D2/D3/I1/I3; out-of-scope items are not built.
- **Placeholder scan:** none — every code step carries real code or a precise, bounded instruction against a named existing file/pattern.
- **Type consistency:** `Anchor`/`Weekday`/`ConflictContext`/`DEFAULT_CONFLICT_CONTEXT`/`deriveDayDates`/`anchorKey`/`GeocodeResult`/`activityPins`/`timelineRows`/`calendarCells`/`serverConflictContext` are defined once and referenced with the same signatures downstream; `anchors: z.array(Anchor).default([])` on events is the single non-breaking mechanism used consistently.
