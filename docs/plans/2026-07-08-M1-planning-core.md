# M1 Planning Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** Turn the M0 skeleton into a planning tool: a trip is a board (backlog + day columns) with draggable activities, a display-only start date, and the first two soft-conflict rules (time overlap, impossible geography) persisted as data through the same command pipeline M0 proved.

**Architecture:** Same as M0 (ADR-001/002/003): pure domain in `packages/domain`, Zod contracts in `packages/contracts`, command pipeline + event store + projections in `apps/web/src/server` behind the lint wall. M1 adds pipeline step 7 (conflict engine run + persistence), a second projection (`trip_details`, one JSONB doc per trip), a generic command dispatcher replacing the single M0 handler, and the board UI.

**Tech Stack:** Everything M0 used, plus: `@atlaskit/pragmatic-drag-and-drop` (+ `-hitbox`) for the board, `fast-check` for property-based conflict-rule tests, `msw` + `@testing-library/react` + `jsdom` + `@vitejs/plugin-react` for contract-honest UI tests.

**Design decisions (made by Mitchell 2026-07-08, recorded in `docs/milestones/M1-planning-core.md`):** days are stable `dayId`s with derived ordinals; start date is display-only (no shift/shrink semantics — M3); activity locations are free-text name + optional manual lat/lng (no geocoder — M3); drag-and-drop via pragmatic-drag-and-drop.

## Global Constraints

- Read `AGENTS.md` before starting. Its invariants override convenience, always.
- Node >= 20, pnpm >= 9. All commands run from the repo root unless stated.
- **Local ports and dev config (M0 retro):** Postgres is on **5433** (`docker compose up -d`), the dev server on **3001** — another local project squats on the defaults; do not "fix" either. Task 0 makes `apps/web/src/config.ts` (browser-safe: `WEB_PORT`, `BASE_URL`) and `apps/web/src/server/config.ts` (`POSTGRES_PORT`, `DATABASE_URL`) the single source of truth for these values; every TypeScript consumer imports them, and env vars override. `docker-compose.yml` and `package.json` scripts cannot import TS, so they carry the same defaults as `${VAR:-default}` interpolations with pointer comments — if you change a default, change it in both places. Never hardcode a port or database URL anywhere else in this plan's code; if a snippet appears to, that is a bug — import from the config modules instead.
- **Branch strategy (M0 retro):** create branch `m1-planning-core` from `main` (isolated worktree recommended via superpowers:using-git-worktrees). One PR at the end (Task 13). CI must be green before merge.
- New dependencies allowed by this plan and NO others: `@atlaskit/pragmatic-drag-and-drop`, `@atlaskit/pragmatic-drag-and-drop-hitbox` (board DnD — Mitchell's pick, powers Jira/Trello, native-DnD based); `fast-check` (property tests — mandated by `docs/guidelines/building-the-parts.md`); `msw`, `@testing-library/react`, `@testing-library/dom`, `jsdom`, `@vitejs/plugin-react` (UI test harness — guidelines mandate MSW-against-contracts). If pnpm reports a hard version conflict, prefer the newest stable that installs cleanly and note it in the commit body.
- Events are forever: never edit stored events; all new event schemas are `version: 1`; event payloads use explicit `null`, never missing keys.
- Every event carries `actor_id`; trips have a `members` list; ALL permission checks go through `AccessPolicy` (AGENTS.md invariant 6).
- No writes to `trip_summaries` or `trip_details` outside `apps/web/src/server/projections.ts` (invariant 1).
- `packages/domain` does no I/O, no clock reads, no randomness (invariant 4). Node runtime only — never edge (ADR-004).
- Local Postgres must be running for integration tests: `docker compose up -d`.
- Commit after every task with the exact message given (conventional commits).
- Known red window: `pnpm -r typecheck` fails between Task 1 and Task 2 (the grown `TripEvent` union makes M0's `evolveTrip` non-exhaustive). Task 1 verifies the contracts package only; the workspace is green again from Task 2 onward.

---

### Task 0: Single-source dev-environment config

**Files:**
- Create: `apps/web/src/config.ts`, `apps/web/src/server/config.ts`
- Modify: `apps/web/src/server/db/client.ts`, `apps/web/drizzle.config.ts`, `apps/web/playwright.config.ts`, `apps/web/package.json` (dev/start scripts), `docker-compose.yml`, `.env.example`

**Interfaces:**
- Produces (imported by later tasks — Task 9's vitest config and apiClient use `BASE_URL`):
  from `@/config` (browser-safe — UI code may import it): `WEB_PORT: number` (default 3001), `BASE_URL: string` (default `http://localhost:3001`);
  from `@/server/config` (server/tooling only): `POSTGRES_PORT: number` (default 5433), `DATABASE_URL: string` (default `postgres://postgres:postgres@localhost:5433/travel`).
  All four read env overrides first. Node-side configs outside `src/` import them by relative path (`./src/config`, `./src/server/config`).

- [ ] **Step 1: Create the config modules**

`apps/web/src/config.ts`:
```ts
// Single source of truth for local dev-environment values (browser-safe half —
// the database URL lives in src/server/config.ts). The M0 retro moved these
// off the defaults (3000/5432) because another local project squats on them.
// docker-compose.yml and package.json scripts cannot import this file; they
// repeat the same defaults as ${VAR:-default} interpolations — keep in sync.
const env: Record<string, string | undefined> =
  typeof process !== "undefined" ? process.env : {};

export const WEB_PORT = Number(env.WEB_PORT ?? 3001);
export const BASE_URL = env.BASE_URL ?? `http://localhost:${WEB_PORT}`;
```

`apps/web/src/server/config.ts`:
```ts
// Server/tooling half of the dev config — never import from UI code
// (the DATABASE_URL default must not end up in a client bundle).
export const POSTGRES_PORT = Number(process.env.POSTGRES_PORT ?? 5433);
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgres://postgres:postgres@localhost:${POSTGRES_PORT}/travel`;
```

- [ ] **Step 2: Rewire every existing consumer**

`apps/web/src/server/db/client.ts` (full new content — the `DATABASE_URL` definition moves to the config module; nothing else imports it from here, verify with the grep in Step 3):
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE_URL } from "../config";
import * as schema from "./schema";

const pool = new Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
```

`apps/web/drizzle.config.ts` (full new content):
```ts
import { defineConfig } from "drizzle-kit";
import { DATABASE_URL } from "./src/server/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: DATABASE_URL },
});
```

`apps/web/playwright.config.ts` (full new content):
```ts
import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./src/config";
import { DATABASE_URL } from "./src/server/config";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: BASE_URL },
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_DEV_LOGIN: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret",
      DATABASE_URL,
    },
  },
});
```

`apps/web/package.json` — the two script lines become (defaults must match `src/config.ts`):
```json
    "dev": "next dev -p ${WEB_PORT:-3001}",
    "start": "next start -p ${WEB_PORT:-3001}",
```

`docker-compose.yml` — the ports line becomes (default must match `src/server/config.ts`):
```yaml
    # Default must match apps/web/src/server/config.ts (compose can't import TS).
    ports: ["${POSTGRES_PORT:-5433}:5432"]
```

Append to `.env.example`:
```bash
# Local port overrides — defaults live in apps/web/src/config.ts and
# apps/web/src/server/config.ts (M0 retro: 3000/5432 are taken on this machine).
# WEB_PORT=3001
# POSTGRES_PORT=5433
```

- [ ] **Step 3: Verify nothing else hardcodes the values**

Run: `grep -rn "5433\|3001" apps/web/src apps/web/playwright.config.ts apps/web/drizzle.config.ts docker-compose.yml apps/web/package.json | grep -v "config.ts"`
Expected: only the two `${VAR:-default}` interpolation lines (package.json, docker-compose.yml) and `.env`-style comments. Any other hit is a missed consumer — rewire it.

- [ ] **Step 4: Run the full existing suite to prove the rewiring is behavior-neutral**

Run: `docker compose up -d && pnpm check && pnpm test:int && pnpm --filter web test:e2e`
Expected: everything green, exactly as before this task (recreate the Postgres container if compose complains about the changed port mapping: `docker compose up -d --force-recreate postgres`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore(web): single-source dev-environment config"
```

---

### Task 1: Contracts — M1 commands, events, TripDetail DTO

**Files:**
- Create: `packages/contracts/src/activity.ts`, `packages/contracts/src/detail.ts`
- Modify: `packages/contracts/src/trip.ts`, `packages/contracts/src/index.ts`, `docs/contracts/CHANGELOG.md`
- Test: `packages/contracts/test/m1.test.ts`

**Interfaces:**
- Produces (imported as `@tc/contracts` by every later task):
  value objects `TimeWindow` (`{start,end}` local `HH:mm`, end > start), `Location` (`{name, lat?, lng?}`, lat/lng together-or-neither);
  commands `AddDay`, `RemoveDay`, `SetTripStartDate`, `AddActivity`, `UpdateActivity`, `MoveActivity`, `RemoveActivity` and union `TripCommand` (includes `CreateTrip`);
  events `DayAddedV1`, `DayRemovedV1`, `TripStartDateSetV1`, `ActivityAddedV1`, `ActivityUpdatedV1`, `ActivityMovedV1`, `ActivityRemovedV1`; `TripEvent` grows into a discriminated union;
  DTOs `ActivityView`, `TripDetail`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/test/m1.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  AddActivity,
  Location,
  MoveActivity,
  SetTripStartDate,
  TimeWindow,
  TripCommand,
  TripDetail,
  TripEvent,
  UpdateActivity,
} from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const ACT = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";

describe("M1 contracts", () => {
  it("TimeWindow requires HH:mm and end after start", () => {
    expect(TimeWindow.safeParse({ start: "09:00", end: "11:00" }).success).toBe(true);
    expect(TimeWindow.safeParse({ start: "11:00", end: "09:00" }).success).toBe(false);
    expect(TimeWindow.safeParse({ start: "9:00", end: "11:00" }).success).toBe(false);
  });

  it("Location requires lat and lng together", () => {
    expect(Location.safeParse({ name: "Rome" }).success).toBe(true);
    expect(Location.safeParse({ name: "Rome", lat: 41.9, lng: 12.5 }).success).toBe(true);
    expect(Location.safeParse({ name: "Rome", lat: 41.9 }).success).toBe(false);
  });

  it("SetTripStartDate takes YYYY-MM-DD or null to clear", () => {
    expect(SetTripStartDate.safeParse({ type: "SetTripStartDate", tripId: TRIP, startDate: "2027-05-01" }).success).toBe(true);
    expect(SetTripStartDate.safeParse({ type: "SetTripStartDate", tripId: TRIP, startDate: null }).success).toBe(true);
    expect(SetTripStartDate.safeParse({ type: "SetTripStartDate", tripId: TRIP, startDate: "May 1" }).success).toBe(false);
  });

  it("parses AddActivity into the backlog (no dayId)", () => {
    const cmd = AddActivity.parse({ type: "AddActivity", tripId: TRIP, activityId: ACT, title: "Colosseum" });
    expect(cmd.dayId).toBeUndefined();
  });

  it("MoveActivity uses null for the backlog", () => {
    const cmd = MoveActivity.parse({ type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: null, position: 0 });
    expect(cmd.toDayId).toBeNull();
  });

  it("UpdateActivity distinguishes omitted (unchanged) from null (cleared)", () => {
    const cmd = UpdateActivity.parse({ type: "UpdateActivity", tripId: TRIP, activityId: ACT, timeWindow: null });
    expect(cmd.timeWindow).toBeNull();
    expect(cmd.title).toBeUndefined();
  });

  it("TripCommand and TripEvent discriminate on type", () => {
    const cmd = TripCommand.parse({ type: "AddDay", tripId: TRIP, dayId: DAY });
    expect(cmd.type).toBe("AddDay");
    const event = TripEvent.parse({ type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY } });
    expect(event.type).toBe("DayAdded");
  });

  it("event payloads use explicit nulls, not missing keys", () => {
    expect(
      TripEvent.safeParse({
        type: "ActivityAdded",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, dayId: null, title: "Colosseum", timeWindow: null, location: null, notes: null },
      }).success,
    ).toBe(true);
    expect(
      TripEvent.safeParse({
        type: "ActivityAdded",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, title: "Colosseum" },
      }).success,
    ).toBe(false);
  });

  it("TripDetail parses a full board document", () => {
    const detail = TripDetail.parse({
      tripId: TRIP,
      name: "Rome 2027",
      startDate: "2027-05-01",
      members: [{ userId: "dev-alice", role: "owner" }],
      days: [{ dayId: DAY, activityIds: [ACT] }],
      backlog: [],
      activities: {
        [ACT]: {
          activityId: ACT,
          title: "Colosseum",
          timeWindow: { start: "09:00", end: "11:00" },
          location: { name: "Rome", lat: 41.9, lng: 12.5 },
          notes: null,
        },
      },
      conflicts: [],
      createdAt: "2026-07-08T12:00:00.000Z",
    });
    expect(detail.days[0]!.activityIds).toEqual([ACT]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/contracts test`
Expected: FAIL — `AddActivity` (etc.) not exported from `../src`.

- [ ] **Step 3: Implement**

`packages/contracts/src/activity.ts` (new):
```ts
import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeWindow = z
  .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
  .refine((w) => w.start < w.end, { message: "end must be after start" });
export type TimeWindow = z.infer<typeof TimeWindow>;

export const Location = z
  .object({
    name: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((l) => (l.lat === undefined) === (l.lng === undefined), {
    message: "lat and lng must be provided together",
  });
export type Location = z.infer<typeof Location>;

// ---- Commands ----

export const AddActivity = z.object({
  type: z.literal("AddActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  dayId: z.string().uuid().optional(), // omitted = backlog
  title: z.string().min(1).max(200),
  timeWindow: TimeWindow.optional(),
  location: Location.optional(),
  notes: z.string().max(2000).optional(),
});
export type AddActivity = z.infer<typeof AddActivity>;

// Omitted field = unchanged; null = cleared. Title cannot be cleared.
export const UpdateActivity = z.object({
  type: z.literal("UpdateActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  timeWindow: TimeWindow.nullable().optional(),
  location: Location.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateActivity = z.infer<typeof UpdateActivity>;

export const MoveActivity = z.object({
  type: z.literal("MoveActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  toDayId: z.string().uuid().nullable(), // null = backlog
  position: z.number().int().nonnegative(),
});
export type MoveActivity = z.infer<typeof MoveActivity>;

export const RemoveActivity = z.object({
  type: z.literal("RemoveActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
});
export type RemoveActivity = z.infer<typeof RemoveActivity>;

// ---- Events (payloads use explicit null — they are stored as jsonb forever) ----

export const ActivityAddedV1 = z.object({
  type: z.literal("ActivityAdded"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
    dayId: z.string().uuid().nullable(),
    title: z.string().min(1).max(200),
    timeWindow: TimeWindow.nullable(),
    location: Location.nullable(),
    notes: z.string().max(2000).nullable(),
  }),
});
export type ActivityAddedV1 = z.infer<typeof ActivityAddedV1>;

// Snapshot of the full field set AFTER the update — replay never merges patches.
export const ActivityUpdatedV1 = z.object({
  type: z.literal("ActivityUpdated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
    title: z.string().min(1).max(200),
    timeWindow: TimeWindow.nullable(),
    location: Location.nullable(),
    notes: z.string().max(2000).nullable(),
  }),
});
export type ActivityUpdatedV1 = z.infer<typeof ActivityUpdatedV1>;

export const ActivityMovedV1 = z.object({
  type: z.literal("ActivityMoved"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
    toDayId: z.string().uuid().nullable(),
    position: z.number().int().nonnegative(),
  }),
});
export type ActivityMovedV1 = z.infer<typeof ActivityMovedV1>;

export const ActivityRemovedV1 = z.object({
  type: z.literal("ActivityRemoved"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
  }),
});
export type ActivityRemovedV1 = z.infer<typeof ActivityRemovedV1>;
```

`packages/contracts/src/trip.ts` — add after the existing `CreateTrip` block (keep everything already there except the `TripEvent` lines, which are replaced):
```ts
import {
  ActivityAddedV1,
  ActivityMovedV1,
  ActivityRemovedV1,
  ActivityUpdatedV1,
  AddActivity,
  MoveActivity,
  RemoveActivity,
  UpdateActivity,
} from "./activity";

export const AddDay = z.object({
  type: z.literal("AddDay"),
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
});
export type AddDay = z.infer<typeof AddDay>;

export const RemoveDay = z.object({
  type: z.literal("RemoveDay"),
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
});
export type RemoveDay = z.infer<typeof RemoveDay>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Display-only until M3: the domain and conflict engine never read this.
export const SetTripStartDate = z.object({
  type: z.literal("SetTripStartDate"),
  tripId: z.string().uuid(),
  startDate: z.string().regex(ISO_DATE).nullable(), // null clears
});
export type SetTripStartDate = z.infer<typeof SetTripStartDate>;

export const DayAddedV1 = z.object({
  type: z.literal("DayAdded"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), dayId: z.string().uuid() }),
});
export type DayAddedV1 = z.infer<typeof DayAddedV1>;

// Its activities return to the backlog (evolve semantics).
export const DayRemovedV1 = z.object({
  type: z.literal("DayRemoved"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), dayId: z.string().uuid() }),
});
export type DayRemovedV1 = z.infer<typeof DayRemovedV1>;

export const TripStartDateSetV1 = z.object({
  type: z.literal("TripStartDateSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), startDate: z.string().regex(ISO_DATE).nullable() }),
});
export type TripStartDateSetV1 = z.infer<typeof TripStartDateSetV1>;

// REPLACES the M0 `export const TripEvent = TripCreatedV1;` lines:
export const TripEvent = z.discriminatedUnion("type", [
  TripCreatedV1,
  DayAddedV1,
  DayRemovedV1,
  TripStartDateSetV1,
  ActivityAddedV1,
  ActivityUpdatedV1,
  ActivityMovedV1,
  ActivityRemovedV1,
]);
export type TripEvent = z.infer<typeof TripEvent>;

export const TripCommand = z.discriminatedUnion("type", [
  CreateTrip,
  AddDay,
  RemoveDay,
  SetTripStartDate,
  AddActivity,
  UpdateActivity,
  MoveActivity,
  RemoveActivity,
]);
export type TripCommand = z.infer<typeof TripCommand>;
```

`packages/contracts/src/detail.ts` (new):
```ts
import { z } from "zod";
import { Conflict } from "./conflict";
import { TripMember } from "./trip";
import { Location, TimeWindow } from "./activity";

export const ActivityView = z.object({
  activityId: z.string().uuid(),
  title: z.string(),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().nullable(),
});
export type ActivityView = z.infer<typeof ActivityView>;

// The board read model: one document per trip, conflicts included.
export const TripDetail = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  startDate: z.string().nullable(),
  members: z.array(TripMember).min(1),
  days: z.array(z.object({ dayId: z.string().uuid(), activityIds: z.array(z.string().uuid()) })),
  backlog: z.array(z.string().uuid()),
  activities: z.record(ActivityView),
  conflicts: z.array(Conflict),
  createdAt: z.string(), // ISO 8601, from the first envelope
});
export type TripDetail = z.infer<typeof TripDetail>;
```

`packages/contracts/src/index.ts` (full new content):
```ts
export * from "./trip";
export * from "./activity";
export * from "./detail";
export * from "./envelope";
export * from "./conflict";
```

- [ ] **Step 4: Run contracts tests and typecheck**

Run: `pnpm --filter @tc/contracts test && pnpm --filter @tc/contracts typecheck`
Expected: 13 passing (4 M0 + 9 new); typecheck exits 0.
(`pnpm -r typecheck` is EXPECTED to fail in `@tc/domain` right now — the union made `evolveTrip` non-exhaustive. Task 2 fixes it. Do not "fix" domain in this task.)

- [ ] **Step 5: Update the contracts changelog**

Replace the placeholder line at the bottom of `docs/contracts/CHANGELOG.md` (`_No entries yet — contracts package is not scaffolded until M0._`) with:
```md
## 2026-07-08 — M1 planning-core schemas
- Added: commands `AddDay`, `RemoveDay`, `SetTripStartDate`, `AddActivity`,
  `UpdateActivity`, `MoveActivity`, `RemoveActivity`; command union `TripCommand`
- Added: events `DayAddedV1`, `DayRemovedV1`, `TripStartDateSetV1`,
  `ActivityAddedV1`, `ActivityUpdatedV1`, `ActivityMovedV1`, `ActivityRemovedV1`;
  `TripEvent` grew from a single schema into a discriminated union
- Added: value objects `TimeWindow`, `Location`; DTOs `ActivityView`, `TripDetail`
- Why: M1 planning core — days, backlog, activities, board moves, conflicts read model
- Consumers updated: `@tc/domain` (decide/evolve/projections), `apps/web` (pipeline, routes, UI) — in this same PR
- Breaking? no — `TripEvent.parse` accepts all previously stored events unchanged

## 2026-07-08 — backfill: M0 initial schemas (created 2026-07-07)
- Added (in M0): `CreateTrip`, `TripCreatedV1`, `TripEvent`, `TripMember`,
  `TripSummary`, `EventEnvelope`, `Conflict`
- Why: recorded retroactively — M0 created the package without a changelog entry
- Consumers: `@tc/domain`, `apps/web`
- Breaking? no
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(contracts): m1 planning-core commands, events, trip-detail dto"
```

---

### Task 2: Domain — extended state and total evolve

**Files:**
- Modify: `packages/domain/src/trip/state.ts`, `packages/domain/src/trip/evolve.ts`, `packages/domain/test/trip.test.ts`
- Test: `packages/domain/test/evolve.test.ts`

**Interfaces:**
- Consumes: `TripEvent`, `TimeWindow`, `Location`, `TripMember` from `@tc/contracts`.
- Produces (used by every later domain/server task):
  `ActivityState = { title: string; timeWindow: TimeWindow | null; location: Location | null; notes: string | null }`,
  `DayState = { dayId: string; activityIds: string[] }`,
  `TripState = { tripId; name; members: TripMember[]; startDate: string | null; days: DayState[]; backlog: string[]; activities: Record<string, ActivityState> }`,
  `evolveTrip(state: TripState | null, event: TripEvent): TripState` — total over the whole union.

- [ ] **Step 1: Update the M0 test expectations and write the failing evolve tests**

`packages/domain/test/trip.test.ts` (full new content — the M0 expectations gain the new empty-board fields):
```ts
import { describe, expect, it } from "vitest";
import { decideCreateTrip, evolveTrip, type TripState } from "../src";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const cmd = { type: "CreateTrip", tripId: TRIP_ID, name: "Rome 2027" } as const;

describe("decideCreateTrip", () => {
  it("emits TripCreated with the actor as createdBy on fresh state", () => {
    const decision = decideCreateTrip(null, cmd, { actorId: "user-1" });
    if (!decision.ok) throw new Error("expected ok");
    expect(decision.events).toEqual([
      {
        type: "TripCreated",
        version: 1,
        payload: { tripId: TRIP_ID, name: "Rome 2027", createdBy: "user-1" },
      },
    ]);
  });

  it("rejects when the trip already exists", () => {
    const existing: TripState = {
      tripId: TRIP_ID,
      name: "Rome 2027",
      members: [{ userId: "user-1", role: "owner" }],
      startDate: null,
      days: [],
      backlog: [],
      activities: {},
    };
    const decision = decideCreateTrip(existing, cmd, { actorId: "user-1" });
    expect(decision).toEqual({
      ok: false,
      rejection: {
        code: "trip-already-exists",
        message: "A trip with this id already exists.",
      },
    });
  });
});

describe("evolveTrip", () => {
  it("builds an empty board with the creator as the sole member", () => {
    const state = evolveTrip(null, {
      type: "TripCreated",
      version: 1,
      payload: { tripId: TRIP_ID, name: "Rome 2027", createdBy: "user-1" },
    });
    expect(state).toEqual({
      tripId: TRIP_ID,
      name: "Rome 2027",
      members: [{ userId: "user-1", role: "owner" }],
      startDate: null,
      days: [],
      backlog: [],
      activities: {},
    });
  });
});
```

`packages/domain/test/evolve.test.ts` (new):
```ts
import { describe, expect, it } from "vitest";
import type { TripEvent } from "@tc/contracts";
import { evolveTrip, type TripState } from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY_A = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const DAY_B = "8a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a81";
const ACT = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";

const created: TripEvent = {
  type: "TripCreated",
  version: 1,
  payload: { tripId: TRIP, name: "Rome 2027", createdBy: "user-1" },
};

function fold(events: TripEvent[]): TripState {
  let state: TripState | null = null;
  for (const event of events) state = evolveTrip(state, event);
  if (state === null) throw new Error("no events");
  return state;
}

const addActivity: TripEvent = {
  type: "ActivityAdded",
  version: 1,
  payload: {
    tripId: TRIP,
    activityId: ACT,
    dayId: null,
    title: "Colosseum",
    timeWindow: { start: "09:00", end: "11:00" },
    location: null,
    notes: null,
  },
};

describe("evolveTrip (M1 events)", () => {
  it("adds days in order and sets/clears the display-only start date", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_B } },
      { type: "TripStartDateSet", version: 1, payload: { tripId: TRIP, startDate: "2027-05-01" } },
    ]);
    expect(state.days).toEqual([
      { dayId: DAY_A, activityIds: [] },
      { dayId: DAY_B, activityIds: [] },
    ]);
    expect(state.startDate).toBe("2027-05-01");
    const cleared = evolveTrip(state, {
      type: "TripStartDateSet",
      version: 1,
      payload: { tripId: TRIP, startDate: null },
    });
    expect(cleared.startDate).toBeNull();
  });

  it("adds an activity to the backlog and moves it onto a day at a position", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY_A, position: 0 } },
    ]);
    expect(state.backlog).toEqual([]);
    expect(state.days).toEqual([{ dayId: DAY_A, activityIds: [ACT] }]);
    expect(state.activities[ACT]).toEqual({
      title: "Colosseum",
      timeWindow: { start: "09:00", end: "11:00" },
      location: null,
      notes: null,
    });
  });

  it("clamps an out-of-range move position instead of throwing", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY_A, position: 99 } },
    ]);
    expect(state.days).toEqual([{ dayId: DAY_A, activityIds: [ACT] }]);
  });

  it("replaces the field snapshot on ActivityUpdated", () => {
    const state = fold([
      created,
      addActivity,
      {
        type: "ActivityUpdated",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, title: "Colosseum tour", timeWindow: null, location: null, notes: "book ahead" },
      },
    ]);
    expect(state.activities[ACT]).toEqual({
      title: "Colosseum tour",
      timeWindow: null,
      location: null,
      notes: "book ahead",
    });
  });

  it("returns a removed day's activities to the backlog", () => {
    const state = fold([
      created,
      { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
      addActivity,
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY_A, position: 0 } },
      { type: "DayRemoved", version: 1, payload: { tripId: TRIP, dayId: DAY_A } },
    ]);
    expect(state.days).toEqual([]);
    expect(state.backlog).toEqual([ACT]);
  });

  it("removes an activity everywhere", () => {
    const state = fold([
      created,
      addActivity,
      { type: "ActivityRemoved", version: 1, payload: { tripId: TRIP, activityId: ACT } },
    ]);
    expect(state.backlog).toEqual([]);
    expect(state.activities).toEqual({});
  });

  it("throws the replay totality guard on an event before TripCreated", () => {
    expect(() =>
      evolveTrip(null, { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY_A } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test`
Expected: FAIL — `TripState` lacks the new fields / `evolveTrip` does not handle M1 events.

- [ ] **Step 3: Implement**

`packages/domain/src/trip/state.ts` (full new content):
```ts
import type { Location, TimeWindow, TripMember } from "@tc/contracts";

export type ActivityState = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
};

export type DayState = {
  dayId: string;
  activityIds: string[];
};

export type TripState = {
  tripId: string;
  name: string;
  members: TripMember[];
  startDate: string | null; // display-only until M3
  days: DayState[]; // ordinal = position in this array
  backlog: string[]; // ordered activityIds without a day
  activities: Record<string, ActivityState>;
};
```

`packages/domain/src/trip/evolve.ts` (full new content):
```ts
import type { TripEvent } from "@tc/contracts";
import type { TripState } from "./state";

function removeEverywhere(state: TripState, activityId: string): TripState {
  return {
    ...state,
    backlog: state.backlog.filter((id) => id !== activityId),
    days: state.days.map((d) => ({
      ...d,
      activityIds: d.activityIds.filter((id) => id !== activityId),
    })),
  };
}

function insertAt(list: string[], id: string, position: number): string[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(position, next.length)), 0, id);
  return next;
}

export function evolveTrip(state: TripState | null, event: TripEvent): TripState {
  if (event.type === "TripCreated") {
    return {
      tripId: event.payload.tripId,
      name: event.payload.name,
      members: [{ userId: event.payload.createdBy, role: "owner" }],
      startDate: null,
      days: [],
      backlog: [],
      activities: {},
    };
  }

  // Replay totality guard: a well-formed stream always starts with TripCreated.
  if (state === null) {
    throw new Error(`event ${event.type} arrived before TripCreated — corrupt stream`);
  }

  switch (event.type) {
    case "DayAdded":
      return {
        ...state,
        days: [...state.days, { dayId: event.payload.dayId, activityIds: [] }],
      };
    case "DayRemoved": {
      const day = state.days.find((d) => d.dayId === event.payload.dayId);
      return {
        ...state,
        days: state.days.filter((d) => d.dayId !== event.payload.dayId),
        backlog: [...state.backlog, ...(day?.activityIds ?? [])],
      };
    }
    case "TripStartDateSet":
      return { ...state, startDate: event.payload.startDate };
    case "ActivityAdded": {
      const { activityId, dayId, title, timeWindow, location, notes } = event.payload;
      const next: TripState = {
        ...state,
        activities: {
          ...state.activities,
          [activityId]: { title, timeWindow, location, notes },
        },
      };
      if (dayId === null) return { ...next, backlog: [...next.backlog, activityId] };
      return {
        ...next,
        days: next.days.map((d) =>
          d.dayId === dayId ? { ...d, activityIds: [...d.activityIds, activityId] } : d,
        ),
      };
    }
    case "ActivityUpdated": {
      const { activityId, title, timeWindow, location, notes } = event.payload;
      return {
        ...state,
        activities: { ...state.activities, [activityId]: { title, timeWindow, location, notes } },
      };
    }
    case "ActivityMoved": {
      const { activityId, toDayId, position } = event.payload;
      const removed = removeEverywhere(state, activityId);
      if (toDayId === null) {
        return { ...removed, backlog: insertAt(removed.backlog, activityId, position) };
      }
      return {
        ...removed,
        days: removed.days.map((d) =>
          d.dayId === toDayId
            ? { ...d, activityIds: insertAt(d.activityIds, activityId, position) }
            : d,
        ),
      };
    }
    case "ActivityRemoved": {
      const removed = removeEverywhere(state, event.payload.activityId);
      const activities = { ...removed.activities };
      delete activities[event.payload.activityId];
      return { ...removed, activities };
    }
  }
}
```

- [ ] **Step 4: Run tests and the full typecheck**

Run: `pnpm --filter @tc/domain test && pnpm -r typecheck`
Expected: 10 domain tests passing (3 trip + 7 evolve; project.test.ts's 2 also still green = 12 total); workspace typecheck green again.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): extended trip state and total evolve for m1 events"
```

---

### Task 3: Domain — decide handlers for every command

**Files:**
- Modify: `packages/domain/src/trip/decide.ts`
- Test: `packages/domain/test/commands.test.ts`

**Interfaces:**
- Consumes: `TripCommand`, `TripEvent` from `@tc/contracts`; `TripState` from Task 2.
- Produces: `decideTripCommand(state: TripState | null, command: TripCommand, ctx: DecideContext): Decision` — the single dispatcher the server pipeline calls. Rejection codes: `trip-not-found`, `trip-already-exists`, `day-already-exists`, `day-not-found`, `activity-already-exists`, `activity-not-found`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/commands.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { TripCommand, TripEvent } from "@tc/contracts";
import { decideTripCommand, evolveTrip, type Decision, type TripState } from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const ACT = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";

function fold(events: TripEvent[]): TripState {
  let state: TripState | null = null;
  for (const event of events) state = evolveTrip(state, event);
  if (state === null) throw new Error("no events");
  return state;
}

function run(state: TripState | null, command: TripCommand): Decision {
  return decideTripCommand(state, command, { actorId: "user-1" });
}

const base = fold([
  { type: "TripCreated", version: 1, payload: { tripId: TRIP, name: "Rome 2027", createdBy: "user-1" } },
  { type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY } },
]);

const withActivity = evolveTrip(base, {
  type: "ActivityAdded",
  version: 1,
  payload: { tripId: TRIP, activityId: ACT, dayId: null, title: "Colosseum", timeWindow: null, location: null, notes: null },
});

describe("decideTripCommand", () => {
  it("rejects any non-create command on a missing trip", () => {
    const decision = run(null, { type: "AddDay", tripId: TRIP, dayId: DAY });
    expect(decision).toMatchObject({ ok: false, rejection: { code: "trip-not-found" } });
  });

  it("dispatches CreateTrip to the M0 handler", () => {
    const decision = run(null, { type: "CreateTrip", tripId: TRIP, name: "Rome 2027" });
    expect(decision.ok).toBe(true);
  });

  it("adds a day, rejecting duplicates", () => {
    const ok = run(base, { type: "AddDay", tripId: TRIP, dayId: ACT });
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.events).toEqual([{ type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: ACT } }]);
    const dup = run(base, { type: "AddDay", tripId: TRIP, dayId: DAY });
    expect(dup).toMatchObject({ ok: false, rejection: { code: "day-already-exists" } });
  });

  it("removes a day, rejecting unknown ids", () => {
    const ok = run(base, { type: "RemoveDay", tripId: TRIP, dayId: DAY });
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.events).toEqual([{ type: "DayRemoved", version: 1, payload: { tripId: TRIP, dayId: DAY } }]);
    const missing = run(base, { type: "RemoveDay", tripId: TRIP, dayId: ACT });
    expect(missing).toMatchObject({ ok: false, rejection: { code: "day-not-found" } });
  });

  it("sets and clears the start date", () => {
    const set = run(base, { type: "SetTripStartDate", tripId: TRIP, startDate: "2027-05-01" });
    if (!set.ok) throw new Error("expected ok");
    expect(set.events).toEqual([
      { type: "TripStartDateSet", version: 1, payload: { tripId: TRIP, startDate: "2027-05-01" } },
    ]);
  });

  it("normalizes omitted AddActivity fields to explicit nulls in the event", () => {
    const decision = run(base, { type: "AddActivity", tripId: TRIP, activityId: ACT, title: "Colosseum" });
    if (!decision.ok) throw new Error("expected ok");
    expect(decision.events).toEqual([
      {
        type: "ActivityAdded",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, dayId: null, title: "Colosseum", timeWindow: null, location: null, notes: null },
      },
    ]);
  });

  it("rejects AddActivity onto an unknown day or with a duplicate id", () => {
    const badDay = run(base, { type: "AddActivity", tripId: TRIP, activityId: ACT, title: "x", dayId: ACT });
    expect(badDay).toMatchObject({ ok: false, rejection: { code: "day-not-found" } });
    const dup = run(withActivity, { type: "AddActivity", tripId: TRIP, activityId: ACT, title: "x" });
    expect(dup).toMatchObject({ ok: false, rejection: { code: "activity-already-exists" } });
  });

  it("UpdateActivity merges: omitted keeps, null clears, and snapshots the result", () => {
    const timed = evolveTrip(withActivity, {
      type: "ActivityUpdated",
      version: 1,
      payload: { tripId: TRIP, activityId: ACT, title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null },
    });
    const decision = run(timed, { type: "UpdateActivity", tripId: TRIP, activityId: ACT, notes: "book ahead" });
    if (!decision.ok) throw new Error("expected ok");
    expect(decision.events).toEqual([
      {
        type: "ActivityUpdated",
        version: 1,
        payload: {
          tripId: TRIP,
          activityId: ACT,
          title: "Colosseum",
          timeWindow: { start: "09:00", end: "11:00" }, // kept (omitted)
          location: null,
          notes: "book ahead",
        },
      },
    ]);
    const cleared = run(timed, { type: "UpdateActivity", tripId: TRIP, activityId: ACT, timeWindow: null });
    if (!cleared.ok) throw new Error("expected ok");
    expect(cleared.events[0]).toMatchObject({ payload: { timeWindow: null } });
  });

  it("MoveActivity validates the activity and the target day", () => {
    const ok = run(withActivity, { type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: DAY, position: 0 });
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.events).toEqual([
      { type: "ActivityMoved", version: 1, payload: { tripId: TRIP, activityId: ACT, toDayId: DAY, position: 0 } },
    ]);
    const badActivity = run(base, { type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: null, position: 0 });
    expect(badActivity).toMatchObject({ ok: false, rejection: { code: "activity-not-found" } });
    const badDay = run(withActivity, { type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: ACT, position: 0 });
    expect(badDay).toMatchObject({ ok: false, rejection: { code: "day-not-found" } });
  });

  it("RemoveActivity validates the activity", () => {
    const ok = run(withActivity, { type: "RemoveActivity", tripId: TRIP, activityId: ACT });
    expect(ok.ok).toBe(true);
    const missing = run(base, { type: "RemoveActivity", tripId: TRIP, activityId: ACT });
    expect(missing).toMatchObject({ ok: false, rejection: { code: "activity-not-found" } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test`
Expected: FAIL — `decideTripCommand` not exported.

- [ ] **Step 3: Implement**

`packages/domain/src/trip/decide.ts` (full new content — `decideCreateTrip` body is unchanged from M0):
```ts
import type { CreateTrip, TripCommand, TripEvent } from "@tc/contracts";
import type { TripState } from "./state";

export type Rejection = { code: string; message: string };
export type Decision =
  | { ok: true; events: TripEvent[] }
  | { ok: false; rejection: Rejection };

export type DecideContext = { actorId: string };

function ok(events: TripEvent[]): Decision {
  return { ok: true, events };
}

function reject(code: string, message: string): Decision {
  return { ok: false, rejection: { code, message } };
}

export function decideCreateTrip(
  state: TripState | null,
  command: CreateTrip,
  ctx: DecideContext,
): Decision {
  if (state !== null) {
    return reject("trip-already-exists", "A trip with this id already exists.");
  }
  return ok([
    {
      type: "TripCreated",
      version: 1,
      payload: {
        tripId: command.tripId,
        name: command.name,
        createdBy: ctx.actorId,
      },
    },
  ]);
}

export function decideTripCommand(
  state: TripState | null,
  command: TripCommand,
  ctx: DecideContext,
): Decision {
  if (command.type === "CreateTrip") return decideCreateTrip(state, command, ctx);
  if (state === null) return reject("trip-not-found", "This trip does not exist.");

  switch (command.type) {
    case "AddDay":
      if (state.days.some((d) => d.dayId === command.dayId)) {
        return reject("day-already-exists", "A day with this id already exists.");
      }
      return ok([
        { type: "DayAdded", version: 1, payload: { tripId: command.tripId, dayId: command.dayId } },
      ]);
    case "RemoveDay":
      if (!state.days.some((d) => d.dayId === command.dayId)) {
        return reject("day-not-found", "This day does not exist.");
      }
      return ok([
        { type: "DayRemoved", version: 1, payload: { tripId: command.tripId, dayId: command.dayId } },
      ]);
    case "SetTripStartDate":
      return ok([
        {
          type: "TripStartDateSet",
          version: 1,
          payload: { tripId: command.tripId, startDate: command.startDate },
        },
      ]);
    case "AddActivity": {
      if (state.activities[command.activityId] !== undefined) {
        return reject("activity-already-exists", "An activity with this id already exists.");
      }
      if (command.dayId !== undefined && !state.days.some((d) => d.dayId === command.dayId)) {
        return reject("day-not-found", "This day does not exist.");
      }
      return ok([
        {
          type: "ActivityAdded",
          version: 1,
          payload: {
            tripId: command.tripId,
            activityId: command.activityId,
            dayId: command.dayId ?? null,
            title: command.title,
            timeWindow: command.timeWindow ?? null,
            location: command.location ?? null,
            notes: command.notes ?? null,
          },
        },
      ]);
    }
    case "UpdateActivity": {
      const current = state.activities[command.activityId];
      if (current === undefined) {
        return reject("activity-not-found", "This activity does not exist.");
      }
      // Omitted = unchanged, null = cleared; the event snapshots the result.
      return ok([
        {
          type: "ActivityUpdated",
          version: 1,
          payload: {
            tripId: command.tripId,
            activityId: command.activityId,
            title: command.title ?? current.title,
            timeWindow: command.timeWindow === undefined ? current.timeWindow : command.timeWindow,
            location: command.location === undefined ? current.location : command.location,
            notes: command.notes === undefined ? current.notes : command.notes,
          },
        },
      ]);
    }
    case "MoveActivity":
      if (state.activities[command.activityId] === undefined) {
        return reject("activity-not-found", "This activity does not exist.");
      }
      if (command.toDayId !== null && !state.days.some((d) => d.dayId === command.toDayId)) {
        return reject("day-not-found", "This day does not exist.");
      }
      return ok([
        {
          type: "ActivityMoved",
          version: 1,
          payload: {
            tripId: command.tripId,
            activityId: command.activityId,
            toDayId: command.toDayId,
            position: command.position,
          },
        },
      ]);
    case "RemoveActivity":
      if (state.activities[command.activityId] === undefined) {
        return reject("activity-not-found", "This activity does not exist.");
      }
      return ok([
        {
          type: "ActivityRemoved",
          version: 1,
          payload: { tripId: command.tripId, activityId: command.activityId },
        },
      ]);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tc/domain test && pnpm --filter @tc/domain typecheck`
Expected: 22 passing (12 from Task 2 + 10 new); typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): decide handlers for day, date, and activity commands"
```

---

### Task 4: Domain — conflict engine (overlap + geography)

**Files:**
- Create: `packages/domain/src/trip/conflicts.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/package.json` (add fast-check)
- Test: `packages/domain/test/conflicts.test.ts`

**Interfaces:**
- Consumes: `Conflict`, `TimeWindow` from `@tc/contracts`; `TripState` from Task 2.
- Produces: `detectConflicts(state: TripState): Conflict[]` (deterministically sorted by conflict id), `windowsOverlap(a: TimeWindow, b: TimeWindow): boolean`, `haversineKm(a: {lat;lng}, b: {lat;lng}): number`, `GEO_INFEASIBLE_KM = 150`.

- [ ] **Step 1: Add fast-check**

Run: `pnpm --filter @tc/domain add -D fast-check`

- [ ] **Step 2: Write the failing tests**

`packages/domain/test/conflicts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TimeWindow } from "@tc/contracts";
import {
  detectConflicts,
  GEO_INFEASIBLE_KM,
  haversineKm,
  windowsOverlap,
  type TripState,
} from "../src";

type ActivitySpec = {
  id: string;
  title?: string;
  window?: TimeWindow;
  point?: { name: string; lat: number; lng: number };
};

function boardState(dayActivities: ActivitySpec[], backlogActivities: ActivitySpec[] = []): TripState {
  const all = [...dayActivities, ...backlogActivities];
  return {
    tripId: "trip-1",
    name: "Test",
    members: [{ userId: "user-1", role: "owner" }],
    startDate: null,
    days: [{ dayId: "day-1", activityIds: dayActivities.map((a) => a.id) }],
    backlog: backlogActivities.map((a) => a.id),
    activities: Object.fromEntries(
      all.map((a) => [
        a.id,
        {
          title: a.title ?? a.id,
          timeWindow: a.window ?? null,
          location: a.point ? { name: a.point.name, lat: a.point.lat, lng: a.point.lng } : null,
          notes: null,
        },
      ]),
    ),
  };
}

const ROME = { name: "Rome", lat: 41.8902, lng: 12.4922 };
const VATICAN = { name: "Vatican", lat: 41.9066, lng: 12.4536 };
const NYC = { name: "New York", lat: 40.7794, lng: -73.9632 };

describe("time-overlap rule", () => {
  it("flags overlapping windows on the same day, subjects sorted", () => {
    const conflicts = detectConflicts(
      boardState([
        { id: "b", window: { start: "09:00", end: "11:00" } },
        { id: "a", window: { start: "10:00", end: "12:00" } },
      ]),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "time-overlap",
      severity: "warn",
      subjects: ["a", "b"],
    });
    expect(conflicts[0]!.resolutions.length).toBeGreaterThan(0);
  });

  it("does not flag adjacent windows or untimed activities", () => {
    expect(
      detectConflicts(
        boardState([
          { id: "a", window: { start: "09:00", end: "10:00" } },
          { id: "b", window: { start: "10:00", end: "11:00" } },
          { id: "c" },
        ]),
      ),
    ).toEqual([]);
  });

  it("ignores the backlog entirely", () => {
    expect(
      detectConflicts(
        boardState(
          [],
          [
            { id: "a", window: { start: "09:00", end: "11:00" } },
            { id: "b", window: { start: "09:00", end: "11:00" } },
          ],
        ),
      ),
    ).toEqual([]);
  });
});

describe("impossible-geography rule", () => {
  it("flags far-apart located activities on the same day", () => {
    const conflicts = detectConflicts(
      boardState([
        { id: "a", point: ROME },
        { id: "b", point: NYC },
      ]),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "impossible-geography", severity: "warn", subjects: ["a", "b"] });
  });

  it("allows nearby activities and unlocated pairs", () => {
    expect(
      detectConflicts(
        boardState([
          { id: "a", point: ROME },
          { id: "b", point: VATICAN },
          { id: "c" },
        ]),
      ),
    ).toEqual([]);
  });

  it("haversine sanity: Rome–NYC is far, Rome–Vatican is near", () => {
    expect(haversineKm(ROME, NYC)).toBeGreaterThan(GEO_INFEASIBLE_KM);
    expect(haversineKm(ROME, VATICAN)).toBeLessThan(10);
  });
});

// ---- property-based tests (guidelines: every rule gets them) ----

const minuteOfDay = fc.integer({ min: 0, max: 24 * 60 - 1 });
const arbWindow = fc
  .tuple(minuteOfDay, minuteOfDay)
  .filter(([a, b]) => a !== b)
  .map(([a, b]) => {
    const [start, end] = a < b ? [a, b] : [b, a];
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { start: fmt(start), end: fmt(end) };
  });

const arbPoint = fc.record({
  name: fc.constant("Somewhere"),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe("conflict engine properties", () => {
  it("windowsOverlap is symmetric", () => {
    fc.assert(
      fc.property(arbWindow, arbWindow, (a, b) => windowsOverlap(a, b) === windowsOverlap(b, a)),
    );
  });

  it("haversine is symmetric, non-negative, zero on identity", () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, (a, b) => {
        const d1 = haversineKm(a, b);
        const d2 = haversineKm(b, a);
        return d1 >= 0 && Math.abs(d1 - d2) < 1e-6 && haversineKm(a, a) < 1e-6;
      }),
    );
  });

  it("conflicts always pair two distinct, sorted subjects — never self-conflicts", () => {
    fc.assert(
      fc.property(fc.array(arbWindow, { maxLength: 6 }), (windows) => {
        const state = boardState(windows.map((window, i) => ({ id: `a${i}`, window })));
        return detectConflicts(state).every(
          (c) => c.subjects.length === 2 && c.subjects[0]! < c.subjects[1]!,
        );
      }),
    );
  });

  it("conflict ids are invariant under activity insertion order", () => {
    fc.assert(
      fc.property(fc.array(arbWindow, { maxLength: 6 }), (windows) => {
        const specs = windows.map((window, i) => ({ id: `a${i}`, window }));
        const ids = (s: TripState) => detectConflicts(s).map((c) => c.id);
        return (
          JSON.stringify(ids(boardState(specs))) ===
          JSON.stringify(ids(boardState([...specs].reverse())))
        );
      }),
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @tc/domain test`
Expected: FAIL — `detectConflicts` not exported.

- [ ] **Step 4: Implement**

`packages/domain/src/trip/conflicts.ts`:
```ts
import type { Conflict, TimeWindow } from "@tc/contracts";
import type { TripState } from "./state";

// Same-day activities further apart than this are flagged as impossible
// geography. Deliberately crude in M1 — travel-time/gap math belongs with
// real dates in M3.
export const GEO_INFEASIBLE_KM = 150;

export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  // HH:mm strings compare correctly as strings
  return a.start < b.end && b.start < a.end;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Rule = (state: TripState) => Conflict[];

const timeOverlapRule: Rule = (state) => {
  const conflicts: Conflict[] = [];
  for (const day of state.days) {
    const timed: { id: string; title: string; window: TimeWindow }[] = [];
    for (const id of day.activityIds) {
      const activity = state.activities[id];
      if (activity && activity.timeWindow !== null) {
        timed.push({ id, title: activity.title, window: activity.timeWindow });
      }
    }
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const a = timed[i]!;
        const b = timed[j]!;
        if (!windowsOverlap(a.window, b.window)) continue;
        const s1 = a.id < b.id ? a.id : b.id;
        const s2 = a.id < b.id ? b.id : a.id;
        conflicts.push({
          id: `time-overlap:${day.dayId}:${s1}:${s2}`,
          kind: "time-overlap",
          severity: "warn",
          subjects: [s1, s2],
          description: `"${a.title}" and "${b.title}" overlap in time on the same day.`,
          resolutions: [
            "Change one activity's time window",
            "Move one activity to another day or the backlog",
          ],
        });
      }
    }
  }
  return conflicts;
};

const geographyRule: Rule = (state) => {
  const conflicts: Conflict[] = [];
  for (const day of state.days) {
    const located: { id: string; title: string; place: string; lat: number; lng: number }[] = [];
    for (const id of day.activityIds) {
      const activity = state.activities[id];
      if (
        activity?.location &&
        activity.location.lat !== undefined &&
        activity.location.lng !== undefined
      ) {
        located.push({
          id,
          title: activity.title,
          place: activity.location.name,
          lat: activity.location.lat,
          lng: activity.location.lng,
        });
      }
    }
    for (let i = 0; i < located.length; i++) {
      for (let j = i + 1; j < located.length; j++) {
        const a = located[i]!;
        const b = located[j]!;
        const km = haversineKm(a, b);
        if (km <= GEO_INFEASIBLE_KM) continue;
        const s1 = a.id < b.id ? a.id : b.id;
        const s2 = a.id < b.id ? b.id : a.id;
        conflicts.push({
          id: `impossible-geography:${day.dayId}:${s1}:${s2}`,
          kind: "impossible-geography",
          severity: "warn",
          subjects: [s1, s2],
          description: `"${a.title}" (${a.place}) and "${b.title}" (${b.place}) are ~${Math.round(km)} km apart on the same day.`,
          resolutions: ["Move one activity to another day", "Fix a mistyped coordinate"],
        });
      }
    }
  }
  return conflicts;
};

// Rules are registered here; each is pure and individually testable
// (docs/guidelines/building-the-parts.md). Sorted output keeps the
// projection deterministic for the golden rebuild test.
const rules: Rule[] = [timeOverlapRule, geographyRule];

export function detectConflicts(state: TripState): Conflict[] {
  return rules.flatMap((rule) => rule(state)).sort((a, b) => a.id.localeCompare(b.id));
}
```

Append to `packages/domain/src/index.ts`:
```ts
export * from "./trip/conflicts";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @tc/domain test && pnpm --filter @tc/domain typecheck`
Expected: 32 passing (22 prior + 10 new); typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(domain): conflict engine with overlap and geography rules"
```

---

### Task 5: Domain — trip-detail projection

**Files:**
- Create: `packages/domain/src/trip/detail.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/detail.test.ts`

**Interfaces:**
- Consumes: `EventEnvelope`, `TripEvent`, `TripDetail` from `@tc/contracts`; `evolveTrip`, `detectConflicts`, `TripState` from earlier tasks.
- Produces:
  `tripDetailFromState(state: TripState, createdAt: string): TripDetail` — the single state→document definition (runs `detectConflicts` inside), used by BOTH the live pipeline and rebuild so the golden test holds by construction;
  `projectTripDetails(envelopes: EventEnvelope[]): TripDetail[]`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/detail.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@tc/contracts";
import { projectTripDetails } from "../src";

const T1 = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const A1 = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";
const A2 = "8a9c4e10-5b9c-4d80-9f5b-4d3c7e0f9a82";

function stream(): EventEnvelope[] {
  let seq = 0;
  const env = (type: string, payload: unknown): EventEnvelope => ({
    streamId: T1,
    seq: ++seq,
    type,
    version: 1,
    payload,
    actorId: "user-1",
    occurredAt: "2026-07-08T12:00:00.000Z",
  });
  return [
    env("TripCreated", { tripId: T1, name: "Rome 2027", createdBy: "user-1" }),
    env("DayAdded", { tripId: T1, dayId: DAY }),
    env("ActivityAdded", {
      tripId: T1, activityId: A1, dayId: DAY, title: "Colosseum",
      timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null,
    }),
    env("ActivityAdded", {
      tripId: T1, activityId: A2, dayId: DAY, title: "Vatican Museums",
      timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null,
    }),
  ];
}

describe("projectTripDetails", () => {
  it("folds a stream into a board document with conflicts computed", () => {
    const details = projectTripDetails(stream());
    expect(details).toHaveLength(1);
    const detail = details[0]!;
    expect(detail).toMatchObject({
      tripId: T1,
      name: "Rome 2027",
      startDate: null,
      backlog: [],
      createdAt: "2026-07-08T12:00:00.000Z",
    });
    expect(detail.days).toEqual([{ dayId: DAY, activityIds: [A1, A2] }]);
    expect(detail.activities[A1]).toMatchObject({ activityId: A1, title: "Colosseum" });
    expect(detail.conflicts).toHaveLength(1);
    expect(detail.conflicts[0]).toMatchObject({ kind: "time-overlap" });
  });

  it("is deterministic across calls", () => {
    expect(projectTripDetails(stream())).toEqual(projectTripDetails(stream()));
  });

  it("throws on an unparseable event (replay totality guard)", () => {
    const bad = stream();
    bad[1] = { ...bad[1]!, payload: { nope: true } };
    expect(() => projectTripDetails(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test`
Expected: FAIL — `projectTripDetails` not exported.

- [ ] **Step 3: Implement**

`packages/domain/src/trip/detail.ts`:
```ts
import { TripEvent, type EventEnvelope, type TripDetail } from "@tc/contracts";
import { detectConflicts } from "./conflicts";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

// The single state → document definition. The live pipeline and the rebuild
// both call this, so "rebuild equals stored" holds by construction.
export function tripDetailFromState(state: TripState, createdAt: string): TripDetail {
  return {
    tripId: state.tripId,
    name: state.name,
    startDate: state.startDate,
    members: state.members,
    days: state.days.map((d) => ({ dayId: d.dayId, activityIds: [...d.activityIds] })),
    backlog: [...state.backlog],
    activities: Object.fromEntries(
      Object.entries(state.activities).map(([id, a]) => [
        id,
        {
          activityId: id,
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
        },
      ]),
    ),
    conflicts: detectConflicts(state),
    createdAt,
  };
}

export function projectTripDetails(envelopes: EventEnvelope[]): TripDetail[] {
  const streams = new Map<string, { state: TripState | null; createdAt: string }>();
  for (const env of envelopes) {
    const event = TripEvent.parse({ type: env.type, version: env.version, payload: env.payload });
    const entry = streams.get(env.streamId) ?? { state: null, createdAt: env.occurredAt };
    entry.state = evolveTrip(entry.state, event);
    streams.set(env.streamId, entry);
  }
  const details: TripDetail[] = [];
  for (const { state, createdAt } of streams.values()) {
    if (state !== null) details.push(tripDetailFromState(state, createdAt));
  }
  return details;
}
```

Append to `packages/domain/src/index.ts`:
```ts
export * from "./trip/detail";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tc/domain test && pnpm -r typecheck`
Expected: 35 passing (32 prior + 3 new); workspace typecheck green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): trip-detail projection with embedded conflicts"
```

---

### Task 6: Server — trip_details table and migration

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`
- Generated: `apps/web/drizzle/0001_*.sql` (commit it)

**Interfaces:**
- Produces: `tripDetails` table (`trip_id uuid PK, doc jsonb` typed as `TripDetail`), imported by `projections.ts` in Task 7.

- [ ] **Step 1: Extend the schema**

Append to `apps/web/src/server/db/schema.ts` (and add `TripDetail` to the existing `@tc/contracts` type import):
```ts
export const tripDetails = pgTable("trip_details", {
  tripId: uuid("trip_id").primaryKey(),
  doc: jsonb("doc").$type<TripDetail>().notNull(),
});
```
The import line at the top becomes:
```ts
import type { TripDetail, TripMember } from "@tc/contracts";
```

- [ ] **Step 2: Generate and apply the migration**

Run: `docker compose up -d && pnpm --filter web db:generate && pnpm --filter web db:migrate`
Expected: a new SQL file `apps/web/drizzle/0001_*.sql` appears; migrate reports success.

- [ ] **Step 3: Verify the table exists**

Run: `docker compose exec postgres psql -U postgres -d travel -c "\dt"`
Expected: `events`, `trip_summaries`, AND `trip_details` listed.

- [ ] **Step 4: Commit** (include the generated `drizzle/` files)

```bash
git add -A && git commit -m "feat(web): trip_details projection table and migration"
```

---

### Task 7: Server — generalized command pipeline with conflict persistence

**Files:**
- Modify: `apps/web/src/server/commands.ts` (full rewrite), `apps/web/src/server/projections.ts` (full rewrite), `apps/web/src/app/api/trips/route.ts` (swap the import), `apps/web/src/server/commands.int.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `decideTripCommand`, `evolveTrip`, `tripDetailFromState`, `projectTripDetails`, `projectTripSummaries` from `@tc/domain`; `appendToStream`, `readStream`, `readAll` from M0; `TripCommand`, `TripEvent`, `TripDetail` from `@tc/contracts`.
- Produces (used by Task 8 routes):
  `executeTripCommand(input: unknown, actorId: string): Promise<CommandResult>` where `CommandResult = {ok:true; tripId} | {ok:false; error:{code;message}}` — REPLACES `handleCreateTrip`;
  `upsertTripDetail(tx, detail: TripDetail)` and `getTripDetail(tripId): Promise<TripDetail | null>`;
  `rebuildProjections(): Promise<void>` — REPLACES `rebuildTripSummaries`, rebuilds both tables in one transaction;
  `listTripSummaries()` unchanged.

- [ ] **Step 1: Write the failing integration tests**

`apps/web/src/server/commands.int.test.ts` (full new content):
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { events, tripDetails, tripSummaries } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail, rebuildProjections } from "./projections";

const exec = (command: object, actorId = "user-1") => executeTripCommand(command, actorId);

async function seedBoard() {
  const tripId = randomUUID();
  const dayA = randomUUID();
  const dayB = randomUUID();
  const colosseum = randomUUID();
  const vatican = randomUUID();
  await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
  await exec({ type: "AddDay", tripId, dayId: dayA });
  await exec({ type: "AddDay", tripId, dayId: dayB });
  await exec({
    type: "AddActivity",
    tripId,
    activityId: colosseum,
    title: "Colosseum",
    timeWindow: { start: "09:00", end: "11:00" },
    location: { name: "Rome", lat: 41.8902, lng: 12.4922 },
  });
  await exec({
    type: "AddActivity",
    tripId,
    activityId: vatican,
    title: "Vatican Museums",
    timeWindow: { start: "10:00", end: "12:00" },
  });
  return { tripId, dayA, dayB, colosseum, vatican };
}

describe("executeTripCommand", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("appends TripCreated with the actor and updates both projections", async () => {
    const tripId = randomUUID();
    const result = await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
    expect(result).toEqual({ ok: true, tripId });

    const eventRows = await db.select().from(events);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.actorId).toBe("user-1");

    expect(await db.select().from(tripSummaries)).toHaveLength(1);
    const detail = await getTripDetail(tripId);
    expect(detail).toMatchObject({ tripId, name: "Rome 2027", days: [], backlog: [], conflicts: [] });
  });

  it("rejects a duplicate tripId with a typed error", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
    const second = await exec({ type: "CreateTrip", tripId, name: "Rome again" });
    expect(second).toEqual({
      ok: false,
      error: { code: "trip-already-exists", message: "A trip with this id already exists." },
    });
  });

  it("rejects invalid input via the contract schema", async () => {
    const result = await exec({ type: "CreateTrip", tripId: "not-a-uuid", name: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-member via the AccessPolicy seam", async () => {
    const { tripId } = await seedBoard();
    const result = await exec({ type: "AddDay", tripId, dayId: randomUUID() }, "user-2");
    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "Not a member of this trip." },
    });
  });

  it("runs the board flow; conflicts are data and never block the write", async () => {
    const { tripId, dayA, dayB, colosseum, vatican } = await seedBoard();

    await exec({ type: "MoveActivity", tripId, activityId: colosseum, toDayId: dayA, position: 0 });
    const overlapping = await exec({ type: "MoveActivity", tripId, activityId: vatican, toDayId: dayA, position: 1 });
    expect(overlapping.ok).toBe(true); // the write succeeded despite creating a conflict

    let detail = await getTripDetail(tripId);
    expect(detail?.days).toEqual([
      { dayId: dayA, activityIds: [colosseum, vatican] },
      { dayId: dayB, activityIds: [] },
    ]);
    expect(detail?.conflicts).toHaveLength(1);
    expect(detail?.conflicts[0]).toMatchObject({
      kind: "time-overlap",
      severity: "warn",
      subjects: [colosseum, vatican].sort(),
    });

    // resolving by moving away clears the conflict
    await exec({ type: "MoveActivity", tripId, activityId: vatican, toDayId: dayB, position: 0 });
    detail = await getTripDetail(tripId);
    expect(detail?.conflicts).toEqual([]);
  });

  it("flags impossible geography for far-apart same-day activities", async () => {
    const { tripId, dayA, colosseum } = await seedBoard();
    const met = randomUUID();
    await exec({
      type: "AddActivity",
      tripId,
      activityId: met,
      title: "The Met",
      dayId: dayA,
      location: { name: "New York", lat: 40.7794, lng: -73.9632 },
    });
    await exec({ type: "MoveActivity", tripId, activityId: colosseum, toDayId: dayA, position: 0 });
    const detail = await getTripDetail(tripId);
    expect(detail?.conflicts.some((c) => c.kind === "impossible-geography")).toBe(true);
  });

  it("supports the display-only start date", async () => {
    const { tripId } = await seedBoard();
    await exec({ type: "SetTripStartDate", tripId, startDate: "2027-05-01" });
    expect((await getTripDetail(tripId))?.startDate).toBe("2027-05-01");
    await exec({ type: "SetTripStartDate", tripId, startDate: null });
    expect((await getTripDetail(tripId))?.startDate).toBeNull();
  });

  it("GOLDEN: rebuild from the log equals the live projections", async () => {
    await seedBoard();
    const second = await seedBoard();
    await exec({
      type: "MoveActivity",
      tripId: second.tripId,
      activityId: second.vatican,
      toDayId: second.dayA,
      position: 0,
    });

    const liveSummaries = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));
    const liveDetails = await db.select().from(tripDetails).orderBy(asc(tripDetails.tripId));

    await rebuildProjections();

    const rebuiltSummaries = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));
    const rebuiltDetails = await db.select().from(tripDetails).orderBy(asc(tripDetails.tripId));

    const normalize = (rows: typeof liveSummaries) =>
      rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
    expect(normalize(rebuiltSummaries)).toEqual(normalize(liveSummaries));
    expect(rebuiltDetails).toEqual(liveDetails);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose up -d && pnpm --filter web test:int`
Expected: FAIL — `executeTripCommand` / `rebuildProjections` do not exist.

- [ ] **Step 3: Implement**

`apps/web/src/server/projections.ts` (full new content):
```ts
import { TripEvent, type EventEnvelope, type TripDetail } from "@tc/contracts";
import { projectTripDetails, projectTripSummaries } from "@tc/domain";
import { eq } from "drizzle-orm";
import { db, type Db } from "./db/client";
import { tripDetails, tripSummaries } from "./db/schema";
import { readAll } from "./eventStore";

type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// The ONLY code allowed to write trip_summaries (AGENTS.md invariant 1).
export async function applyTripEvents(
  tx: Queryable,
  envelopes: EventEnvelope[],
): Promise<void> {
  for (const env of envelopes) {
    const event = TripEvent.parse({
      type: env.type,
      version: env.version,
      payload: env.payload,
    });
    switch (event.type) {
      case "TripCreated":
        await tx.insert(tripSummaries).values({
          tripId: event.payload.tripId,
          name: event.payload.name,
          members: [{ userId: event.payload.createdBy, role: "owner" }],
          createdAt: env.occurredAt,
        });
        break;
      // M1 events don't touch the summaries read model.
    }
  }
}

// The ONLY code allowed to write trip_details (AGENTS.md invariant 1).
export async function upsertTripDetail(tx: Queryable, detail: TripDetail): Promise<void> {
  await tx
    .insert(tripDetails)
    .values({ tripId: detail.tripId, doc: detail })
    .onConflictDoUpdate({ target: tripDetails.tripId, set: { doc: detail } });
}

export async function getTripDetail(tripId: string): Promise<TripDetail | null> {
  const rows = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
  return rows[0]?.doc ?? null;
}

export async function rebuildProjections(): Promise<void> {
  await db.transaction(async (tx) => {
    const envelopes = await readAll(tx);
    const summaries = projectTripSummaries(envelopes);
    await tx.delete(tripSummaries);
    for (const s of summaries) {
      await tx.insert(tripSummaries).values(s);
    }
    const details = projectTripDetails(envelopes);
    await tx.delete(tripDetails);
    for (const d of details) {
      await tx.insert(tripDetails).values({ tripId: d.tripId, doc: d });
    }
  });
}

export async function listTripSummaries() {
  return db.select().from(tripSummaries);
}
```

`apps/web/src/server/commands.ts` (full new content):
```ts
import { TripCommand, TripEvent } from "@tc/contracts";
import { decideTripCommand, evolveTrip, tripDetailFromState, type TripState } from "@tc/domain";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";
import { applyTripEvents, upsertTripDetail } from "./projections";
import { soleMemberPolicy } from "./accessPolicy";

export type CommandResult =
  | { ok: true; tripId: string }
  | { ok: false; error: { code: string; message: string } };

// The command pipeline (docs/guidelines/building-the-parts.md). Every write
// in the planning domain goes through this exact sequence.
export async function executeTripCommand(input: unknown, actorId: string): Promise<CommandResult> {
  // 1. validate the command against the contract
  const parsed = TripCommand.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  const command = parsed.data;

  return db.transaction(async (tx): Promise<CommandResult> => {
    // 2. load the stream and fold to current state
    const history = await readStream(tx, command.tripId);
    let state: TripState | null = null;
    for (const env of history) {
      const event = TripEvent.parse({ type: env.type, version: env.version, payload: env.payload });
      state = evolveTrip(state, event);
    }

    // 3. authorize via the AccessPolicy seam
    if (!soleMemberPolicy.canExecute(actorId, command.type, state?.members ?? null)) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    // 4. decide
    const decision = decideTripCommand(state, command, { actorId });
    if (!decision.ok) return { ok: false, error: decision.rejection };

    // 5. append with optimistic concurrency
    const appended = await appendToStream(tx, {
      streamId: command.tripId,
      expectedSeq: history.length,
      events: decision.events,
      actorId,
      occurredAt: new Date().toISOString(),
    });
    if (!appended.ok) {
      return {
        ok: false,
        error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
      };
    }

    // 6. update projections in the same transaction
    await applyTripEvents(tx, appended.envelopes);

    // 7. run the conflict engine on the new state and persist the detail doc
    //    (tripDetailFromState computes conflicts) — same transaction.
    let nextState = state;
    for (const event of decision.events) nextState = evolveTrip(nextState, event);
    if (nextState === null) throw new Error("state cannot be null after an accepted command");
    const firstEnvelope = history[0] ?? appended.envelopes[0];
    if (firstEnvelope === undefined) throw new Error("append returned no envelopes");
    await upsertTripDetail(tx, tripDetailFromState(nextState, firstEnvelope.occurredAt));

    return { ok: true, tripId: command.tripId };
  });
}
```

`apps/web/src/app/api/trips/route.ts` — replace the `handleCreateTrip` import and call:
```ts
import { executeTripCommand } from "@/server/commands";
// ... in POST, replace the handleCreateTrip(...) call with:
  const result = await executeTripCommand(
    { type: "CreateTrip", tripId: randomUUID(), name: body.data.name },
    session.user.id,
  );
```
Everything else in the file stays exactly as it is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test:int && pnpm -r typecheck && pnpm lint`
Expected: 10 int tests passing (2 event store + 8 pipeline); typecheck and lint (incl. lint wall) green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): generalized command pipeline with conflict persistence"
```

---

### Task 8: Server — trip detail and command API routes

**Files:**
- Create: `apps/web/src/app/api/trips/[tripId]/route.ts`, `apps/web/src/app/api/trips/[tripId]/commands/route.ts`

**Interfaces:**
- Consumes: `auth` (M0), `executeTripCommand`, `getTripDetail` (Task 7), `TripCommand`, `TripDetail` from `@tc/contracts`.
- Produces: `GET /api/trips/[tripId]` → `401` / `404` / `403` / `200 {trip: TripDetail}`; `POST /api/trips/[tripId]/commands` body = any `TripCommand` except `CreateTrip` → `401` / `400` / `403` / `404` / `409` / `200 {ok:true, tripId}`. (Note: Next 15 passes `params` as a Promise.)

- [ ] **Step 1: Implement the detail route**

`apps/web/src/app/api/trips/[tripId]/route.ts`:
```ts
import { TripDetail } from "@tc/contracts";
import { auth } from "@/server/auth";
import { getTripDetail } from "@/server/projections";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const detail = await getTripDetail(tripId);
  if (detail === null) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const userId = session.user.id;
  if (!detail.members.some((m) => m.userId === userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  // Contract-honest response: validate against the schema before returning.
  return Response.json({ trip: TripDetail.parse(detail) });
}
```

- [ ] **Step 2: Implement the commands route**

`apps/web/src/app/api/trips/[tripId]/commands/route.ts`:
```ts
import { TripCommand } from "@tc/contracts";
import { auth } from "@/server/auth";
import { executeTripCommand } from "@/server/commands";

const STATUS: Record<string, number> = {
  "invalid-command": 400,
  forbidden: 403,
  "trip-not-found": 404,
  "concurrency-conflict": 409,
};

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const body = TripCommand.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "malformed command" }, { status: 400 });
  }
  if (body.data.type === "CreateTrip") {
    return Response.json({ error: "use POST /api/trips to create trips" }, { status: 400 });
  }
  if (body.data.tripId !== tripId) {
    return Response.json({ error: "command tripId does not match the URL" }, { status: 400 });
  }
  const result = await executeTripCommand(body.data, session.user.id);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ ok: true, tripId: result.tripId });
}
```

- [ ] **Step 3: Verify build, lint wall, typecheck**

Run: `pnpm -r typecheck && pnpm lint && pnpm --filter web exec next build`
Expected: all green (routes live in `src/app/api/**`, the lint wall's exempt shell). The e2e in Task 12 exercises these routes end-to-end.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): trip detail and command api routes"
```

---

### Task 9: Web — typed API client, MSW mocks, UI test harness

**Files:**
- Create: `apps/web/src/lib/apiClient.ts`, `apps/web/src/mocks/fixtures.ts`, `apps/web/src/mocks/handlers.ts`, `apps/web/vitest.unit.config.ts`
- Modify: `apps/web/package.json` (deps + `test` script)
- Test: `apps/web/src/lib/apiClient.test.ts`

**Interfaces:**
- Consumes: `TripCommand`, `TripDetail` from `@tc/contracts` ONLY (this is UI-side code — the lint wall applies).
- Produces (used by Tasks 10–11):
  `fetchTripDetail(tripId): Promise<ApiResult<TripDetail>>` and `sendTripCommand(command: Exclude<TripCommand, {type:"CreateTrip"}>): Promise<ApiResult<null>>` where `ApiResult<T> = {ok:true; value:T} | {ok:false; error:{status:number; message:string; code?:string}}`;
  `tripDetailFixture(overrides?): TripDetail`;
  `makeTripHandlers(initial: TripDetail)` — MSW handlers backed by a naive in-memory doc (deliberately NOT the domain — UI may not import `@tc/domain`);
  `pnpm --filter web test` runs jsdom component tests (picked up by root `pnpm test` and CI automatically).

- [ ] **Step 1: Add dependencies and the test script**

Run: `pnpm --filter web add -D msw @testing-library/react @testing-library/dom jsdom @vitejs/plugin-react`

Add to `apps/web/package.json` scripts:
```json
"test": "vitest run -c vitest.unit.config.ts",
```

`apps/web/vitest.unit.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { BASE_URL } from "./src/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: BASE_URL } },
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
  },
});
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/lib/apiClient.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { fetchTripDetail, sendTripCommand } from "@/lib/apiClient";
import { tripDetailFixture } from "@/mocks/fixtures";
import { makeTripHandlers } from "@/mocks/handlers";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("apiClient", () => {
  it("fetches and schema-validates a trip detail", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const result = await fetchTripDetail(fixture.tripId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.name).toBe("Rome 2027");
  });

  it("sends a command and the mock applies it", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const sent = await sendTripCommand({
      type: "AddDay",
      tripId: fixture.tripId,
      dayId: "44444444-4444-4444-8444-444444444444",
    });
    expect(sent.ok).toBe(true);
    const detail = await fetchTripDetail(fixture.tripId);
    if (!detail.ok) throw new Error("expected ok");
    expect(detail.value.days).toHaveLength(1);
  });

  it("surfaces HTTP errors as typed results", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const result = await fetchTripDetail("00000000-0000-4000-8000-000000000000");
    if (result.ok) throw new Error("expected error");
    expect(result.error.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter web test`
Expected: FAIL — `@/lib/apiClient` does not exist.

- [ ] **Step 4: Implement**

`apps/web/src/lib/apiClient.ts`:
```ts
import { TripDetail, type TripCommand } from "@tc/contracts";
import { BASE_URL } from "@/config";

export type ApiError = { status: number; message: string; code?: string };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export type BoardCommand = Exclude<TripCommand, { type: "CreateTrip" }>;

// Browsers resolve relative URLs against the page; Node's fetch (jsdom tests)
// rejects them. Resolve explicitly against the window origin, falling back to
// the dev config (Task 0) when no DOM is present.
function apiUrl(path: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin !== "null"
      ? window.location.origin
      : BASE_URL;
  return new URL(path, origin).toString();
}

export async function fetchTripDetail(tripId: string): Promise<ApiResult<TripDetail>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { trip: unknown };
  return { ok: true, value: TripDetail.parse(data.trip) };
}

export async function sendTripCommand(command: BoardCommand): Promise<ApiResult<null>> {
  const res = await fetch(apiUrl(`/api/trips/${command.tripId}/commands`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return {
      ok: false,
      error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
    };
  }
  return { ok: true, value: null };
}
```

`apps/web/src/mocks/fixtures.ts`:
```ts
import type { TripDetail } from "@tc/contracts";

export function tripDetailFixture(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    name: "Rome 2027",
    startDate: null,
    members: [{ userId: "dev-alice", role: "owner" }],
    days: [],
    backlog: [],
    activities: {},
    conflicts: [],
    createdAt: "2026-07-08T12:00:00.000Z",
    ...overrides,
  };
}
```

`apps/web/src/mocks/handlers.ts`:
```ts
import { HttpResponse, http } from "msw";
import { TripCommand, type TripDetail } from "@tc/contracts";

// Deliberately naive state transitions — just enough for UI development and
// component tests. The real semantics live in @tc/domain, which UI-side code
// (including these mocks) may not import (lint wall).
function applyMock(detail: TripDetail, command: TripCommand): TripDetail {
  const next = structuredClone(detail);
  switch (command.type) {
    case "AddDay":
      next.days.push({ dayId: command.dayId, activityIds: [] });
      break;
    case "RemoveDay": {
      const day = next.days.find((d) => d.dayId === command.dayId);
      next.backlog.push(...(day?.activityIds ?? []));
      next.days = next.days.filter((d) => d.dayId !== command.dayId);
      break;
    }
    case "SetTripStartDate":
      next.startDate = command.startDate;
      break;
    case "AddActivity":
      next.activities[command.activityId] = {
        activityId: command.activityId,
        title: command.title,
        timeWindow: command.timeWindow ?? null,
        location: command.location ?? null,
        notes: command.notes ?? null,
      };
      if (command.dayId !== undefined) {
        next.days.find((d) => d.dayId === command.dayId)?.activityIds.push(command.activityId);
      } else {
        next.backlog.push(command.activityId);
      }
      break;
    case "MoveActivity": {
      next.backlog = next.backlog.filter((id) => id !== command.activityId);
      for (const d of next.days) d.activityIds = d.activityIds.filter((id) => id !== command.activityId);
      const list =
        command.toDayId === null
          ? next.backlog
          : next.days.find((d) => d.dayId === command.toDayId)?.activityIds;
      list?.splice(Math.min(command.position, list.length), 0, command.activityId);
      break;
    }
    case "UpdateActivity": {
      const activity = next.activities[command.activityId];
      if (activity !== undefined) {
        if (command.title !== undefined) activity.title = command.title;
        if (command.timeWindow !== undefined) activity.timeWindow = command.timeWindow;
        if (command.location !== undefined) activity.location = command.location;
        if (command.notes !== undefined) activity.notes = command.notes;
      }
      break;
    }
    case "RemoveActivity":
      next.backlog = next.backlog.filter((id) => id !== command.activityId);
      for (const d of next.days) d.activityIds = d.activityIds.filter((id) => id !== command.activityId);
      delete next.activities[command.activityId];
      break;
    case "CreateTrip":
      break;
  }
  return next;
}

export function makeTripHandlers(initial: TripDetail) {
  let detail = structuredClone(initial);
  return [
    http.get("/api/trips/:tripId", ({ params }) =>
      params.tripId === detail.tripId
        ? HttpResponse.json({ trip: detail })
        : HttpResponse.json({ error: "not-found" }, { status: 404 }),
    ),
    http.post("/api/trips/:tripId/commands", async ({ request }) => {
      const command = TripCommand.parse(await request.json());
      detail = applyMock(detail, command);
      return HttpResponse.json({ ok: true, tripId: detail.tripId });
    }),
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test && pnpm -r typecheck && pnpm lint`
Expected: 3 unit tests passing; typecheck green; lint wall still green (nothing here imports `@tc/domain`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): typed api client and ui test harness with msw"
```

---

### Task 10: Web — board components with drag and conflict display

**Files:**
- Create: `apps/web/src/lib/dates.ts`, `apps/web/src/components/board/ActivityCard.tsx`, `apps/web/src/components/board/ActivityEditor.tsx`, `apps/web/src/components/board/Column.tsx`, `apps/web/src/components/board/ConflictBanner.tsx`, `apps/web/src/components/board/Board.tsx`
- Modify: `apps/web/package.json` (runtime deps)
- Test: `apps/web/src/lib/dates.test.ts`, `apps/web/src/components/board/board.test.tsx`

**Interfaces:**
- Consumes: `ActivityView`, `Conflict`, `TripDetail`, `TimeWindow`, `Location` from `@tc/contracts`; `tripDetailFixture` from Task 9.
- Produces (used by Task 11):
  `dayLabel(startDate: string | null, index: number): string` ("Day 1" / "Day 3 — May 3");
  `Board({ trip: TripDetail, callbacks: BoardCallbacks })` where `BoardCallbacks = { onMove(activityId, toDayId: string | null, position: number); onAddDay(); onRemoveDay(dayId); onAddActivity(value: ActivityFormValue); onUpdateActivity(activityId, value: ActivityFormValue); onRemoveActivity(activityId) }`;
  `ActivityFormValue = { title: string; timeWindow: TimeWindow | null; location: Location | null; notes: string | null }` (from `ActivityEditor.tsx`).

- [ ] **Step 1: Add the drag-and-drop dependency**

Run: `pnpm --filter web add @atlaskit/pragmatic-drag-and-drop @atlaskit/pragmatic-drag-and-drop-hitbox`

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/dates.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dayLabel } from "@/lib/dates";

describe("dayLabel", () => {
  it("is ordinal-only without a start date", () => {
    expect(dayLabel(null, 0)).toBe("Day 1");
    expect(dayLabel(null, 4)).toBe("Day 5");
  });

  it("derives display dates from the start date", () => {
    expect(dayLabel("2027-05-01", 0)).toBe("Day 1 — May 1");
    expect(dayLabel("2027-05-01", 2)).toBe("Day 3 — May 3");
  });

  it("crosses month boundaries correctly", () => {
    expect(dayLabel("2027-05-30", 3)).toBe("Day 4 — Jun 2");
  });
});
```

`apps/web/src/components/board/board.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Board, type BoardCallbacks } from "@/components/board/Board";
import { tripDetailFixture } from "@/mocks/fixtures";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const DAY = "33333333-3333-4333-8333-333333333333";

function fixture() {
  return tripDetailFixture({
    days: [{ dayId: DAY, activityIds: [A1, A2] }],
    activities: {
      [A1]: { activityId: A1, title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null },
      [A2]: { activityId: A2, title: "Vatican Museums", timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null },
    },
    conflicts: [
      {
        id: `time-overlap:${DAY}:${A1}:${A2}`,
        kind: "time-overlap",
        severity: "warn",
        subjects: [A1, A2],
        description: '"Colosseum" and "Vatican Museums" overlap in time on the same day.',
        resolutions: ["Change one activity's time window", "Move one activity to another day or the backlog"],
      },
    ],
  });
}

function noopCallbacks(): BoardCallbacks {
  return {
    onMove: vi.fn(),
    onAddDay: vi.fn(),
    onRemoveDay: vi.fn(),
    onAddActivity: vi.fn(),
    onUpdateActivity: vi.fn(),
    onRemoveActivity: vi.fn(),
  };
}

afterEach(cleanup);

describe("Board", () => {
  it("renders backlog and day columns with activity cards", () => {
    render(<Board trip={fixture()} callbacks={noopCallbacks()} />);
    expect(screen.getByTestId("backlog-column")).toBeTruthy();
    expect(screen.getAllByTestId("day-column")).toHaveLength(1);
    expect(screen.getByText("Colosseum")).toBeTruthy();
    expect(screen.getByText("Vatican Museums")).toBeTruthy();
  });

  it("marks conflict subjects with badges and shows the banner", () => {
    render(<Board trip={fixture()} callbacks={noopCallbacks()} />);
    expect(screen.getAllByRole("img", { name: "conflict" })).toHaveLength(2);
    expect(screen.getByText(/overlap in time on the same day/)).toBeTruthy();
  });

  it("dismissing a conflict hides it from the banner (client-local)", () => {
    render(<Board trip={fixture()} callbacks={noopCallbacks()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss:/ }));
    expect(screen.queryByText(/overlap in time on the same day/)).toBeNull();
  });

  it("add-day and remove-day buttons invoke callbacks", () => {
    const callbacks = noopCallbacks();
    render(<Board trip={fixture()} callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add day" }));
    expect(callbacks.onAddDay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Remove Day 1" }));
    expect(callbacks.onRemoveDay).toHaveBeenCalledWith(DAY);
  });

  it("adding an activity goes through the editor form", () => {
    const callbacks = noopCallbacks();
    render(<Board trip={fixture()} callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add activity" }));
    fireEvent.change(screen.getByLabelText("Activity title"), { target: { value: "Pantheon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(callbacks.onAddActivity).toHaveBeenCalledWith({
      title: "Pantheon",
      timeWindow: null,
      location: null,
      notes: null,
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter web test`
Expected: FAIL — `@/lib/dates` and `@/components/board/Board` do not exist.

- [ ] **Step 4: Implement**

`apps/web/src/lib/dates.ts`:
```ts
// Display-only labels (M1 decision): the domain never reads dates.
export function dayLabel(startDate: string | null, index: number): string {
  const base = `Day ${index + 1}`;
  if (startDate === null) return base;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + index);
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${base} — ${formatted}`;
}
```

`apps/web/src/components/board/ActivityCard.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { ActivityView } from "@tc/contracts";

export function ActivityCard({
  activity,
  dayId,
  hasConflict,
  onEdit,
  onRemove,
}: {
  activity: ActivityView;
  dayId: string | null;
  hasConflict: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ activityId: activity.activityId }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: el,
        getData: ({ input, element }) =>
          attachClosestEdge(
            { cardActivityId: activity.activityId, dayId },
            { input, element, allowedEdges: ["top", "bottom"] },
          ),
      }),
    );
  }, [activity.activityId, dayId]);

  return (
    <li
      ref={ref}
      data-testid={`activity-card-${activity.activityId}`}
      style={{
        background: "white",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
        opacity: dragging ? 0.5 : 1,
        cursor: "grab",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>
          <span>{activity.title}</span>
          {hasConflict && (
            <span role="img" aria-label="conflict" title="This activity has conflicts">
              {" "}
              ⚠️
            </span>
          )}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>
          <button onClick={onEdit} aria-label={`Edit ${activity.title}`}>
            ✎
          </button>{" "}
          <button onClick={onRemove} aria-label={`Remove ${activity.title}`}>
            ✕
          </button>
        </span>
      </div>
      {activity.timeWindow && (
        <small>
          {activity.timeWindow.start}–{activity.timeWindow.end}
        </small>
      )}
      {activity.location && <small> · {activity.location.name}</small>}
    </li>
  );
}
```

`apps/web/src/components/board/ActivityEditor.tsx`:
```tsx
"use client";

import { useState } from "react";
import type { ActivityView, Location, TimeWindow } from "@tc/contracts";

export type ActivityFormValue = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
};

export function ActivityEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ActivityView | null;
  onSave: (value: ActivityFormValue) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [start, setStart] = useState(initial?.timeWindow?.start ?? "");
  const [end, setEnd] = useState(initial?.timeWindow?.end ?? "");
  const [place, setPlace] = useState(initial?.location?.name ?? "");
  const [lat, setLat] = useState(initial?.location?.lat?.toString() ?? "");
  const [lng, setLng] = useState(initial?.location?.lng?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") return setError("Title is required");
    if ((start === "") !== (end === "")) return setError("Provide both start and end times");
    if (start !== "" && start >= end) return setError("End time must be after start time");
    if ((lat.trim() === "") !== (lng.trim() === "")) return setError("Provide both latitude and longitude");
    if (lat.trim() !== "" && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)))) {
      return setError("Coordinates must be numbers");
    }
    const trimmedPlace = place.trim();
    if (trimmedPlace === "" && lat.trim() !== "") return setError("Coordinates need a place name");
    onSave({
      title: trimmedTitle,
      timeWindow: start !== "" ? { start, end } : null,
      location:
        trimmedPlace !== ""
          ? { name: trimmedPlace, ...(lat.trim() !== "" ? { lat: Number(lat), lng: Number(lng) } : {}) }
          : null,
      notes: notes.trim() !== "" ? notes.trim() : null,
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 6, padding: 8, border: "1px solid #ccc", borderRadius: 6 }}>
      <input aria-label="Activity title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <input aria-label="Start time" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <input aria-label="End time" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <input aria-label="Place name" placeholder="Place (optional)" value={place} onChange={(e) => setPlace(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <input aria-label="Latitude" placeholder="Lat (optional)" value={lat} onChange={(e) => setLat(e.target.value)} />
        <input aria-label="Longitude" placeholder="Lng (optional)" value={lng} onChange={(e) => setLng(e.target.value)} />
      </div>
      <textarea aria-label="Notes" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error !== null && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
```

`apps/web/src/components/board/ConflictBanner.tsx`:
```tsx
"use client";

import { useState } from "react";
import type { Conflict } from "@tc/contracts";

// Conflicts are data, never blocking modals (AGENTS.md invariant 3).
// Dismissal is client-local in M1; a persistent dismissal command arrives
// with the history work in M2.
export function ConflictBanner({ conflicts }: { conflicts: Conflict[] }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const visible = conflicts.filter((c) => !dismissed.has(c.id));
  if (visible.length === 0) return null;
  return (
    <aside
      role="status"
      style={{ border: "1px solid #e0a800", background: "#fff8e1", borderRadius: 6, padding: 8, marginBottom: 12 }}
    >
      {visible.map((c) => (
        <p key={c.id} style={{ margin: "4px 0" }}>
          ⚠️ {c.description} <em>({c.resolutions.join(" · ")})</em>{" "}
          <button
            onClick={() => setDismissed(new Set([...dismissed, c.id]))}
            aria-label={`Dismiss: ${c.description}`}
          >
            Dismiss
          </button>
        </p>
      ))}
    </aside>
  );
}
```

`apps/web/src/components/board/Column.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { ActivityView } from "@tc/contracts";
import { ActivityCard } from "./ActivityCard";

export function Column({
  title,
  dayId,
  activityIds,
  activities,
  conflictIds,
  onEditActivity,
  onRemoveActivity,
  onRemoveDay,
  children,
}: {
  title: string;
  dayId: string | null; // null = backlog
  activityIds: string[];
  activities: Record<string, ActivityView>;
  conflictIds: ReadonlySet<string>;
  onEditActivity: (activityId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onRemoveDay?: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ dayId }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [dayId]);

  return (
    <section
      data-testid={dayId === null ? "backlog-column" : "day-column"}
      style={{ minWidth: 220, background: "#f6f6f6", borderRadius: 8, padding: 8 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{title}</strong>
        {onRemoveDay && (
          <button onClick={onRemoveDay} aria-label={`Remove ${title}`}>
            ✕
          </button>
        )}
      </header>
      <ul
        ref={ref}
        style={{
          listStyle: "none",
          margin: 0,
          minHeight: 48,
          padding: 4,
          background: isOver ? "#e8efff" : "transparent",
          borderRadius: 6,
        }}
      >
        {activityIds.map((id) => {
          const activity = activities[id];
          if (activity === undefined) return null;
          return (
            <ActivityCard
              key={id}
              activity={activity}
              dayId={dayId}
              hasConflict={conflictIds.has(id)}
              onEdit={() => onEditActivity(id)}
              onRemove={() => onRemoveActivity(id)}
            />
          );
        })}
      </ul>
      {children}
    </section>
  );
}
```

`apps/web/src/components/board/Board.tsx`:
```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { TripDetail } from "@tc/contracts";
import { dayLabel } from "@/lib/dates";
import { ActivityEditor, type ActivityFormValue } from "./ActivityEditor";
import { Column } from "./Column";
import { ConflictBanner } from "./ConflictBanner";

export type BoardCallbacks = {
  onMove: (activityId: string, toDayId: string | null, position: number) => void;
  onAddDay: () => void;
  onRemoveDay: (dayId: string) => void;
  onAddActivity: (value: ActivityFormValue) => void;
  onUpdateActivity: (activityId: string, value: ActivityFormValue) => void;
  onRemoveActivity: (activityId: string) => void;
};

function listFor(trip: TripDetail, dayId: string | null): string[] {
  return dayId === null
    ? trip.backlog
    : (trip.days.find((d) => d.dayId === dayId)?.activityIds ?? []);
}

function containerOf(trip: TripDetail, activityId: string): string | null {
  const day = trip.days.find((d) => d.activityIds.includes(activityId));
  return day ? day.dayId : null;
}

export function Board({ trip, callbacks }: { trip: TripDetail; callbacks: BoardCallbacks }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const conflictIds = useMemo(
    () => new Set(trip.conflicts.flatMap((c) => c.subjects)),
    [trip.conflicts],
  );

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const activityId = source.data.activityId;
        if (typeof activityId !== "string") return;
        const target = location.current.dropTargets[0]; // innermost target first
        if (!target) return;

        let toDayId: string | null;
        let position: number;
        if (typeof target.data.cardActivityId === "string") {
          // Dropped on a card: insert before/after it depending on the edge.
          toDayId = typeof target.data.dayId === "string" ? target.data.dayId : null;
          const list = listFor(trip, toDayId);
          const index = list.indexOf(target.data.cardActivityId);
          position = extractClosestEdge(target.data) === "bottom" ? index + 1 : index;
          // Moving down within the same list: account for the dragged card's removal.
          const from = containerOf(trip, activityId);
          const sourceIndex = list.indexOf(activityId);
          if (from === toDayId && sourceIndex !== -1 && sourceIndex < position) {
            position -= 1;
          }
        } else {
          // Dropped on a column: append.
          toDayId = typeof target.data.dayId === "string" ? target.data.dayId : null;
          position = listFor(trip, toDayId).filter((id) => id !== activityId).length;
        }
        callbacks.onMove(activityId, toDayId, position);
      },
    });
  }, [trip, callbacks]);

  const editingActivity = editing !== null ? (trip.activities[editing] ?? null) : null;

  return (
    <div>
      <ConflictBanner conflicts={trip.conflicts} />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto" }}>
        <Column
          title="Backlog"
          dayId={null}
          activityIds={trip.backlog}
          activities={trip.activities}
          conflictIds={conflictIds}
          onEditActivity={setEditing}
          onRemoveActivity={callbacks.onRemoveActivity}
        >
          {adding ? (
            <ActivityEditor
              initial={null}
              onSave={(value) => {
                callbacks.onAddActivity(value);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button onClick={() => setAdding(true)}>+ Add activity</button>
          )}
        </Column>
        {trip.days.map((day, index) => (
          <Column
            key={day.dayId}
            title={dayLabel(trip.startDate, index)}
            dayId={day.dayId}
            activityIds={day.activityIds}
            activities={trip.activities}
            conflictIds={conflictIds}
            onEditActivity={setEditing}
            onRemoveActivity={callbacks.onRemoveActivity}
            onRemoveDay={() => callbacks.onRemoveDay(day.dayId)}
          />
        ))}
        <button onClick={callbacks.onAddDay} style={{ minWidth: 120 }}>
          + Add day
        </button>
      </div>
      {editing !== null && editingActivity !== null && (
        <div style={{ marginTop: 12, maxWidth: 420 }}>
          <ActivityEditor
            initial={editingActivity}
            onSave={(value) => {
              callbacks.onUpdateActivity(editing, value);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test && pnpm -r typecheck && pnpm lint`
Expected: 11 unit tests passing (3 apiClient + 3 dates + 5 board); lint wall still green (board imports `@tc/contracts` only).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): day-column board components with drag and conflict display"
```

---

### Task 11: Web — trip board page wired to the command pipeline

**Files:**
- Create: `apps/web/src/components/board/TripBoardScreen.tsx`, `apps/web/src/app/trips/[tripId]/page.tsx`
- Modify: `apps/web/src/app/page.tsx` (link list items to boards), `apps/web/src/app/layout.tsx` (drop the 640px body max-width — the board needs room)
- Test: `apps/web/src/components/board/TripBoardScreen.test.tsx`

**Interfaces:**
- Consumes: `Board`, `ActivityFormValue` (Task 10), `fetchTripDetail`, `sendTripCommand`, `BoardCommand` (Task 9), `makeTripHandlers`/`tripDetailFixture` (tests).
- Produces: route `/trips/[tripId]` rendering the board; every user action dispatches a contract command and refetches.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/board/TripBoardScreen.test.tsx`:
```tsx
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { tripDetailFixture } from "@/mocks/fixtures";
import { makeTripHandlers } from "@/mocks/handlers";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

describe("TripBoardScreen", () => {
  it("loads the trip and adds a day through the command endpoint", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    render(<TripBoardScreen tripId={fixture.tripId} />);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Add day" }));
    await waitFor(() => expect(screen.getAllByTestId("day-column")).toHaveLength(1));
  });

  it("shows an error state for a missing trip", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    render(<TripBoardScreen tripId="00000000-0000-4000-8000-000000000000" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test`
Expected: FAIL — `TripBoardScreen` does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/components/board/TripBoardScreen.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TripDetail } from "@tc/contracts";
import { fetchTripDetail, sendTripCommand, type BoardCommand } from "@/lib/apiClient";
import type { ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";

function StartDateControl({
  startDate,
  onSet,
}: {
  startDate: string | null;
  onSet: (value: string | null) => void;
}) {
  return (
    <p>
      <label>
        Start date:{" "}
        <input
          type="date"
          value={startDate ?? ""}
          onChange={(e) => onSet(e.target.value === "" ? null : e.target.value)}
        />
      </label>{" "}
      {startDate !== null && <button onClick={() => onSet(null)}>Clear</button>}
    </p>
  );
}

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthenticated" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTripDetail(tripId);
    if (!result.ok) {
      setStatus(result.error.status === 401 ? "unauthenticated" : "error");
      setError(result.error.message);
      return;
    }
    setTrip(result.value);
    setStatus("ready");
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dispatch = useCallback(
    async (command: BoardCommand) => {
      setError(null);
      const result = await sendTripCommand(command);
      if (!result.ok) setError(result.error.message);
      // Refetch either way: conflicts are data and may have changed shape.
      await load();
    },
    [load],
  );

  if (status === "loading") return <main>Loading…</main>;
  if (status === "unauthenticated") {
    return (
      <main>
        <h1>travel-collab</h1>
        <Link href={`/api/auth/signin?callbackUrl=/trips/${tripId}`}>Sign in</Link>
      </main>
    );
  }
  if (status === "error" || trip === null) {
    return (
      <main>
        <p role="alert">{error ?? "Something went wrong"}</p>
        <Link href="/">← Your trips</Link>
      </main>
    );
  }

  return (
    <main>
      <nav>
        <Link href="/">← Your trips</Link>
      </nav>
      <h1>{trip.name}</h1>
      <StartDateControl
        startDate={trip.startDate}
        onSet={(startDate) => void dispatch({ type: "SetTripStartDate", tripId, startDate })}
      />
      {error !== null && <p role="alert">{error}</p>}
      <Board
        trip={trip}
        callbacks={{
          onMove: (activityId, toDayId, position) =>
            void dispatch({ type: "MoveActivity", tripId, activityId, toDayId, position }),
          onAddDay: () => void dispatch({ type: "AddDay", tripId, dayId: crypto.randomUUID() }),
          onRemoveDay: (dayId) => void dispatch({ type: "RemoveDay", tripId, dayId }),
          onAddActivity: (value: ActivityFormValue) =>
            void dispatch({
              type: "AddActivity",
              tripId,
              activityId: crypto.randomUUID(),
              title: value.title,
              timeWindow: value.timeWindow ?? undefined,
              location: value.location ?? undefined,
              notes: value.notes ?? undefined,
            }),
          onUpdateActivity: (activityId, value) =>
            void dispatch({
              type: "UpdateActivity",
              tripId,
              activityId,
              title: value.title,
              timeWindow: value.timeWindow,
              location: value.location,
              notes: value.notes,
            }),
          onRemoveActivity: (activityId) => void dispatch({ type: "RemoveActivity", tripId, activityId }),
        }}
      />
    </main>
  );
}
```

`apps/web/src/app/trips/[tripId]/page.tsx`:
```tsx
import { TripBoardScreen } from "@/components/board/TripBoardScreen";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripBoardScreen tripId={tripId} />;
}
```

`apps/web/src/app/layout.tsx` — change only the body style line (the board needs the width; home stays readable because its content is narrow):
```tsx
      <body style={{ fontFamily: "system-ui", margin: "2rem" }}>
```

`apps/web/src/app/page.tsx` — change only the trips-list `<li>` to link to the board (add `Link` is already imported):
```tsx
        {(trips ?? []).map((t) => (
          <li key={t.tripId}>
            <Link href={`/trips/${t.tripId}`}>{t.name}</Link>
          </li>
        ))}
```

- [ ] **Step 4: Run the tests, then verify manually**

Run: `pnpm --filter web test && pnpm -r typecheck && pnpm lint`
Expected: 13 unit tests passing; lint wall green (`TripBoardScreen` imports contracts + the client only).

Run: `docker compose up -d && pnpm --filter web dev`, sign in via Dev Login as `alice`, create a trip, click its name.
Expected: the board renders; "+ Add day" adds Day 1; "+ Add activity" (title + 09:00–11:00) lands in the backlog; dragging it onto Day 1 works; adding a second overlapping activity and dragging it to Day 1 shows the ⚠️ badge and banner; setting a start date relabels columns ("Day 1 — …").
Also verify the events flowed:
`docker compose exec postgres psql -U postgres -d travel -c "select seq, type, actor_id from events order by global_seq desc limit 5"`
Expected: `ActivityMoved` / `ActivityAdded` / `DayAdded` rows with `actor_id = dev-alice`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): trip board page wired to the command pipeline"
```

---

### Task 12: Playwright M1 board happy path

**Files:**
- Create: `apps/web/e2e/helpers.ts`, `apps/web/e2e/m1-board.spec.ts`
- Do NOT touch `apps/web/e2e/smoke.spec.ts` — the M0 script stays green, verbatim, forever.

**Interfaces:**
- Consumes: the running app (`AUTH_DEV_LOGIN=true`, Postgres up); selectors produced by Tasks 10–11 (`day-column`, `activity-card-*` testids, "+ Add day", "+ Add activity", editor labels).
- Produces: `pnpm --filter web test:e2e` runs BOTH milestone scripts.

- [ ] **Step 1: Write the sign-in helper**

`apps/web/e2e/helpers.ts` (the hydration-wait pattern is from the M0 retro — do not remove it):
```ts
import { expect, type Page } from "@playwright/test";

export async function signInAsDevUser(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.fill('input[name="username"]', username);
  // Wait for the post-sign-in page's first authenticated /api/trips fetch —
  // it only fires after React hydrates, so the form's onSubmit is attached.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}
```

- [ ] **Step 2: Write the board spec**

`apps/web/e2e/m1-board.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

test("board: days, activities, drag, conflicts as data", async ({ page }) => {
  const tripName = `Lisbon ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();

  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(2);

  // Two overlapping activities into the backlog
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Colosseum");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("11:00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Colosseum")).toBeVisible();

  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Vatican Museums");
  await page.getByLabel("Start time").fill("10:00");
  await page.getByLabel("End time").fill("12:00");
  await page.getByRole("button", { name: "Save" }).click();

  const colosseum = page.getByTestId(/activity-card-/).filter({ hasText: "Colosseum" });
  const vatican = page.getByTestId(/activity-card-/).filter({ hasText: "Vatican Museums" });
  const day1 = page.getByTestId("day-column").nth(0);
  const day2 = page.getByTestId("day-column").nth(1);

  await colosseum.dragTo(day1);
  await expect(day1.getByText("Colosseum")).toBeVisible();
  await vatican.dragTo(day1);
  await expect(day1.getByText("Vatican Museums")).toBeVisible();

  // The conflict appears as data — the writes above all succeeded.
  await expect(page.getByText(/overlap in time/)).toBeVisible();

  // Resolving by moving away clears it.
  await vatican.dragTo(day2);
  await expect(day2.getByText("Vatican Museums")).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();
});
```

- [ ] **Step 3: Run it**

Run: `docker compose up -d && pnpm --filter web test:e2e`
Expected: 2 passing (M0 smoke + M1 board). Playwright's `dragTo` drives Chromium's native HTML5 drag events, which is what pragmatic-drag-and-drop listens to. If a drag step flakes, add a small hover first (`await colosseum.hover()`) or use `dragTo(target, { targetPosition: { x: 20, y: 20 } })` to hit the column's list area rather than a card, and note the adjustment in the commit body.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(web): playwright m1 board happy path"
```

---

### Task 13: PR, CI, deploy verification, gate ceremony (WITH MITCHELL — stop at each ⚠)

**Files:**
- Modify: `docs/milestones/M1-planning-core.md` (retro note), `TODO.md` (check M1), `README.md` (status line)

- [ ] **Step 1: Full local suite**

Run: `pnpm check && pnpm test:int && pnpm --filter web test:e2e`
Expected: everything green. Also verify the projection-reset workflow once by hand (ADR-004 "DB resets are cheap"):
`docker compose exec postgres psql -U postgres -d travel -c "delete from trip_details; delete from trip_summaries;"` then run a small script or rely on the golden test — `pnpm test:int` must still pass (it rebuilds and compares).

- [ ] **Step 2: Push the branch and open the PR**

```bash
git push -u origin m1-planning-core
gh pr create --title "M1: planning core" --body "Days, backlog, activities, day-column board with drag, conflict engine (overlap + geography), trip_details projection. Exit gate: docs/milestones/M1-planning-core.md"
```
Watch CI (`gh run watch`). Fix forward until green — this task is not done at yellow.

- [ ] **Step 3 ⚠: Mitchell reviews and merges the PR.** Vercel deploys `main` automatically. STOP and wait.

- [ ] **Step 4 ⚠: Walk the exit gate with Mitchell** on the production URL: the full board demo from `docs/milestones/M1-planning-core.md` (including a manual-coordinate geography conflict: e.g. "Colosseum" at 41.8902/12.4922 and "The Met" at 40.7794/-73.9632 on the same day). Every gate checkbox gets ticked for real or M1 is not done.

- [ ] **Step 5: Gate paperwork**

Append a retro note to `docs/milestones/M1-planning-core.md` (what we learned, what changed vs this plan, what M2 should know). Check the M1 box in `TODO.md`. Update the `README.md` status line to "M1 complete, M2 next".

```bash
git add -A && git commit -m "docs: m1 gate passed — retro note and roadmap tick" && git push
```

- [ ] **Step 6 ⚠: Go/no-go on M2 from Mitchell.**

---

## Self-review checklist (for the plan author, completed 2026-07-08)

- Spec coverage: every M1 milestone scope line maps to a task (days → T1–T3, start date → T1–T3+T11, activities → T1–T3, conflict engine → T4, pipeline step 7 → T7, trip_details + golden → T5–T7, API → T8, board UI → T9–T11, e2e → T12, gate → T13).
- Type consistency: `TripState`/`Decision`/`TripDetail`/`BoardCommand`/`ActivityFormValue`/`BoardCallbacks` signatures match across tasks; rejection codes in T3 match the route status map in T8.
- No placeholders: every code step contains complete code; every run step has an expected outcome.
- Config single-sourcing (added 2026-07-08 at Mitchell's request): Task 0 introduces `apps/web/src/config.ts` + `apps/web/src/server/config.ts`; no later snippet hardcodes a port or database URL (Task 9's vitest config and apiClient import `BASE_URL`); the only repeated defaults are the two `${VAR:-default}` interpolations compose/scripts require, each with a pointer comment.
