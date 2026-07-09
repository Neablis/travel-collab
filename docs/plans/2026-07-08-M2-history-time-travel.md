# M2 History & Time Travel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** Make the event log user-facing — history list, linear undo/redo, read-only past-state preview, revert-to-state, persistent conflict dismissal — via compensating events (ADR-005) through the one existing command pipeline; and first retire M1's infra debt (shared preview/prod database, hand-run migrations, ad-hoc resets).

**Architecture:** Same as M0/M1 (ADR-001/002/003) plus ADR-005: undo/redo/revert are ordinary `TripCommand`s whose decide step emits ordinary domain events computed by a pure state diff. No new event types for history operations; no reducer changes for them; no head pointer. Provenance (`batchId`, `origin`) lives on the event envelope. Two new read endpoints replay the log (history list, detail-at-seq). Spec: `docs/specs/2026-07-08-M2-history-time-travel-design.md`.

**Tech Stack:** Everything M1 used. **No new dependencies of any kind** — if a snippet seems to need one, that is a bug in the snippet.

## Global Constraints

- Read `AGENTS.md` before starting. Its invariants override convenience, always.
- Node >= 20, pnpm >= 9. All commands run from the repo root unless stated.
- **Local ports and dev config (M0 retro, single-sourced in M1 Task 0):** Postgres on **5433**, dev server on **3001**; defaults live in `apps/web/src/config.ts` and `apps/web/src/server/config.ts`, env vars override. Never hardcode a port or database URL; the only exceptions remain the `${VAR:-default}` interpolations in `docker-compose.yml` / `package.json` scripts that already exist.
- **Branch strategy:** create branch `m2-history-time-travel` from `main` (isolated worktree recommended via superpowers:using-git-worktrees). One PR at the end (Task 11). CI must be green before merge.
- Tasks 0a–0c are ops/infra and land **before any feature task**. 0a and 0b need Mitchell's Vercel/Neon/GitHub access (linked `vercel` CLI, Neon console or API key, `gh` with repo admin). If any credential or console step is unavailable, STOP and ask Mitchell rather than working around it.
- Events are forever: never edit stored events; all new event schemas are `version: 1`; event payloads use explicit `null`, never missing keys.
- Every event carries `actor_id`; ALL permission checks go through `AccessPolicy` (AGENTS.md invariant 6). History commands are authorized exactly like board commands.
- No writes to `trip_summaries` or `trip_details` outside `apps/web/src/server/projections.ts` (invariant 1). The new history reads live in `apps/web/src/server/history.ts` — route handlers under `src/app` may import only `@/server/*` and `@tc/contracts`, never `@tc/domain` (lint wall).
- `packages/domain` does no I/O, no clock reads, no randomness (invariant 4). `batchId` generation therefore happens in `apps/web/src/server` (`crypto.randomUUID()`), never in domain code.
- Local Postgres must be running for integration tests: `docker compose up -d`.
- Commit after every task with the exact message given (conventional commits).
- **Known red window:** `pnpm typecheck` fails between Task 1 and Task 2 (the grown `TripEvent`/`TripCommand` unions make `evolveTrip`/`decideTripCommand` non-exhaustive and `TripState` literals in tests miss `dismissedConflictIds`). Task 1 verifies the contracts package only; the workspace is green again from Task 2 onward. Do not "fix" this early by weakening types.

---

### Task 0a: Separate preview and production databases

The M1 retro's root finding: Vercel's `DATABASE_URL` is the **same value** for Production and Preview, so previews read/write live production data. Fix: a Neon **branch** database for Preview, distinct connection string per environment.

**Files:**
- Create: `docs/guidelines/environments-and-deploys.md`
- Modify: `.env.example` (append pointer comment)

**Interfaces:**
- Produces: Vercel env `DATABASE_URL` differs between Production and Preview scopes; Preview points at the Neon branch `preview`. Task 0b's preview build-step migration and Task 0c's reset helper both target this branch.

- [ ] **Step 1: Create the Neon branch database**

In the Neon console (project used by production): *Branches → New branch*, name **`preview`**, branching from `main` (default settings; include data is fine — it will be reset by Task 0c). Copy the branch's **pooled** connection string (PgBouncer host, `-pooler` suffix) per ADR-004.

- [ ] **Step 2: Point Vercel Preview at the branch**

```bash
vercel env rm DATABASE_URL preview   # removes the shared value from the Preview scope only
vercel env add DATABASE_URL preview  # paste the preview branch POOLED connection string
vercel env ls                        # verify: DATABASE_URL listed separately for production and preview
```
Expected: `vercel env ls` shows `DATABASE_URL` twice — Production (unchanged) and Preview (new value).

- [ ] **Step 3: Verify isolation on a real preview deployment**

Push any trivial branch and open its preview URL. Sign in, create a trip named `preview-isolation-check`. Then open the production URL (`https://travel-collab-three.vercel.app`) and confirm the trip does **not** appear there. Delete nothing by hand; Task 0c's reset will clean the branch.

- [ ] **Step 4: Document the environment layout**

Create `docs/guidelines/environments-and-deploys.md`:

```markdown
# Environments and deploys

| Environment | App | Database | DATABASE_URL source |
|---|---|---|---|
| Local | `pnpm dev` (port 3001) | Docker Postgres (port 5433) | `apps/web/src/server/config.ts` default / `.env.local` |
| CI | GitHub Actions | PG service container | `ci.yml` workflow env |
| Preview | Vercel preview deploys | **Neon branch `preview`** (pooled) | Vercel env, Preview scope |
| Production | Vercel production | Neon `main` (pooled) | Vercel env, Production scope |

Rules (ADR-004 + M1 retro):
- Preview and Production `DATABASE_URL` are **never** the same value.
- Migrations are applied by automation only (see below), never `drizzle-kit migrate`
  run by hand against a remote database.
- Production migrations: the `migrate-production` job in `.github/workflows/ci.yml`
  runs on `push: main` after the `checks` job passes, using the
  `PRODUCTION_DATABASE_URL` repo secret (the UNPOOLED/direct connection string —
  DDL should not run through PgBouncer).
- Preview migrations: `apps/web/scripts/vercel-build-migrate.mjs` runs
  `drizzle-kit migrate` during the Vercel build only when `VERCEL_ENV=preview`,
  against the preview branch. Safe because previews are disposable (Task 0c).
- Resetting the preview branch (or local db):
  `DATABASE_URL=<preview pooled url> pnpm --filter web db:reset`
  — temporary scaffolding, see the header of `apps/web/scripts/db-reset.mjs`.
```

Append to `.env.example`:

```bash
# Remote database URLs are never stored in this repo. Preview/Production values
# live in Vercel env scopes; the production migration secret lives in GitHub
# Actions (PRODUCTION_DATABASE_URL). See docs/guidelines/environments-and-deploys.md.
```

- [ ] **Step 5: Commit**

```bash
git add docs/guidelines/environments-and-deploys.md .env.example
git commit -m "chore(ops): split preview and production databases (Neon branch + env layout doc)"
```

### Task 0b: Automate migrations (production on merge, preview at build)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `apps/web/scripts/vercel-build-migrate.mjs`
- Modify: `apps/web/package.json` (add `vercel-build` script)

**Interfaces:**
- Produces: merges to `main` apply `drizzle-kit migrate` to production automatically after CI passes; preview builds migrate the preview branch. Task 5's migration (provenance columns) will be the first migration to ride this automation.

- [ ] **Step 1: Add the production migration secret**

```bash
gh secret set PRODUCTION_DATABASE_URL  # paste the Neon main branch DIRECT (unpooled) connection string
```

- [ ] **Step 2: Add the gated job to `.github/workflows/ci.yml`**

Append after the existing `checks` job (same indentation level):

```yaml
  migrate-production:
    needs: checks
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter web db:migrate
        env:
          # Overrides the workflow-level localhost value with the real target.
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
```

- [ ] **Step 3: Preview build-step migration**

`apps/web/scripts/vercel-build-migrate.mjs`:

```js
// Runs drizzle migrations during the Vercel build — PREVIEW ONLY.
// Production is migrated by the migrate-production job in ci.yml (explicit,
// post-CI, per ADR-004); previews own a disposable Neon branch (M2 Task 0a),
// so migrating at build time is safe there.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV === "preview") {
  execSync("pnpm drizzle-kit migrate", { stdio: "inherit" });
} else {
  console.log(`[vercel-build-migrate] skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
}
```

In `apps/web/package.json` scripts, add (Vercel prefers `vercel-build` over `build` when present):

```json
    "vercel-build": "node scripts/vercel-build-migrate.mjs && next build",
```

- [ ] **Step 4: Verify**

Local guard check (must skip, not migrate):
Run: `node apps/web/scripts/vercel-build-migrate.mjs`
Expected: `[vercel-build-migrate] skipped (VERCEL_ENV=unset)`

Push the branch; on the PR, CI's `checks` job runs and `migrate-production` shows as **skipped** (not failed). The full production path is verified when this plan's PR merges (Task 11 notes it); the preview path is verified by Task 5's migration applying to the preview branch during the PR's preview build.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml apps/web/scripts/vercel-build-migrate.mjs apps/web/package.json
git commit -m "ci: migrate production on merge to main; preview migrates at build"
```

### Task 0c: DB reset helper (temporary scaffolding)

**Files:**
- Create: `apps/web/scripts/db-reset.mjs`
- Modify: `apps/web/package.json` (add `db:reset` script)

**Interfaces:**
- Produces: `pnpm --filter web db:reset` truncates `events`, `trip_details`, `trip_summaries` on the `DATABASE_URL` target after an explicit type-the-hostname confirmation (`--yes` skips it, for local/CI only).

- [ ] **Step 1: Write the script**

`apps/web/scripts/db-reset.mjs`:

```js
// TEMPORARY SCAFFOLDING (M2 Task 0c, M1 retro follow-up) — remove or fold into
// a real seed/fixture story before release (ADR-004: "DB resets are cheap").
// Truncates the event log + projections on whatever DATABASE_URL points at.
// Deliberately requires an explicit DATABASE_URL (no config default): pointing
// a destructive tool somewhere should never happen implicitly.
import { createInterface } from "node:readline/promises";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (local: postgres://postgres:postgres@localhost:5433/travel)");
  process.exit(1);
}
const host = new URL(url).hostname;
const TABLES = ["events", "trip_details", "trip_summaries"];

if (!process.argv.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `About to TRUNCATE ${TABLES.join(", ")} on ${host}.\nType the hostname to confirm: `,
  );
  rl.close();
  if (answer.trim() !== host) {
    console.error("aborted (hostname mismatch)");
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY`);
await client.end();
console.log(`reset ${TABLES.join(", ")} on ${host}`);
```

In `apps/web/package.json` scripts, add:

```json
    "db:reset": "node scripts/db-reset.mjs",
```

- [ ] **Step 2: Verify against local Postgres**

```bash
docker compose up -d
DATABASE_URL=postgres://postgres:postgres@localhost:5433/travel pnpm --filter web db:reset --yes
```
Expected: `reset events, trip_details, trip_summaries on localhost`. Then run it once **without** `--yes` and type a wrong hostname — expected: `aborted (hostname mismatch)`, exit code 1.

Also reset the preview branch created in 0a (cleans the copied production data):
```bash
DATABASE_URL=<preview pooled url> pnpm --filter web db:reset   # type the hostname when prompted
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/db-reset.mjs apps/web/package.json
git commit -m "chore(ops): add db:reset helper (temporary scaffolding)"
```

---

### Task 1: Contracts — provenance, history commands, dismissal events, history DTOs

**Files:**
- Create: `packages/contracts/src/history.ts`
- Modify: `packages/contracts/src/envelope.ts`, `packages/contracts/src/trip.ts`, `packages/contracts/src/detail.ts`, `packages/contracts/src/index.ts`
- Modify: `docs/contracts/CHANGELOG.md`
- Test: `packages/contracts/test/history.test.ts` (create; mirror however existing contracts tests are laid out — if the package has no test dir, create `test/` and confirm `pnpm --filter @tc/contracts test` picks it up before writing more)

**Interfaces:**
- Produces (consumed by every later task):
  - `Origin` — `{kind:'user'} | {kind:'undo', undoesBatchId} | {kind:'redo', redoesBatchId} | {kind:'revert', toSeq}` (Zod discriminated union on `kind`).
  - `EventEnvelope` gains `batchId: string (uuid)` and `origin: Origin`.
  - Commands `UndoLastChange {type, tripId}`, `RedoChange {type, tripId}`, `RevertToState {type, tripId, toSeq}`, `DismissConflict {type, tripId, conflictId}` — all members of `TripCommand`.
  - Events `ConflictDismissedV1` / `ConflictUndismissedV1` (`payload: {tripId, conflictId}`) — members of `TripEvent`.
  - DTOs `HistoryEntry {batchId, fromSeq, toSeq, actorId, occurredAt, origin, description, undone}` and `TripHistory {tripId, entries, canUndo, canRedo}`.
  - `TripDetail` gains `dismissedConflictIds: string[]`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/test/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EventEnvelope,
  Origin,
  TripCommand,
  TripEvent,
  TripHistory,
} from "../src";

describe("M2 history contracts", () => {
  it("parses every origin kind", () => {
    expect(Origin.parse({ kind: "user" }).kind).toBe("user");
    expect(Origin.parse({ kind: "undo", undoesBatchId: "7d9a1f8e-0000-4000-8000-000000000001" }).kind).toBe("undo");
    expect(Origin.parse({ kind: "redo", redoesBatchId: "7d9a1f8e-0000-4000-8000-000000000002" }).kind).toBe("redo");
    expect(Origin.parse({ kind: "revert", toSeq: 3 }).kind).toBe("revert");
    expect(() => Origin.parse({ kind: "revert", toSeq: 0 })).toThrow();
  });

  it("envelope requires batchId and origin", () => {
    const base = {
      streamId: "7d9a1f8e-0000-4000-8000-00000000000a",
      seq: 1,
      type: "TripCreated",
      version: 1,
      payload: {},
      actorId: "u1",
      occurredAt: "2026-07-08T00:00:00.000Z",
    };
    expect(() => EventEnvelope.parse(base)).toThrow();
    expect(
      EventEnvelope.parse({
        ...base,
        batchId: "7d9a1f8e-0000-4000-8000-00000000000b",
        origin: { kind: "user" },
      }).batchId,
    ).toBeDefined();
  });

  it("history commands and dismissal events joined the unions", () => {
    const tripId = "7d9a1f8e-0000-4000-8000-00000000000a";
    expect(TripCommand.parse({ type: "UndoLastChange", tripId }).type).toBe("UndoLastChange");
    expect(TripCommand.parse({ type: "RedoChange", tripId }).type).toBe("RedoChange");
    expect(TripCommand.parse({ type: "RevertToState", tripId, toSeq: 2 }).type).toBe("RevertToState");
    expect(TripCommand.parse({ type: "DismissConflict", tripId, conflictId: "time-overlap:d:a:b" }).type).toBe("DismissConflict");
    expect(TripEvent.parse({ type: "ConflictDismissed", version: 1, payload: { tripId, conflictId: "x:y:z" } }).type).toBe("ConflictDismissed");
    expect(TripEvent.parse({ type: "ConflictUndismissed", version: 1, payload: { tripId, conflictId: "x:y:z" } }).type).toBe("ConflictUndismissed");
  });

  it("TripHistory round-trips", () => {
    const tripId = "7d9a1f8e-0000-4000-8000-00000000000a";
    const history = {
      tripId,
      canUndo: true,
      canRedo: false,
      entries: [
        {
          batchId: "7d9a1f8e-0000-4000-8000-00000000000b",
          fromSeq: 2,
          toSeq: 3,
          actorId: "u1",
          occurredAt: "2026-07-08T00:00:00.000Z",
          origin: { kind: "revert", toSeq: 1 },
          description: "Reverted to version 1",
          undone: false,
        },
      ],
    };
    expect(TripHistory.parse(history)).toEqual(history);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @tc/contracts test`
Expected: FAIL — `Origin` etc. not exported.

- [ ] **Step 3: Implement**

`packages/contracts/src/history.ts`:

```ts
import { z } from "zod";

// Provenance of a batch of events: how the change came to be. Lives on the
// EVENT ENVELOPE, beside actor_id/occurred_at — never in the domain event
// vocabulary (ADR-005).
export const Origin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("undo"), undoesBatchId: z.string().uuid() }),
  z.object({ kind: z.literal("redo"), redoesBatchId: z.string().uuid() }),
  z.object({ kind: z.literal("revert"), toSeq: z.number().int().positive() }),
]);
export type Origin = z.infer<typeof Origin>;

// ---- History commands (ADR-005: they emit ORDINARY domain events) ----

export const UndoLastChange = z.object({
  type: z.literal("UndoLastChange"),
  tripId: z.string().uuid(),
});
export type UndoLastChange = z.infer<typeof UndoLastChange>;

export const RedoChange = z.object({
  type: z.literal("RedoChange"),
  tripId: z.string().uuid(),
});
export type RedoChange = z.infer<typeof RedoChange>;

export const RevertToState = z.object({
  type: z.literal("RevertToState"),
  tripId: z.string().uuid(),
  toSeq: z.number().int().positive(),
});
export type RevertToState = z.infer<typeof RevertToState>;

// ---- Conflict dismissal (persistent — retires M1's client-local stopgap) ----

export const DismissConflict = z.object({
  type: z.literal("DismissConflict"),
  tripId: z.string().uuid(),
  conflictId: z.string().min(1),
});
export type DismissConflict = z.infer<typeof DismissConflict>;

export const ConflictDismissedV1 = z.object({
  type: z.literal("ConflictDismissed"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), conflictId: z.string().min(1) }),
});
export type ConflictDismissedV1 = z.infer<typeof ConflictDismissedV1>;

// No user-facing "undismiss" command exists; this event exists so dismissals
// are expressible in a state diff — i.e. undoable/revertible (ADR-005).
export const ConflictUndismissedV1 = z.object({
  type: z.literal("ConflictUndismissed"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), conflictId: z.string().min(1) }),
});
export type ConflictUndismissedV1 = z.infer<typeof ConflictUndismissedV1>;

// ---- History read DTOs ----

export const HistoryEntry = z.object({
  batchId: z.string().uuid(),
  fromSeq: z.number().int().positive(),
  toSeq: z.number().int().positive(),
  actorId: z.string().min(1),
  occurredAt: z.string(), // ISO 8601
  origin: Origin,
  description: z.string(),
  undone: z.boolean(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const TripHistory = z.object({
  tripId: z.string().uuid(),
  entries: z.array(HistoryEntry), // newest first as served by the API
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});
export type TripHistory = z.infer<typeof TripHistory>;
```

`packages/contracts/src/envelope.ts` — full new content:

```ts
import { z } from "zod";
import { Origin } from "./history";

export const EventEnvelope = z.object({
  streamId: z.string().uuid(),
  seq: z.number().int().positive(),
  type: z.string().min(1),
  version: z.number().int().positive(),
  payload: z.unknown(),
  actorId: z.string().min(1),
  occurredAt: z.string(), // ISO 8601
  batchId: z.string().uuid(), // one per command execution (M2)
  origin: Origin, // provenance: user | undo | redo | revert (M2, ADR-005)
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
```

`packages/contracts/src/trip.ts` — add to the imports and both unions:

```ts
import {
  ConflictDismissedV1,
  ConflictUndismissedV1,
  DismissConflict,
  RedoChange,
  RevertToState,
  UndoLastChange,
} from "./history";
```

`TripEvent` union gains `ConflictDismissedV1, ConflictUndismissedV1` (append inside `z.discriminatedUnion`); `TripCommand` union gains `UndoLastChange, RedoChange, RevertToState, DismissConflict`.

`packages/contracts/src/detail.ts` — `TripDetail` gains, after `conflicts`:

```ts
  dismissedConflictIds: z.array(z.string()), // sorted; ids are content-derived
```

`packages/contracts/src/index.ts` — add `export * from "./history";`.

- [ ] **Step 4: Run the contracts tests**

Run: `pnpm --filter @tc/contracts test && pnpm --filter @tc/contracts typecheck`
Expected: PASS. (`pnpm typecheck` at the root is EXPECTED to fail until Task 2 — the red window.)

- [ ] **Step 5: Changelog entry**

Append to `docs/contracts/CHANGELOG.md`:

```markdown
## 2026-07-08 — M2 history & time travel schemas
- Added: `Origin`; `EventEnvelope` gains required `batchId` + `origin`
- Added: commands `UndoLastChange`, `RedoChange`, `RevertToState`,
  `DismissConflict` (joined `TripCommand`)
- Added: events `ConflictDismissedV1`, `ConflictUndismissedV1` (joined `TripEvent`)
- Added: DTOs `HistoryEntry`, `TripHistory`; `TripDetail` gains `dismissedConflictIds`
- Why: M2 — undo/redo/revert via compensating events (ADR-005), history UI,
  persistent conflict dismissal
- Consumers updated: `@tc/domain`, `apps/web` (pipeline, event store + column
  migration with backfill, routes, UI) — in this same PR
- Breaking? yes, envelope only — stored events need the Task 5 backfill
  migration (batch_id = own uuid, origin = user); event payloads unchanged,
  `TripEvent.parse` accepts all previously stored events
```

- [ ] **Step 6: Commit**

```bash
git add packages/contracts docs/contracts/CHANGELOG.md
git commit -m "feat(contracts): envelope provenance, history commands, dismissal events, history DTOs"
```

### Task 2: Domain — dismissal state, structural equality, no-op guards

**Files:**
- Create: `packages/domain/src/trip/equality.ts`
- Modify: `packages/domain/src/trip/state.ts`, `packages/domain/src/trip/evolve.ts`, `packages/domain/src/trip/decide.ts`, `packages/domain/src/trip/detail.ts`, `packages/domain/src/index.ts`
- Modify: existing domain tests wherever `TripState` literals now miss the new field
- Test: `packages/domain/test/dismissal.test.ts`, `packages/domain/test/equality.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 contracts.
- Produces:
  - `TripState.dismissedConflictIds: string[]` (always kept **sorted** — projection determinism).
  - `tripStatesEqual(a: TripState, b: TripState): boolean` and `activityStatesEqual(a: ActivityState, b: ActivityState): boolean` from `trip/equality.ts` (used by Task 3's diff and by decide's no-op guards).
  - `evolveTrip` handles `ConflictDismissed`/`ConflictUndismissed`.
  - `decideTripCommand` handles `DismissConflict`, and rejects state-preserving `SetTripStartDate`/`UpdateActivity`/`MoveActivity` with code **`no-op`** (this is what guarantees every stored batch changes state — the undo stack in Task 4 relies on it).
  - `decideTripCommand` returns rejection `history-command` for the three history command types (they are decided by Task 4's `decideHistoryCommand`; the pipeline dispatches, but decide stays total).
  - `tripDetailFromState` includes `dismissedConflictIds`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/dismissal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TripCommand } from "@tc/contracts";
import { decideTripCommand, detectConflicts, evolveTrip, tripDetailFromState, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const CTX = { actorId: "u1" };

// A state with one live time-overlap conflict.
function conflictedState(): TripState {
  return {
    tripId: TRIP,
    name: "Rome",
    members: [{ userId: "u1", role: "owner" }],
    startDate: null,
    days: [{ dayId: DAY, activityIds: [A1, A2] }],
    backlog: [],
    activities: {
      [A1]: { title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null },
      [A2]: { title: "Vatican", timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null },
    },
    dismissedConflictIds: [],
  };
}

describe("conflict dismissal", () => {
  it("conflict ids are content-derived (deterministic across recomputation)", () => {
    const [first] = detectConflicts(conflictedState());
    const [second] = detectConflicts(conflictedState());
    expect(first).toBeDefined();
    expect(first!.id).toBe(second!.id);
  });

  it("DismissConflict emits ConflictDismissed for a live conflict", () => {
    const state = conflictedState();
    const conflictId = detectConflicts(state)[0]!.id;
    const decision = decideTripCommand(state, { type: "DismissConflict", tripId: TRIP, conflictId }, CTX);
    if (!decision.ok) throw new Error(decision.rejection.code);
    expect(decision.events).toEqual([
      { type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId } },
    ]);
  });

  it("rejects dismissing an unknown or already-dismissed conflict", () => {
    const state = conflictedState();
    const bad = decideTripCommand(state, { type: "DismissConflict", tripId: TRIP, conflictId: "nope" }, CTX);
    expect(bad.ok).toBe(false);
    const conflictId = detectConflicts(state)[0]!.id;
    const dismissed = evolveTrip(state, {
      type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId },
    });
    const again = decideTripCommand(dismissed, { type: "DismissConflict", tripId: TRIP, conflictId }, CTX);
    expect(again.ok).toBe(false);
  });

  it("evolve adds (sorted) and removes dismissal ids; detail doc carries them", () => {
    const state = conflictedState();
    const dismissed = evolveTrip(state, {
      type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId: "b" },
    });
    const dismissed2 = evolveTrip(dismissed, {
      type: "ConflictDismissed", version: 1, payload: { tripId: TRIP, conflictId: "a" },
    });
    expect(dismissed2.dismissedConflictIds).toEqual(["a", "b"]);
    const undismissed = evolveTrip(dismissed2, {
      type: "ConflictUndismissed", version: 1, payload: { tripId: TRIP, conflictId: "b" },
    });
    expect(undismissed.dismissedConflictIds).toEqual(["a"]);
    expect(tripDetailFromState(undismissed, "2026-07-08T00:00:00.000Z").dismissedConflictIds).toEqual(["a"]);
  });
});

describe("no-op command guards", () => {
  it("rejects a same-value start date, unchanged update, and same-position move with code no-op", () => {
    const state = conflictedState();
    const cases: TripCommand[] = [
      { type: "SetTripStartDate", tripId: TRIP, startDate: null },
      { type: "UpdateActivity", tripId: TRIP, activityId: A1 }, // all fields omitted = unchanged
      { type: "MoveActivity", tripId: TRIP, activityId: A2, toDayId: DAY, position: 1 },
    ];
    for (const command of cases) {
      const decision = decideTripCommand(state, command, CTX);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.rejection.code).toBe("no-op");
    }
  });

  it("still accepts real changes", () => {
    const state = conflictedState();
    const decision = decideTripCommand(
      state,
      { type: "MoveActivity", tripId: TRIP, activityId: A2, toDayId: null, position: 0 },
      CTX,
    );
    expect(decision.ok).toBe(true);
  });
});
```

`packages/domain/test/equality.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tripStatesEqual, type TripState } from "../src";

const base: TripState = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a",
  name: "Rome",
  members: [{ userId: "u1", role: "owner" }],
  startDate: null,
  days: [{ dayId: "7d9a1f8e-0000-4000-8000-00000000000d", activityIds: [] }],
  backlog: ["7d9a1f8e-0000-4000-8000-0000000000a1"],
  activities: {
    "7d9a1f8e-0000-4000-8000-0000000000a1": { title: "Colosseum", timeWindow: null, location: null, notes: null },
  },
  dismissedConflictIds: [],
};

describe("tripStatesEqual", () => {
  it("is true for structurally identical states regardless of activity key order", () => {
    const twoActivities = {
      ...base,
      backlog: [...base.backlog, "7d9a1f8e-0000-4000-8000-0000000000a2"],
      activities: {
        ...base.activities,
        "7d9a1f8e-0000-4000-8000-0000000000a2": { title: "Vatican", timeWindow: null, location: null, notes: null },
      },
    };
    const reversedKeys = {
      ...twoActivities,
      activities: Object.fromEntries(Object.entries(twoActivities.activities).reverse()),
    };
    expect(tripStatesEqual(twoActivities, reversedKeys)).toBe(true);
  });

  it("is false when order-bearing lists differ", () => {
    expect(tripStatesEqual(base, { ...base, backlog: [] })).toBe(false);
    expect(tripStatesEqual(base, { ...base, startDate: "2026-10-12" })).toBe(false);
    expect(tripStatesEqual(base, { ...base, dismissedConflictIds: ["x"] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify failure**

Run: `pnpm --filter @tc/domain test`
Expected: FAIL (typecheck errors on `dismissedConflictIds`, missing exports).

- [ ] **Step 3: Implement**

`packages/domain/src/trip/state.ts` — `TripState` gains one field:

```ts
  dismissedConflictIds: string[]; // sorted; content-derived conflict ids the user dismissed
```

`packages/domain/src/trip/equality.ts`:

```ts
import type { ActivityState, DayState, TripState } from "./state";

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function activityStatesEqual(a: ActivityState, b: ActivityState): boolean {
  return (
    a.title === b.title &&
    a.notes === b.notes &&
    (a.timeWindow === null) === (b.timeWindow === null) &&
    (a.timeWindow === null || (a.timeWindow.start === b.timeWindow!.start && a.timeWindow.end === b.timeWindow!.end)) &&
    (a.location === null) === (b.location === null) &&
    (a.location === null ||
      (a.location.name === b.location!.name && a.location.lat === b.location!.lat && a.location.lng === b.location!.lng))
  );
}

function daysEqual(a: readonly DayState[], b: readonly DayState[]): boolean {
  return (
    a.length === b.length &&
    a.every((d, i) => d.dayId === b[i]!.dayId && sameList(d.activityIds, b[i]!.activityIds))
  );
}

// Structural equality over the whole planning state. Activity record KEY ORDER
// is deliberately ignored (replay and diff construct it in different orders);
// every list that carries meaning (days, activityIds, backlog, dismissals) is
// compared in order.
export function tripStatesEqual(a: TripState, b: TripState): boolean {
  if (a.tripId !== b.tripId || a.name !== b.name || a.startDate !== b.startDate) return false;
  if (
    a.members.length !== b.members.length ||
    !a.members.every((m, i) => m.userId === b.members[i]!.userId && m.role === b.members[i]!.role)
  ) {
    return false;
  }
  if (!daysEqual(a.days, b.days) || !sameList(a.backlog, b.backlog)) return false;
  if (!sameList(a.dismissedConflictIds, b.dismissedConflictIds)) return false;
  const aIds = Object.keys(a.activities).sort();
  const bIds = Object.keys(b.activities).sort();
  if (!sameList(aIds, bIds)) return false;
  return aIds.every((id) => activityStatesEqual(a.activities[id]!, b.activities[id]!));
}
```

`packages/domain/src/trip/evolve.ts` — `TripCreated` branch gains `dismissedConflictIds: []`; the switch gains, before the closing brace:

```ts
    case "ConflictDismissed": {
      const id = event.payload.conflictId;
      if (state.dismissedConflictIds.includes(id)) return state;
      return { ...state, dismissedConflictIds: [...state.dismissedConflictIds, id].sort() };
    }
    case "ConflictUndismissed":
      return {
        ...state,
        dismissedConflictIds: state.dismissedConflictIds.filter((id) => id !== event.payload.conflictId),
      };
```

`packages/domain/src/trip/decide.ts` — add imports:

```ts
import { detectConflicts } from "./conflicts";
import { tripStatesEqual } from "./equality";
import { evolveTrip } from "./evolve";
```

Inside `decideTripCommand`, after the `state === null` guard, add a guard for the pipeline-dispatched history commands (keeps this function total over the union without duplicating Task 4's logic):

```ts
  if (
    command.type === "UndoLastChange" ||
    command.type === "RedoChange" ||
    command.type === "RevertToState"
  ) {
    return reject("history-command", "History commands are decided by decideHistoryCommand.");
  }
```

Add the dismissal case to the switch:

```ts
    case "DismissConflict": {
      if (!detectConflicts(state).some((c) => c.id === command.conflictId)) {
        return reject("conflict-not-found", "This conflict is not currently active.");
      }
      if (state.dismissedConflictIds.includes(command.conflictId)) {
        return reject("conflict-already-dismissed", "This conflict is already dismissed.");
      }
      return ok([
        {
          type: "ConflictDismissed",
          version: 1,
          payload: { tripId: command.tripId, conflictId: command.conflictId },
        },
      ]);
    }
```

Add a local no-op guard helper above `decideTripCommand` and apply it in exactly three cases (`SetTripStartDate`, `UpdateActivity`, `MoveActivity`), wrapping each case's current `return ok([event])` as:

```ts
function okUnlessNoOp(state: TripState, events: TripEvent[]): Decision {
  let next = state;
  for (const event of events) next = evolveTrip(next, event);
  if (tripStatesEqual(next, state)) {
    return reject("no-op", "This change would have no effect.");
  }
  return ok(events);
}
```

e.g. the `SetTripStartDate` case becomes:

```ts
    case "SetTripStartDate":
      return okUnlessNoOp(state, [
        {
          type: "TripStartDateSet",
          version: 1,
          payload: { tripId: command.tripId, startDate: command.startDate },
        },
      ]);
```

and likewise wrap the existing event constructions for `UpdateActivity` and `MoveActivity` (their validation guards stay exactly as they are). Do NOT wrap `AddDay`/`RemoveDay`/`AddActivity`/`RemoveActivity` — those always change state.

`packages/domain/src/trip/detail.ts` — `tripDetailFromState` return gains:

```ts
    dismissedConflictIds: [...state.dismissedConflictIds],
```

`packages/domain/src/index.ts` — add `export * from "./trip/equality";`.

- [ ] **Step 4: Fix the red window mechanically**

Run: `pnpm typecheck`
Every remaining error is a `TripState` literal (in `packages/domain/test/*.test.ts`, and possibly `apps/web/src/mocks/fixtures.ts` for `TripDetail`) missing the new field — add `dismissedConflictIds: []` to each. No other change is in scope for this step.

- [ ] **Step 5: Run everything**

Run: `pnpm typecheck && pnpm --filter @tc/domain test`
Expected: PASS, including all pre-existing domain tests.

- [ ] **Step 6: Commit**

```bash
git add packages/domain apps/web/src/mocks
git commit -m "feat(domain): conflict dismissal state + no-op command guards"
```

### Task 3: Domain — `diffTripStates` with round-trip property test

**Files:**
- Create: `packages/domain/src/trip/diff.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/diff.property.test.ts`

**Interfaces:**
- Consumes: `evolveTrip`, `tripStatesEqual`, Task 1 event types.
- Produces: `diffTripStates(current: TripState, target: TripState): TripEvent[]` — ordinary domain events transforming `current` into `target` exactly (both states must belong to the same stream: same `tripId`, same `name`, same `members`). Used by Task 4's `decideHistoryCommand`.

- [ ] **Step 1: Implement (the property test needs the real function to iterate against — write both together, run the test to failure first with a stub if you want the strict TDD beat: `return []`)**

`packages/domain/src/trip/diff.ts`:

```ts
import type { TripEvent } from "@tc/contracts";
import { tripStatesEqual, activityStatesEqual } from "./equality";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

// Compensating-events workhorse (ADR-005): emit ordinary domain events that
// transform `current` into `target`. Undo, redo, and revert are all "diff to a
// replayed past state". Correctness contract (property-tested): applying the
// returned events to `current` yields a state structurally equal to `target`.
// Minimality is NOT required — but every returned event changes state (the
// push() simulation drops no-ops), so an empty result means current == target.
//
// Precondition: same stream — tripId/name/members never differ between two
// states of one trip (no rename/membership commands exist in Phase 1).
export function diffTripStates(current: TripState, target: TripState): TripEvent[] {
  const events: TripEvent[] = [];
  let working = current;
  const push = (event: TripEvent): void => {
    const next = evolveTrip(working, event);
    if (!tripStatesEqual(next, working)) {
      events.push(event);
      working = next;
    }
  };

  // 1. Start date.
  if (working.startDate !== target.startDate) {
    push({
      type: "TripStartDateSet",
      version: 1,
      payload: { tripId: target.tripId, startDate: target.startDate },
    });
  }

  // 2. Activities that no longer exist in the target.
  for (const id of Object.keys(working.activities)) {
    if (target.activities[id] === undefined) {
      push({ type: "ActivityRemoved", version: 1, payload: { tripId: target.tripId, activityId: id } });
    }
  }

  // 3. Day reconciliation. DayAdded can only APPEND, and ordinals are derived
  //    from array position, so day order matters. Both states' day lists
  //    preserve the stream's original append order; the only order breaker is
  //    a day that must be re-created mid-list. From the first such day onward,
  //    every surviving day is removed and re-appended in target order.
  //    (DayRemoved sends its activities to the backlog; step 5 re-places them.)
  const targetDayIds = new Set(target.days.map((d) => d.dayId));
  for (const day of working.days) {
    if (!targetDayIds.has(day.dayId)) {
      push({ type: "DayRemoved", version: 1, payload: { tripId: target.tripId, dayId: day.dayId } });
    }
  }
  const survivorIds = new Set(working.days.filter((d) => targetDayIds.has(d.dayId)).map((d) => d.dayId));
  const firstMissing = target.days.findIndex((d) => !survivorIds.has(d.dayId));
  if (firstMissing !== -1) {
    for (const day of target.days.slice(firstMissing)) {
      if (survivorIds.has(day.dayId)) {
        push({ type: "DayRemoved", version: 1, payload: { tripId: target.tripId, dayId: day.dayId } });
      }
    }
    for (const day of target.days.slice(firstMissing)) {
      push({ type: "DayAdded", version: 1, payload: { tripId: target.tripId, dayId: day.dayId } });
    }
  }

  // 4. Activities that exist only in the target: add to the backlog (full
  //    target field set); step 5 puts every activity in its final place.
  for (const [id, a] of Object.entries(target.activities)) {
    if (working.activities[id] === undefined) {
      push({
        type: "ActivityAdded",
        version: 1,
        payload: {
          tripId: target.tripId,
          activityId: id,
          dayId: null,
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
        },
      });
    }
  }

  // 5. Field changes: full-snapshot update (ActivityUpdated replay semantics).
  for (const [id, a] of Object.entries(target.activities)) {
    const w = working.activities[id];
    if (w !== undefined && !activityStatesEqual(w, a)) {
      push({
        type: "ActivityUpdated",
        version: 1,
        payload: {
          tripId: target.tripId,
          activityId: id,
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
        },
      });
    }
  }

  // 6. Placement: rebuild every list in target order. Moving ids to positions
  //    0,1,2,… makes each list's prefix exactly match the target as we go;
  //    push() drops the moves that are already in place.
  for (const day of target.days) {
    day.activityIds.forEach((id, position) => {
      push({
        type: "ActivityMoved",
        version: 1,
        payload: { tripId: target.tripId, activityId: id, toDayId: day.dayId, position },
      });
    });
  }
  target.backlog.forEach((id, position) => {
    push({
      type: "ActivityMoved",
      version: 1,
      payload: { tripId: target.tripId, activityId: id, toDayId: null, position },
    });
  });

  // 7. Dismissals.
  for (const id of working.dismissedConflictIds) {
    if (!target.dismissedConflictIds.includes(id)) {
      push({ type: "ConflictUndismissed", version: 1, payload: { tripId: target.tripId, conflictId: id } });
    }
  }
  for (const id of target.dismissedConflictIds) {
    if (!working.dismissedConflictIds.includes(id)) {
      push({ type: "ConflictDismissed", version: 1, payload: { tripId: target.tripId, conflictId: id } });
    }
  }

  return events;
}
```

`packages/domain/src/index.ts` — add `export * from "./trip/diff";`.

- [ ] **Step 2: Write the property test**

`packages/domain/test/diff.property.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TripCommand, TripEvent } from "@tc/contracts";
import {
  decideTripCommand,
  detectConflicts,
  diffTripStates,
  evolveTrip,
  tripStatesEqual,
  type TripState,
} from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const CTX = { actorId: "u1" };
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY_IDS = [1, 2, 3].map((n) => uuid(100 + n));
const ACTIVITY_IDS = [1, 2, 3, 4, 5].map((n) => uuid(200 + n));
const WINDOWS = [null, { start: "09:00", end: "11:00" }, { start: "10:00", end: "12:00" }] as const;
const LOCATIONS = [
  null,
  { name: "Rome", lat: 41.9, lng: 12.5 },
  { name: "NYC", lat: 40.7, lng: -74.0 },
] as const;

// One raw op = a tuple of small integers the builder interprets against the
// CURRENT state, so most generated commands are valid; invalid ones are
// simply skipped (decide rejects them — including no-ops).
type RawOp = { op: number; a: number; b: number; c: number };
const rawOp = fc.record({
  op: fc.integer({ min: 0, max: 7 }),
  a: fc.integer({ min: 0, max: 4 }),
  b: fc.integer({ min: 0, max: 4 }),
  c: fc.integer({ min: 0, max: 5 }),
});

function buildCommand(state: TripState, raw: RawOp): TripCommand | null {
  const day = state.days[raw.a % Math.max(1, state.days.length)];
  const activityIds = Object.keys(state.activities).sort();
  const activity = activityIds[raw.a % Math.max(1, activityIds.length)];
  switch (raw.op) {
    case 0:
      return { type: "AddDay", tripId: TRIP, dayId: DAY_IDS[raw.a % DAY_IDS.length]! };
    case 1:
      return day ? { type: "RemoveDay", tripId: TRIP, dayId: day.dayId } : null;
    case 2:
      return { type: "SetTripStartDate", tripId: TRIP, startDate: raw.a === 0 ? null : `2026-10-0${(raw.a % 9) + 1}` };
    case 3:
      return {
        type: "AddActivity",
        tripId: TRIP,
        activityId: ACTIVITY_IDS[raw.a % ACTIVITY_IDS.length]!,
        dayId: raw.b === 0 || !day ? undefined : day.dayId,
        title: `Activity ${raw.a}`,
        timeWindow: WINDOWS[raw.b % WINDOWS.length] ?? undefined,
        location: LOCATIONS[raw.c % LOCATIONS.length] ?? undefined,
      };
    case 4:
      return activity
        ? {
            type: "UpdateActivity",
            tripId: TRIP,
            activityId: activity,
            title: `Renamed ${raw.b}`,
            timeWindow: WINDOWS[raw.c % WINDOWS.length],
          }
        : null;
    case 5:
      return activity
        ? {
            type: "MoveActivity",
            tripId: TRIP,
            activityId: activity,
            toDayId: raw.b === 0 || !day ? null : day.dayId,
            position: raw.c,
          }
        : null;
    case 6:
      return activity ? { type: "RemoveActivity", tripId: TRIP, activityId: activity } : null;
    case 7: {
      const live = detectConflicts(state).filter((c) => !state.dismissedConflictIds.includes(c.id));
      const target = live[raw.a % Math.max(1, live.length)];
      return target ? { type: "DismissConflict", tripId: TRIP, conflictId: target.id } : null;
    }
    default:
      return null;
  }
}

// Fold raw ops into a real, valid event history (starting with TripCreated).
function historyFrom(rawOps: RawOp[]): TripEvent[] {
  const events: TripEvent[] = [];
  let state: TripState | null = null;
  const create = decideTripCommand(null, { type: "CreateTrip", tripId: TRIP, name: "Prop trip" }, CTX);
  if (!create.ok) throw new Error("CreateTrip must succeed");
  for (const event of create.events) {
    events.push(event);
    state = evolveTrip(state, event);
  }
  for (const raw of rawOps) {
    const command = buildCommand(state!, raw);
    if (command === null) continue;
    const decision = decideTripCommand(state, command, CTX);
    if (!decision.ok) continue; // includes rejected no-ops — fine
    for (const event of decision.events) {
      events.push(event);
      state = evolveTrip(state, event);
    }
  }
  return events;
}

function foldTo(events: TripEvent[], count: number): TripState {
  let state: TripState | null = null;
  for (const event of events.slice(0, count)) state = evolveTrip(state, event);
  if (state === null) throw new Error("empty fold");
  return state;
}

describe("diffTripStates round-trip (THE M2 invariant)", () => {
  it("applying the diff to current reproduces the target exactly, for any history and any cut point", () => {
    fc.assert(
      fc.property(
        fc.array(rawOp, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        (rawOps, cutSeed) => {
          const events = historyFrom(rawOps);
          const cut = (cutSeed % events.length) + 1; // 1..length
          const current = foldTo(events, events.length);
          const target = foldTo(events, cut);
          const diff = diffTripStates(current, target);
          let result = current;
          for (const event of diff) result = evolveTrip(result, event);
          expect(tripStatesEqual(result, target)).toBe(true);
          // conflicts are a pure function of state, so they match too:
          expect(detectConflicts(result)).toEqual(detectConflicts(target));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("diff(x, x) is empty", () => {
    fc.assert(
      fc.property(fc.array(rawOp, { minLength: 1, maxLength: 30 }), (rawOps) => {
        const events = historyFrom(rawOps);
        const current = foldTo(events, events.length);
        expect(diffTripStates(current, current)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
```

- [ ] **Step 3: Run to green**

Run: `pnpm --filter @tc/domain test`
Expected: PASS (300 + 100 runs). If a counterexample appears, fc shrinks it — fix `diffTripStates` (most likely the day-reconciliation branch), never the test.

- [ ] **Step 4: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): diffTripStates with round-trip property test"
```

### Task 4: Domain — batches, undo/redo derivation, history command decide, descriptions

**Files:**
- Create: `packages/domain/src/trip/history.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/history.test.ts`

**Interfaces:**
- Consumes: `diffTripStates`, `evolveTrip`, Task 1's `EventEnvelope`/`Origin`/`HistoryEntry`.
- Produces (all pure; Task 5's pipeline and Task 6's reads consume these):
  - `foldEnvelopes(envelopes: EventEnvelope[], toSeq?: number): TripState | null`
  - `groupBatches(envelopes: EventEnvelope[]): Batch[]` where `Batch = { batchId, origin, fromSeq, toSeq, actorId, occurredAt, events: TripEvent[] }`
  - `deriveUndoRedo(batches: Batch[]): { undo: {batchId, targetSeq} | null; redo: {batchId, targetSeq} | null; undoneBatchIds: string[] }`
  - `decideHistoryCommand(envelopes, command: UndoLastChange | RedoChange | RevertToState): { ok: true; events: TripEvent[]; origin: Origin } | { ok: false; rejection: {code, message} }`
  - `buildHistoryEntries(envelopes: EventEnvelope[]): HistoryEntry[]` (oldest first — the API layer reverses)

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EventEnvelope, Origin, TripEvent } from "@tc/contracts";
import {
  buildHistoryEntries,
  decideHistoryCommand,
  decideTripCommand,
  deriveUndoRedo,
  evolveTrip,
  foldEnvelopes,
  groupBatches,
  tripStatesEqual,
  type TripState,
} from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const CTX = { actorId: "u1" };
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Pure pipeline simulator: run a command exactly like the server will
// (decide → append envelopes with batch metadata).
type Log = EventEnvelope[];
let nextBatch = 500;
function run(log: Log, input: unknown): Log {
  const state = foldEnvelopes(log);
  const command = input as never;
  const type = (input as { type: string }).type;
  let events: TripEvent[];
  let origin: Origin;
  if (type === "UndoLastChange" || type === "RedoChange" || type === "RevertToState") {
    const decision = decideHistoryCommand(log, command);
    if (!decision.ok) throw new Error(decision.rejection.code);
    events = decision.events;
    origin = decision.origin;
  } else {
    const decision = decideTripCommand(state, command, CTX);
    if (!decision.ok) throw new Error(decision.rejection.code);
    events = decision.events;
    origin = { kind: "user" };
  }
  const batchId = uuid(nextBatch++);
  return [
    ...log,
    ...events.map((e, i) => ({
      streamId: TRIP,
      seq: log.length + 1 + i,
      type: e.type,
      version: e.version,
      payload: e.payload,
      actorId: "u1",
      occurredAt: "2026-07-08T00:00:00.000Z",
      batchId,
      origin,
    })),
  ];
}

function freshTrip(): Log {
  let log = run([], { type: "CreateTrip", tripId: TRIP, name: "Rome" });
  log = run(log, { type: "AddDay", tripId: TRIP, dayId: DAY });
  log = run(log, { type: "AddActivity", tripId: TRIP, activityId: A1, title: "Colosseum" });
  return log; // 3 batches: create, day, activity (activity in backlog)
}

function state(log: Log): TripState {
  const s = foldEnvelopes(log);
  if (s === null) throw new Error("empty");
  return s;
}

describe("deriveUndoRedo", () => {
  it("initial batch is never undoable; nothing to redo initially", () => {
    const log = run([], { type: "CreateTrip", tripId: TRIP, name: "Rome" });
    const targets = deriveUndoRedo(groupBatches(log));
    expect(targets.undo).toBeNull();
    expect(targets.redo).toBeNull();
  });

  it("undo targets the last effective batch; redo appears after undo; new change clears redo", () => {
    let log = freshTrip();
    const before = state(log);
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // undoes AddActivity
    expect(state(log).activities[A1]).toBeUndefined();
    let targets = deriveUndoRedo(groupBatches(log));
    expect(targets.redo).not.toBeNull();
    expect(targets.undoneBatchIds).toHaveLength(1);

    log = run(log, { type: "RedoChange", tripId: TRIP });
    expect(tripStatesEqual(state(log), before)).toBe(true); // undo∘redo = identity

    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // undo the redo's target again
    log = run(log, { type: "AddDay", tripId: TRIP, dayId: uuid(900) }); // new change...
    targets = deriveUndoRedo(groupBatches(log));
    expect(targets.redo).toBeNull(); // ...clears redo
  });

  it("undo bottoms out at the creation batch", () => {
    let log = freshTrip();
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // activity
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // day
    const targets = deriveUndoRedo(groupBatches(log));
    expect(targets.undo).toBeNull();
    expect(() => run(log, { type: "UndoLastChange", tripId: TRIP })).toThrow("nothing-to-undo");
  });

  it("a revert is itself an effective, undoable action", () => {
    let log = freshTrip();
    const before = state(log);
    log = run(log, { type: "RevertToState", tripId: TRIP, toSeq: 1 }); // back to bare trip
    expect(state(log).days).toHaveLength(0);
    log = run(log, { type: "UndoLastChange", tripId: TRIP }); // undo the revert
    expect(tripStatesEqual(state(log), before)).toBe(true);
  });
});

describe("decideHistoryCommand rejections", () => {
  it("rejects revert to the current state and to nonexistent seqs", () => {
    const log = freshTrip();
    const atCurrent = decideHistoryCommand(log, { type: "RevertToState", tripId: TRIP, toSeq: log.length });
    expect(atCurrent.ok).toBe(false);
    if (!atCurrent.ok) expect(atCurrent.rejection.code).toBe("already-at-that-state");
    const beyond = decideHistoryCommand(log, { type: "RevertToState", tripId: TRIP, toSeq: 99 });
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.rejection.code).toBe("invalid-revert-target");
  });

  it("rejects redo when there is nothing to redo", () => {
    const decision = decideHistoryCommand(freshTrip(), { type: "RedoChange", tripId: TRIP });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.rejection.code).toBe("nothing-to-redo");
  });
});

describe("buildHistoryEntries", () => {
  it("groups per batch, describes in domain language, marks undone entries", () => {
    let log = freshTrip();
    log = run(log, { type: "UndoLastChange", tripId: TRIP });
    const entries = buildHistoryEntries(log);
    expect(entries.map((e) => e.description)).toEqual([
      'Created trip "Rome"',
      "Added Day 1",
      'Added "Colosseum" to the backlog',
      'Undid: Added "Colosseum" to the backlog',
    ]);
    expect(entries[2]!.undone).toBe(true);
    expect(entries[3]!.origin.kind).toBe("undo");
  });

  it("a revert renders as ONE entry, not an event burst", () => {
    let log = freshTrip();
    log = run(log, { type: "RevertToState", tripId: TRIP, toSeq: 1 });
    const entries = buildHistoryEntries(log);
    expect(entries[entries.length - 1]!.description).toBe("Reverted to version 1");
    // the revert batch's several compensating events collapsed into one entry:
    expect(entries).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

`packages/domain/src/trip/history.ts`:

```ts
import {
  TripEvent as TripEventSchema,
  type EventEnvelope,
  type HistoryEntry,
  type Origin,
  type RedoChange,
  type RevertToState,
  type TripEvent,
  type UndoLastChange,
} from "@tc/contracts";
import type { Rejection } from "./decide";
import { diffTripStates } from "./diff";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

export function foldEnvelopes(envelopes: EventEnvelope[], toSeq?: number): TripState | null {
  let state: TripState | null = null;
  for (const env of envelopes) {
    if (toSeq !== undefined && env.seq > toSeq) break;
    state = evolveTrip(
      state,
      TripEventSchema.parse({ type: env.type, version: env.version, payload: env.payload }),
    );
  }
  return state;
}

export type Batch = {
  batchId: string;
  origin: Origin;
  fromSeq: number;
  toSeq: number;
  actorId: string;
  occurredAt: string;
  events: TripEvent[];
};

// Envelopes arrive seq-ordered; a batch is a contiguous run sharing a batchId
// (batchIds are per-command uuids, so equal-and-adjacent means same command).
export function groupBatches(envelopes: EventEnvelope[]): Batch[] {
  const batches: Batch[] = [];
  for (const env of envelopes) {
    const event = TripEventSchema.parse({ type: env.type, version: env.version, payload: env.payload });
    const last = batches[batches.length - 1];
    if (last !== undefined && last.batchId === env.batchId) {
      last.toSeq = env.seq;
      last.events.push(event);
    } else {
      batches.push({
        batchId: env.batchId,
        origin: env.origin,
        fromSeq: env.seq,
        toSeq: env.seq,
        actorId: env.actorId,
        occurredAt: env.occurredAt,
        events: [event],
      });
    }
  }
  return batches;
}

export type UndoRedoTargets = {
  undo: { batchId: string; targetSeq: number } | null;
  redo: { batchId: string; targetSeq: number } | null;
  undoneBatchIds: string[];
};

// Standard editor stack semantics, derived purely from provenance:
// user/revert batches push onto the done stack and clear the redo stack;
// an undo moves the top of done onto the redo stack; a redo moves it back.
// Every batch is state-changing (decide's no-op guard), so this bookkeeping
// mirrors state exactly. The creation batch is never undoable.
export function deriveUndoRedo(batches: Batch[]): UndoRedoTargets {
  const done: Batch[] = [];
  const undone: Batch[] = [];
  for (const batch of batches) {
    switch (batch.origin.kind) {
      case "user":
      case "revert":
        done.push(batch);
        undone.length = 0;
        break;
      case "undo": {
        const popped = done.pop();
        if (popped !== undefined) undone.push(popped);
        break;
      }
      case "redo": {
        const popped = undone.pop();
        if (popped !== undefined) done.push(popped);
        break;
      }
    }
  }
  const top = done[done.length - 1];
  const redoTop = undone[undone.length - 1];
  return {
    // undoing batch B = revert to the state just before B first applied
    undo: top !== undefined && top !== batches[0] ? { batchId: top.batchId, targetSeq: top.fromSeq - 1 } : null,
    // redoing batch B = revert to the state just after B first applied
    redo: redoTop !== undefined ? { batchId: redoTop.batchId, targetSeq: redoTop.toSeq } : null,
    undoneBatchIds: undone.map((b) => b.batchId),
  };
}

export type HistoryCommand = UndoLastChange | RedoChange | RevertToState;
export type HistoryDecision =
  | { ok: true; events: TripEvent[]; origin: Origin }
  | { ok: false; rejection: Rejection };

function rejectHistory(code: string, message: string): HistoryDecision {
  return { ok: false, rejection: { code, message } };
}

export function decideHistoryCommand(
  envelopes: EventEnvelope[],
  command: HistoryCommand,
): HistoryDecision {
  const current = foldEnvelopes(envelopes);
  if (current === null) return rejectHistory("trip-not-found", "This trip does not exist.");
  const targets = deriveUndoRedo(groupBatches(envelopes));

  switch (command.type) {
    case "UndoLastChange": {
      if (targets.undo === null) return rejectHistory("nothing-to-undo", "There is nothing to undo.");
      const target = foldEnvelopes(envelopes, targets.undo.targetSeq);
      if (target === null) return rejectHistory("nothing-to-undo", "There is nothing to undo.");
      const events = diffTripStates(current, target);
      if (events.length === 0) return rejectHistory("nothing-to-undo", "There is nothing to undo.");
      return { ok: true, events, origin: { kind: "undo", undoesBatchId: targets.undo.batchId } };
    }
    case "RedoChange": {
      if (targets.redo === null) return rejectHistory("nothing-to-redo", "There is nothing to redo.");
      const target = foldEnvelopes(envelopes, targets.redo.targetSeq);
      if (target === null) return rejectHistory("nothing-to-redo", "There is nothing to redo.");
      const events = diffTripStates(current, target);
      if (events.length === 0) return rejectHistory("nothing-to-redo", "There is nothing to redo.");
      return { ok: true, events, origin: { kind: "redo", redoesBatchId: targets.redo.batchId } };
    }
    case "RevertToState": {
      const head = envelopes[envelopes.length - 1]?.seq ?? 0;
      if (command.toSeq > head) {
        return rejectHistory("invalid-revert-target", "That version does not exist.");
      }
      const target = foldEnvelopes(envelopes, command.toSeq);
      if (target === null) return rejectHistory("invalid-revert-target", "That version does not exist.");
      const events = diffTripStates(current, target);
      if (events.length === 0) {
        return rejectHistory("already-at-that-state", "The trip already matches that version.");
      }
      return { ok: true, events, origin: { kind: "revert", toSeq: command.toSeq } };
    }
  }
}

// ---- Human-readable history ----

function dayLabel(state: TripState | null, dayId: string): string {
  const index = state?.days.findIndex((d) => d.dayId === dayId) ?? -1;
  return index === -1 ? "a removed day" : `Day ${index + 1}`;
}

// `state` is the state BEFORE the event — names resolve even when a payload
// carries only ids (e.g. ActivityMoved).
function describeEvent(state: TripState | null, event: TripEvent): string {
  switch (event.type) {
    case "TripCreated":
      return `Created trip "${event.payload.name}"`;
    case "DayAdded":
      return `Added Day ${(state?.days.length ?? 0) + 1}`;
    case "DayRemoved":
      return `Removed ${dayLabel(state, event.payload.dayId)}`;
    case "TripStartDateSet":
      return event.payload.startDate === null
        ? "Cleared the start date"
        : `Set the start date to ${event.payload.startDate}`;
    case "ActivityAdded":
      return `Added "${event.payload.title}" to ${
        event.payload.dayId === null ? "the backlog" : dayLabel(state, event.payload.dayId)
      }`;
    case "ActivityUpdated":
      return `Edited "${event.payload.title}"`;
    case "ActivityMoved": {
      const title = state?.activities[event.payload.activityId]?.title ?? "an activity";
      return `Moved "${title}" to ${
        event.payload.toDayId === null ? "the backlog" : dayLabel(state, event.payload.toDayId)
      }`;
    }
    case "ActivityRemoved":
      return `Removed "${state?.activities[event.payload.activityId]?.title ?? "an activity"}"`;
    case "ConflictDismissed":
      return "Dismissed a conflict";
    case "ConflictUndismissed":
      return "Restored a conflict";
  }
}

function describeBatch(
  stateBefore: TripState | null,
  batch: Batch,
  priorDescriptions: ReadonlyMap<string, string>,
): string {
  switch (batch.origin.kind) {
    case "undo":
      return `Undid: ${priorDescriptions.get(batch.origin.undoesBatchId) ?? "an earlier change"}`;
    case "redo":
      return `Redid: ${priorDescriptions.get(batch.origin.redoesBatchId) ?? "an earlier change"}`;
    case "revert":
      return `Reverted to version ${batch.origin.toSeq}`;
    case "user": {
      const parts: string[] = [];
      let state = stateBefore;
      for (const event of batch.events) {
        parts.push(describeEvent(state, event));
        state = evolveTrip(state, event);
      }
      return parts.join("; ");
    }
  }
}

// Oldest first (natural log order); the API layer reverses for display.
export function buildHistoryEntries(envelopes: EventEnvelope[]): HistoryEntry[] {
  const batches = groupBatches(envelopes);
  const undoneSet = new Set(deriveUndoRedo(batches).undoneBatchIds);
  const descriptions = new Map<string, string>();
  const entries: HistoryEntry[] = [];
  let state: TripState | null = null;
  for (const batch of batches) {
    const description = describeBatch(state, batch, descriptions);
    descriptions.set(batch.batchId, description);
    for (const event of batch.events) state = evolveTrip(state, event);
    entries.push({
      batchId: batch.batchId,
      fromSeq: batch.fromSeq,
      toSeq: batch.toSeq,
      actorId: batch.actorId,
      occurredAt: batch.occurredAt,
      origin: batch.origin,
      description,
      undone: undoneSet.has(batch.batchId),
    });
  }
  return entries;
}
```

`packages/domain/src/index.ts` — add `export * from "./trip/history";`.

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @tc/domain test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): batch grouping, undo/redo derivation, history decide, descriptions"
```

### Task 5: Server — provenance columns, backfill migration, pipeline dispatch, golden extension

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`, `apps/web/src/server/eventStore.ts`, `apps/web/src/server/commands.ts`
- Create: `apps/web/drizzle/0002_*.sql` (generated, then hand-edited for the backfill)
- Modify: `apps/web/src/server/eventStore.int.test.ts` (compile fixes: new append args), `apps/web/src/server/commands.int.test.ts` (golden extension + new flows)

**Interfaces:**
- Consumes: Task 4's `decideHistoryCommand`, `foldEnvelopes`; Task 1's `Origin`.
- Produces: `appendToStream` takes `batchId: string` and `origin: Origin`; `executeTripCommand` accepts all M2 commands; every stored event row carries provenance. The migration rides Task 0b's automation.

- [ ] **Step 1: Schema + migration**

`apps/web/src/server/db/schema.ts` — `events` gains (after `occurredAt`):

```ts
    batchId: uuid("batch_id").notNull(),
    origin: jsonb("origin").$type<Origin>().notNull(),
```

with `import type { Origin, TripDetail, TripMember } from "@tc/contracts";`.

Generate, then hand-edit for the backfill (existing M0/M1 events become single-event `user` batches — the spec's decision):

```bash
pnpm --filter web db:generate
```

Replace the generated `apps/web/drizzle/0002_*.sql` content with:

```sql
ALTER TABLE "events" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "origin" jsonb;--> statement-breakpoint
UPDATE "events" SET "batch_id" = gen_random_uuid(), "origin" = '{"kind":"user"}'::jsonb;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "batch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "origin" SET NOT NULL;
```

Apply locally: `pnpm --filter web db:migrate` (Docker PG up). Expected: success; re-running is a no-op.

- [ ] **Step 2: Event store**

`apps/web/src/server/eventStore.ts` — `appendToStream` args gain `batchId: string; origin: Origin;` (import `type { EventEnvelope, Origin } from "@tc/contracts"`), the `values()` mapping gains `batchId: args.batchId, origin: args.origin`, and `toEnvelope` gains `batchId: row.batchId, origin: row.origin`.

- [ ] **Step 3: Pipeline dispatch**

`apps/web/src/server/commands.ts` — full new content:

```ts
import { TripCommand, type Origin, type TripEvent } from "@tc/contracts";
import {
  decideHistoryCommand,
  decideTripCommand,
  foldEnvelopes,
  tripDetailFromState,
} from "@tc/domain";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";
import { applyTripEvents, upsertTripDetail } from "./projections";
import { soleMemberPolicy } from "./accessPolicy";

export type CommandResult =
  | { ok: true; tripId: string }
  | { ok: false; error: { code: string; message: string } };

// The command pipeline (docs/guidelines/building-the-parts.md). Every write
// in the planning domain goes through this exact sequence — including undo,
// redo, and revert, which differ ONLY in how step 4 decides (ADR-005).
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
    const state = foldEnvelopes(history);

    // 3. authorize via the AccessPolicy seam
    if (!soleMemberPolicy.canExecute(actorId, command.type, state?.members ?? null)) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    // 4. decide — history commands need the envelope history (already loaded;
    //    zero extra I/O), everything else the folded state.
    let events: TripEvent[];
    let origin: Origin;
    if (
      command.type === "UndoLastChange" ||
      command.type === "RedoChange" ||
      command.type === "RevertToState"
    ) {
      const decision = decideHistoryCommand(history, command);
      if (!decision.ok) return { ok: false, error: decision.rejection };
      events = decision.events;
      origin = decision.origin;
    } else {
      const decision = decideTripCommand(state, command, { actorId });
      if (!decision.ok) return { ok: false, error: decision.rejection };
      events = decision.events;
      origin = { kind: "user" };
    }

    // 5. append with optimistic concurrency (one batch per command execution)
    const appended = await appendToStream(tx, {
      streamId: command.tripId,
      expectedSeq: history.length,
      events,
      actorId,
      occurredAt: new Date().toISOString(),
      batchId: crypto.randomUUID(),
      origin,
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
    //    — a revert into a formerly-conflicted state resurfaces its badges here.
    const nextState = foldEnvelopes([...history, ...appended.envelopes]);
    if (nextState === null) throw new Error("state cannot be null after an accepted command");
    const firstEnvelope = history[0] ?? appended.envelopes[0];
    if (firstEnvelope === undefined) throw new Error("append returned no envelopes");
    await upsertTripDetail(tx, tripDetailFromState(nextState, firstEnvelope.occurredAt));

    return { ok: true, tripId: command.tripId };
  });
}
```

- [ ] **Step 4: Fix compile errors in existing integration tests**

`apps/web/src/server/eventStore.int.test.ts` calls `appendToStream` directly — add `batchId: crypto.randomUUID(), origin: { kind: "user" }` to each call's args. No behavioral changes.

- [ ] **Step 5: Extend `commands.int.test.ts` — history flows + golden + race**

Append to the existing describe block (reuse its setup helpers/user ids as found in the file):

```ts
  it("undo → redo → revert flow through the one pipeline", async () => {
    const tripId = crypto.randomUUID();
    const dayId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    expect((await run({ type: "CreateTrip", tripId, name: "History trip" })).ok).toBe(true);
    expect((await run({ type: "AddDay", tripId, dayId })).ok).toBe(true);
    expect((await run({ type: "AddActivity", tripId, activityId, dayId, title: "Colosseum" })).ok).toBe(true);

    expect((await run({ type: "UndoLastChange", tripId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.activities[activityId]).toBeUndefined();

    expect((await run({ type: "RedoChange", tripId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.activities[activityId]).toBeDefined();

    expect((await run({ type: "RevertToState", tripId, toSeq: 1 })).ok).toBe(true);
    const reverted = await getTripDetail(tripId);
    expect(reverted?.days).toEqual([]);
    expect(Object.keys(reverted?.activities ?? {})).toEqual([]);

    const noop = await run({ type: "RevertToState", tripId, toSeq: 1 });
    expect(noop.ok).toBe(false);
    if (!noop.ok) expect(noop.error.code).toBe("already-at-that-state");
  });

  it("dismissal persists through the projection and is revertible", async () => {
    const tripId = crypto.randomUUID();
    const dayId = crypto.randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Dismiss trip" });
    await run({ type: "AddDay", tripId, dayId });
    await run({ type: "AddActivity", tripId, activityId: crypto.randomUUID(), dayId, title: "A", timeWindow: { start: "09:00", end: "11:00" } });
    await run({ type: "AddActivity", tripId, activityId: crypto.randomUUID(), dayId, title: "B", timeWindow: { start: "10:00", end: "12:00" } });
    const conflicted = await getTripDetail(tripId);
    const conflictId = conflicted?.conflicts[0]?.id;
    expect(conflictId).toBeDefined();
    expect((await run({ type: "DismissConflict", tripId, conflictId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.dismissedConflictIds).toEqual([conflictId]);
    expect((await run({ type: "UndoLastChange", tripId })).ok).toBe(true);
    expect((await getTripDetail(tripId))?.dismissedConflictIds).toEqual([]);
  });

  it("a history command racing a concurrent write serializes or returns the typed conflict", async () => {
    const tripId = crypto.randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Race trip" });
    await run({ type: "AddDay", tripId, dayId: crypto.randomUUID() });
    const [undo, add] = await Promise.all([
      run({ type: "UndoLastChange", tripId }),
      run({ type: "AddDay", tripId, dayId: crypto.randomUUID() }),
    ]);
    const failures = [undo, add].filter((r) => !r.ok);
    for (const f of failures) {
      if (!f.ok) expect(f.error.code).toBe("concurrency-conflict");
    }
    // Whatever interleaving happened, the store must be consistent:
    const detail = await getTripDetail(tripId);
    expect(detail).not.toBeNull();
  });
```

Extend the existing golden test (`commands.int.test.ts:132`, "GOLDEN: rebuild from the log equals the live projections"): inside it, after the current scripted commands, run one dismissal, one undo, one redo, and one revert (as in the flows above) **before** the `rebuildProjections()` call, so the golden log contains all four batch kinds. The assertion (stored equals rebuilt) stays exactly as is.

- [ ] **Step 6: Run integration suite**

Run: `docker compose up -d && pnpm --filter web db:migrate && pnpm --filter web test:int && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/server apps/web/drizzle
git commit -m "feat(server): provenance columns + history commands through the pipeline"
```

### Task 6: Server — history and replay-preview endpoints

**Files:**
- Create: `apps/web/src/server/history.ts`, `apps/web/src/app/api/trips/[tripId]/history/route.ts`, `apps/web/src/app/api/trips/[tripId]/history/[seq]/route.ts`
- Test: `apps/web/src/server/history.int.test.ts`

**Interfaces:**
- Consumes: Task 4's pure functions, existing `readStream`/`getTripDetail`/`auth`.
- Produces:
  - `getTripHistory(tripId): Promise<TripHistory | null>` — entries **newest first**.
  - `getTripDetailAt(tripId, seq): Promise<TripDetail | null>` — replayed detail, conflicts recomputed for that state.
  - `GET /api/trips/[tripId]/history` → `{ history: TripHistory }`; `GET /api/trips/[tripId]/history/[seq]` → `{ trip: TripDetail }`. Both 401 unauthenticated, 403 non-member, 404 unknown trip/seq. Task 7's client consumes these shapes.

- [ ] **Step 1: Server read module**

`apps/web/src/server/history.ts`:

```ts
import type { TripDetail, TripHistory } from "@tc/contracts";
import {
  buildHistoryEntries,
  deriveUndoRedo,
  foldEnvelopes,
  groupBatches,
  tripDetailFromState,
} from "@tc/domain";
import { db } from "./db/client";
import { readStream } from "./eventStore";

// Read-side of ADR-005: both queries are pure replays of the log — no new
// storage. Route handlers may not import @tc/domain (lint wall); they call this.
export async function getTripHistory(tripId: string): Promise<TripHistory | null> {
  const envelopes = await readStream(db, tripId);
  if (envelopes.length === 0) return null;
  const targets = deriveUndoRedo(groupBatches(envelopes));
  return {
    tripId,
    entries: buildHistoryEntries(envelopes).reverse(),
    canUndo: targets.undo !== null,
    canRedo: targets.redo !== null,
  };
}

export async function getTripDetailAt(tripId: string, seq: number): Promise<TripDetail | null> {
  const envelopes = await readStream(db, tripId);
  if (envelopes.length === 0 || !Number.isInteger(seq) || seq < 1 || seq > envelopes.length) {
    return null;
  }
  const state = foldEnvelopes(envelopes, seq);
  if (state === null) return null;
  return tripDetailFromState(state, envelopes[0]!.occurredAt);
}
```

- [ ] **Step 2: Routes**

`apps/web/src/app/api/trips/[tripId]/history/route.ts`:

```ts
import { TripHistory } from "@tc/contracts";
import { auth } from "@/server/auth";
import { getTripHistory } from "@/server/history";
import { getTripDetail } from "@/server/projections";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId } = await params;
  const detail = await getTripDetail(tripId);
  if (detail === null) return Response.json({ error: "not-found" }, { status: 404 });
  const userId = session.user.id;
  if (!detail.members.some((m) => m.userId === userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const history = await getTripHistory(tripId);
  if (history === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ history: TripHistory.parse(history) });
}
```

`apps/web/src/app/api/trips/[tripId]/history/[seq]/route.ts`:

```ts
import { TripDetail } from "@tc/contracts";
import { auth } from "@/server/auth";
import { getTripDetailAt } from "@/server/history";
import { getTripDetail } from "@/server/projections";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; seq: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { tripId, seq } = await params;
  const detail = await getTripDetail(tripId);
  if (detail === null) return Response.json({ error: "not-found" }, { status: 404 });
  const userId = session.user.id;
  if (!detail.members.some((m) => m.userId === userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const at = await getTripDetailAt(tripId, Number(seq));
  if (at === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ trip: TripDetail.parse(at) });
}
```

- [ ] **Step 3: Integration tests**

`apps/web/src/server/history.int.test.ts` (mirror the DB setup/teardown pattern of `commands.int.test.ts` exactly — same imports, same beforeEach truncation if present):

```ts
import { describe, expect, it } from "vitest";
import { executeTripCommand } from "./commands";
import { getTripDetailAt, getTripHistory } from "./history";

describe("history reads", () => {
  it("returns batch-grouped entries newest-first with undo/redo availability", async () => {
    const tripId = crypto.randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Readable" });
    await run({ type: "AddDay", tripId, dayId: crypto.randomUUID() });
    await run({ type: "UndoLastChange", tripId });

    const history = await getTripHistory(tripId);
    expect(history).not.toBeNull();
    expect(history!.entries.map((e) => e.description)).toEqual([
      "Undid: Added Day 1",
      "Added Day 1",
      'Created trip "Readable"',
    ]);
    expect(history!.entries[1]!.undone).toBe(true);
    expect(history!.canUndo).toBe(false); // only the creation batch remains effective
    expect(history!.canRedo).toBe(true);
  });

  it("replays detail at a seq, conflicts recomputed", async () => {
    const tripId = crypto.randomUUID();
    const dayId = crypto.randomUUID();
    const run = (input: unknown) => executeTripCommand(input, "int-user");
    await run({ type: "CreateTrip", tripId, name: "Replay" });
    await run({ type: "AddDay", tripId, dayId }); // seq 2
    await run({ type: "AddActivity", tripId, activityId: crypto.randomUUID(), dayId, title: "A", timeWindow: { start: "09:00", end: "11:00" } });
    await run({ type: "AddActivity", tripId, activityId: crypto.randomUUID(), dayId, title: "B", timeWindow: { start: "10:00", end: "12:00" } });

    const beforeActivities = await getTripDetailAt(tripId, 2);
    expect(Object.keys(beforeActivities!.activities)).toEqual([]);
    expect(beforeActivities!.conflicts).toEqual([]);
    const atHead = await getTripDetailAt(tripId, 4);
    expect(atHead!.conflicts).toHaveLength(1);
    expect(await getTripDetailAt(tripId, 99)).toBeNull();
    expect(await getTripDetailAt(tripId, 0)).toBeNull();
  });
});
```

- [ ] **Step 4: Run**

Run: `pnpm --filter web test:int && pnpm typecheck && pnpm lint`
Expected: PASS (lint proves the lint wall accepts the new routes — they import only `@/server/*` and contracts).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server apps/web/src/app/api
git commit -m "feat(server): history and replay-preview endpoints"
```

### Task 7: UI — API client + MSW handlers for history

**Files:**
- Modify: `apps/web/src/lib/apiClient.ts`, `apps/web/src/mocks/handlers.ts`, `apps/web/src/mocks/fixtures.ts`
- Test: `apps/web/src/lib/apiClient.test.ts` (extend, following its existing MSW pattern)

**Interfaces:**
- Consumes: Task 6 endpoint shapes, Task 1 DTOs.
- Produces (used by Tasks 8–9):
  - `fetchTripHistory(tripId): Promise<ApiResult<TripHistory>>`
  - `fetchTripDetailAt(tripId, seq): Promise<ApiResult<TripDetail>>`
  - `makeTripHandlers(initial, options?)` gains `options: { history?: TripHistory; detailAt?: Record<number, TripDetail>; onCommand?: (command: TripCommand) => void }`, serves the two history GETs, applies `DismissConflict` to the mock detail, and treats `UndoLastChange`/`RedoChange`/`RevertToState` as accepted no-ops (recorded via `onCommand` — real semantics live in `@tc/domain`, which mocks may not import).

- [ ] **Step 1: apiClient additions** (below `sendTripCommand`, same style):

```ts
export async function fetchTripHistory(tripId: string): Promise<ApiResult<TripHistory>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/history`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { history: unknown };
  return { ok: true, value: TripHistory.parse(data.history) };
}

export async function fetchTripDetailAt(tripId: string, seq: number): Promise<ApiResult<TripDetail>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/history/${seq}`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { trip: unknown };
  return { ok: true, value: TripDetail.parse(data.trip) };
}
```

(import `TripHistory` from `@tc/contracts` alongside `TripDetail`).

- [ ] **Step 2: Mock handlers**

`apps/web/src/mocks/handlers.ts` — `makeTripHandlers` signature becomes:

```ts
export function makeTripHandlers(
  initial: TripDetail,
  options?: {
    history?: TripHistory;
    detailAt?: Record<number, TripDetail>;
    onCommand?: (command: TripCommand) => void;
  },
) {
```

`applyMock` gains cases (before `case "CreateTrip"`):

```ts
    case "DismissConflict":
      next.dismissedConflictIds = [...next.dismissedConflictIds, command.conflictId].sort();
      break;
    case "UndoLastChange":
    case "RedoChange":
    case "RevertToState":
      break; // accepted no-ops in mocks; component tests assert via onCommand
```

The POST handler calls `options?.onCommand?.(command);` before `applyMock`. Add two GET handlers to the returned array:

```ts
    http.get("/api/trips/:tripId/history", () =>
      HttpResponse.json({
        history:
          options?.history ?? { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false },
      }),
    ),
    http.get("/api/trips/:tripId/history/:seq", ({ params }) => {
      const at = options?.detailAt?.[Number(params.seq)];
      return at !== undefined
        ? HttpResponse.json({ trip: at })
        : HttpResponse.json({ error: "not-found" }, { status: 404 });
    }),
```

`apps/web/src/mocks/fixtures.ts`: add a reusable `historyFixture(tripId): TripHistory` exporting three entries (newest first: an undone "Added "Colosseum" to the backlog" user entry, an undo entry `Undid: …`, and the creation entry) with `canUndo: true, canRedo: true` — concrete values matching the Task 1 schema, uuids from the existing fixture pool.

- [ ] **Step 3: Extend `apiClient.test.ts`** with two cases following its existing pattern: `fetchTripHistory` returns parsed history from the mock; `fetchTripDetailAt` returns 404 → `ok: false, status: 404` for an unknown seq and the fixture detail for a known one.

- [ ] **Step 4: Run**

Run: `pnpm --filter web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib apps/web/src/mocks
git commit -m "feat(web): history api client + msw handlers"
```

### Task 8: UI — undo/redo controls, keyboard shortcuts, persistent dismissal

**Files:**
- Create: `apps/web/src/components/board/UndoRedoControls.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx`, `apps/web/src/components/board/Board.tsx`, `apps/web/src/components/board/ConflictBanner.tsx`
- Test: `apps/web/src/components/board/board.test.tsx` (update the dismissal test), `apps/web/src/components/board/UndoRedoControls.test.tsx` (create)

**Interfaces:**
- Consumes: Task 7 client + mocks.
- Produces:
  - `UndoRedoControls({ canUndo, canRedo, onUndo, onRedo })` — two buttons with accessible names **"Undo"** and **"Redo"** (the e2e script depends on these names), plus a window `keydown` listener: `Cmd/Ctrl+Z` → undo, `Shift+Cmd/Ctrl+Z` → redo, ignored while typing in `input`/`textarea`/`select`/`[contenteditable]`.
  - `ConflictBanner` becomes controlled: `{ conflicts, dismissedConflictIds, onDismiss }`, no local state.
  - `Board` gains `onDismissConflict` in its callbacks and threads `trip.dismissedConflictIds` to the banner.
  - `TripBoardScreen` loads `TripHistory` alongside the detail (both refetched after every dispatch) and wires everything.

- [ ] **Step 1: Update the failing test first** — in `board.test.tsx`, the M1 dismissal test (`board.test.tsx:60`) currently asserts client-local hiding. Change it to render with `makeTripHandlers(fixture, { onCommand })` and assert that clicking the dismiss button (a) sends `{ type: "DismissConflict", conflictId: <fixture conflict id> }` via `onCommand`, and (b) the banner row disappears after the refetch (the mock's `applyMock` now records the dismissal in `dismissedConflictIds`).

Create `UndoRedoControls.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UndoRedoControls } from "./UndoRedoControls";

describe("UndoRedoControls", () => {
  it("buttons reflect availability and fire callbacks", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<UndoRedoControls canUndo={true} canRedo={false} onUndo={onUndo} onRedo={onRedo} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes, typing contexts are ignored", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <div>
        <input aria-label="probe" />
        <UndoRedoControls canUndo={true} canRedo={true} onUndo={onUndo} onRedo={onRedo} />
      </div>,
    );
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("probe"), { key: "z", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1); // unchanged
  });
});
```

Run: `pnpm --filter web test` — expected: FAIL (component missing, old dismissal expectation).

- [ ] **Step 2: Implement**

`apps/web/src/components/board/UndoRedoControls.tsx`:

```tsx
"use client";

import { useEffect } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

export function UndoRedoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo) onRedo();
      } else if (canUndo) {
        onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo]);

  return (
    <span>
      <button onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (⌘Z)">
        ↺ Undo
      </button>{" "}
      <button onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
        ↻ Redo
      </button>
    </span>
  );
}
```

`ConflictBanner.tsx` — full new content (controlled; the M1 stopgap comment goes away):

```tsx
"use client";

import type { Conflict } from "@tc/contracts";

// Conflicts are data, never blocking modals (AGENTS.md invariant 3).
// Dismissal is a real command since M2 — it persists, appears in history,
// and is undoable like any other change.
export function ConflictBanner({
  conflicts,
  dismissedConflictIds,
  onDismiss,
}: {
  conflicts: Conflict[];
  dismissedConflictIds: string[];
  onDismiss: (conflictId: string) => void;
}) {
  const visible = conflicts.filter((c) => !dismissedConflictIds.includes(c.id));
  if (visible.length === 0) return null;
  return (
    <aside
      role="status"
      style={{ border: "1px solid #e0a800", background: "#fff8e1", borderRadius: 6, padding: 8, marginBottom: 12 }}
    >
      {visible.map((c) => (
        <p key={c.id} style={{ margin: "4px 0" }}>
          ⚠️ {c.description} <em>({c.resolutions.join(" · ")})</em>{" "}
          <button onClick={() => onDismiss(c.id)} aria-label={`Dismiss: ${c.description}`}>
            Dismiss
          </button>
        </p>
      ))}
    </aside>
  );
}
```

`Board.tsx` — the callbacks prop type gains `onDismissConflict: (conflictId: string) => void;` and line 77 becomes:

```tsx
      <ConflictBanner
        conflicts={trip.conflicts}
        dismissedConflictIds={trip.dismissedConflictIds}
        onDismiss={callbacks.onDismissConflict}
      />
```

`TripBoardScreen.tsx` — changes:
- also fetch history: add `const [history, setHistory] = useState<TripHistory | null>(null);` and inside `load()` fetch both (`Promise.all([fetchTripDetail(tripId), fetchTripHistory(tripId)])`), setting both states (history errors are non-fatal: `setHistory(result.ok ? result.value : null)`).
- render, next to `StartDateControl`:

```tsx
      <UndoRedoControls
        canUndo={history?.canUndo ?? false}
        canRedo={history?.canRedo ?? false}
        onUndo={() => void dispatch({ type: "UndoLastChange", tripId })}
        onRedo={() => void dispatch({ type: "RedoChange", tripId })}
      />
```

- add to the `Board` callbacks object:

```tsx
          onDismissConflict: (conflictId) => void dispatch({ type: "DismissConflict", tripId, conflictId }),
```

- [ ] **Step 3: Run to green**

Run: `pnpm --filter web test && pnpm typecheck && pnpm lint`
Expected: PASS, including all pre-existing board tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): undo/redo controls and persistent conflict dismissal"
```

### Task 9: UI — history panel, read-only preview, revert

**Files:**
- Create: `apps/web/src/components/board/HistoryPanel.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx`
- Test: `apps/web/src/components/board/HistoryPanel.test.tsx`, extend `TripBoardScreen.test.tsx`

**Interfaces:**
- Consumes: Tasks 7–8.
- Produces:
  - `HistoryPanel({ history, previewSeq, onPreview, onExitPreview, onRevert })` — toggleable panel (toggle button accessible name **"History"**), entries newest-first, each a button labeled by its description; `undone` entries rendered struck-through/dimmed; clicking an entry calls `onPreview(entry.toSeq)`.
  - Preview mode in `TripBoardScreen`: banner text `Viewing version {seq} (read-only)` with buttons **"Revert to here"** and **"Back to now"**; the board is wrapped in an `inert` container so nothing is clickable/draggable. Revert dispatches `{ type: "RevertToState", tripId, toSeq: previewSeq }` and exits preview. (The e2e script depends on all four quoted strings.)

- [ ] **Step 1: Failing tests**

`HistoryPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TripHistory } from "@tc/contracts";
import { HistoryPanel } from "./HistoryPanel";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const history: TripHistory = {
  tripId: TRIP,
  canUndo: true,
  canRedo: false,
  entries: [
    {
      batchId: "7d9a1f8e-0000-4000-8000-000000000b02",
      fromSeq: 2, toSeq: 2, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
      origin: { kind: "user" }, description: "Added Day 1", undone: true,
    },
    {
      batchId: "7d9a1f8e-0000-4000-8000-000000000b01",
      fromSeq: 1, toSeq: 1, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
      origin: { kind: "user" }, description: 'Created trip "Rome"', undone: false,
    },
  ],
};

describe("HistoryPanel", () => {
  it("opens on toggle, lists entries newest-first, marks undone, previews on click", () => {
    const onPreview = vi.fn();
    render(
      <HistoryPanel history={history} previewSeq={null} onPreview={onPreview} onExitPreview={() => {}} onRevert={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const items = screen.getAllByTestId("history-entry");
    expect(items[0]).toHaveTextContent("Added Day 1");
    expect(items[0]!.querySelector("s, [style*='line-through']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Added Day 1/ }));
    expect(onPreview).toHaveBeenCalledWith(2);
  });
});
```

Extend `TripBoardScreen.test.tsx` (using its existing render-with-MSW setup) with one test: render with `makeTripHandlers(fixture, { history: historyFixture(fixture.tripId), detailAt: { 2: pastFixture }, onCommand })`; open History, click an entry → expect text `Viewing version 2 (read-only)` and the past fixture's content on screen; click "Revert to here" → expect `onCommand` received `{ type: "RevertToState", toSeq: 2 }` and the preview banner gone.

Run: `pnpm --filter web test` — expected: FAIL.

- [ ] **Step 2: Implement**

`HistoryPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { TripHistory } from "@tc/contracts";

export function HistoryPanel({
  history,
  previewSeq,
  onPreview,
  onExitPreview,
  onRevert,
}: {
  history: TripHistory | null;
  previewSeq: number | null;
  onPreview: (seq: number) => void;
  onExitPreview: () => void;
  onRevert: (toSeq: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside>
      <button aria-label="History" onClick={() => setOpen((o) => !o)}>
        🕘 History
      </button>
      {open && history !== null && (
        <ol reversed style={{ border: "1px solid #ccc", borderRadius: 6, padding: 12, marginTop: 8 }}>
          {history.entries.map((entry) => (
            <li key={entry.batchId} data-testid="history-entry" style={{ margin: "4px 0" }}>
              <button
                onClick={() => (previewSeq === entry.toSeq ? onExitPreview() : onPreview(entry.toSeq))}
                style={{
                  opacity: entry.undone ? 0.5 : 1,
                  textDecoration: entry.undone ? "line-through" : "none",
                  fontWeight: previewSeq === entry.toSeq ? "bold" : "normal",
                }}
              >
                {entry.description}
              </button>{" "}
              <small>{new Date(entry.occurredAt).toLocaleString()}</small>
            </li>
          ))}
        </ol>
      )}
      {previewSeq !== null && (
        <p role="status" style={{ border: "1px solid #6699cc", background: "#eef5ff", borderRadius: 6, padding: 8 }}>
          Viewing version {previewSeq} (read-only){" "}
          <button onClick={() => onRevert(previewSeq)}>Revert to here</button>{" "}
          <button onClick={onExitPreview}>Back to now</button>
        </p>
      )}
    </aside>
  );
}
```

`TripBoardScreen.tsx` — add preview state and wiring:

```tsx
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);

  const openPreview = useCallback(
    async (seq: number) => {
      const result = await fetchTripDetailAt(tripId, seq);
      if (result.ok) {
        setPreviewSeq(seq);
        setPreviewTrip(result.value);
      } else {
        setError(result.error.message);
      }
    },
    [tripId],
  );

  const exitPreview = useCallback(() => {
    setPreviewSeq(null);
    setPreviewTrip(null);
  }, []);
```

`dispatch` additionally calls `exitPreview()` after `load()` (any successful command leaves preview). Render:

```tsx
      <HistoryPanel
        history={history}
        previewSeq={previewSeq}
        onPreview={(seq) => void openPreview(seq)}
        onExitPreview={exitPreview}
        onRevert={(toSeq) => void dispatch({ type: "RevertToState", tripId, toSeq })}
      />
```

and the `<Board …/>` element is wrapped so preview disables ALL interaction without touching Board internals (`inert` blocks pointer + focus; React 19 supports the boolean attribute):

```tsx
      <div inert={previewSeq !== null ? true : undefined}>
        <Board trip={previewSeq !== null && previewTrip !== null ? previewTrip : trip} callbacks={…existing object…} />
      </div>
```

Also hide `UndoRedoControls` and `StartDateControl` while previewing (`{previewSeq === null && (…)}`) — time travel is read-only.

- [ ] **Step 3: Run to green**

Run: `pnpm --filter web test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): history panel with read-only preview and revert"
```

### Task 10: E2E — the M2 gate script

**Files:**
- Create: `apps/web/e2e/m2-history.spec.ts`

**Interfaces:**
- Consumes: the deployed feature end-to-end; `signInAsDevUser` from `e2e/helpers.ts`; the accessible names pinned in Tasks 8–9.

- [ ] **Step 1: Write the script**

```ts
import { expect, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

test("history: dismiss persists, undo/redo, preview, revert", async ({ page }) => {
  const tripName = `Rome ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  // -- setup: a day with an overlap conflict (M1 vocabulary) --
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(1);

  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Colosseum");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("11:00");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "+ Add activity" }).click();
  await page.getByLabel("Activity title").fill("Vatican Museums");
  await page.getByLabel("Start time").fill("10:00");
  await page.getByLabel("End time").fill("12:00");
  await page.getByRole("button", { name: "Save" }).click();

  const colosseum = page.getByTestId(/activity-card-/).filter({ hasText: "Colosseum" });
  const vatican = page.getByTestId(/activity-card-/).filter({ hasText: "Vatican Museums" });
  const day1 = page.getByTestId("day-column").nth(0);
  await colosseum.dragTo(day1);
  await vatican.dragTo(day1);
  await expect(page.getByText(/overlap in time/)).toBeVisible();

  // -- persistent dismissal --
  await page.getByRole("button", { name: /^Dismiss:/ }).click();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: tripName })).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible(); // survived the reload

  // -- undo / redo (dismissal is an ordinary change) --
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/overlap in time/)).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible();

  // -- history + read-only preview + revert --
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByTestId("history-entry").first()).toContainText("Redid: Dismissed a conflict");
  // preview the moment just before Vatican Museums moved onto Day 1:
  await page.getByRole("button", { name: 'Moved "Colosseum" to Day 1' }).click();
  await expect(page.getByText(/Viewing version \d+ \(read-only\)/)).toBeVisible();
  await expect(day1.getByText("Vatican Museums")).not.toBeVisible(); // past state
  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(day1.getByText("Vatican Museums")).toBeVisible();

  await page.getByRole("button", { name: 'Moved "Colosseum" to Day 1' }).click();
  await page.getByRole("button", { name: "Revert to here" }).click();
  await expect(page.getByText(/Viewing version/)).not.toBeVisible();
  await expect(day1.getByText("Vatican Museums")).not.toBeVisible(); // reverted for real
  await expect(day1.getByText("Colosseum")).toBeVisible();
  await expect(page.getByText(/overlap in time/)).not.toBeVisible(); // no overlap in that state
  await expect(page.getByTestId("history-entry").first()).toContainText("Reverted to version");
});
```

- [ ] **Step 2: Run the full e2e suite (M0 + M1 must stay green)**

Run: `docker compose up -d && pnpm --filter web test:e2e`
Expected: 3 specs pass (`smoke`, `m1-board`, `m2-history`). If a selector mismatches the real DOM, fix the SPEC to match the app's actual accessible names only if the app matches this plan's pinned names — otherwise the app is wrong; fix the app.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): m2 history & time travel script"
```

### Task 11: Full verification, PR, deploy checks

- [ ] **Step 1: The whole suite, from clean**

```bash
pnpm check && pnpm --filter web db:migrate && pnpm --filter web test:int && pnpm --filter web build && pnpm --filter web test:e2e
```
Expected: everything green. Also re-run `pnpm install --frozen-lockfile` first if `main` was merged in meanwhile (M1 retro: lockfile merges break silently).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin m2-history-time-travel
gh pr create --title "M2: history & time travel" --body "$(cat <<'EOF'
Infra (M1 ops follow-ups): preview/production databases split (Neon branch),
production migrations automated on merge to main, preview migrates at build,
db:reset scaffolding.

Feature (ADR-005 compensating events): envelope provenance (batchId/origin +
backfill migration), UndoLastChange/RedoChange/RevertToState/DismissConflict
through the one pipeline, diffTripStates with round-trip property test,
history + replay-preview endpoints, history panel with read-only preview,
undo/redo controls, persistent conflict dismissal, new e2e script.

Spec: docs/specs/2026-07-08-M2-history-time-travel-design.md
Milestone: docs/milestones/M2-history-time-travel.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify the PR's preview deployment** (this is also the live test of Tasks 0a/0b): the preview build log shows `drizzle-kit migrate` ran against the **preview branch host**; the m2 flow works by hand on the preview URL; production data untouched.

- [ ] **Step 4: After Mitchell merges** — watch the `migrate-production` job run green on `main`, then confirm the production URL serves the history features. Gate items and the retro note in `docs/milestones/M2-history-time-travel.md` are checked off with Mitchell at the demo — NOT by this plan.

---

## Self-review checklist (for the plan author, completed 2026-07-08)

- **Spec coverage:** decisions 1–6 of the spec map to Tasks 4 (linear undo/redo + stack semantics), 9 (read-only preview), 2+8 (dismissal), 3+5 (compensating events through the pipeline), 1+5 (envelope provenance); spec §7 infra → Tasks 0a–0c; spec §6 testing → Tasks 3 (property), 5 (golden + race), 6 (endpoint int), 10 (e2e).
- **Conflict-id prerequisite:** checked against `packages/domain/src/trip/conflicts.ts` — ids are ALREADY content-derived (`kind:dayId:idA:idB` with sorted subject ids), so the spec's "likely a small change" turned out to be "verify + regression-test" (Task 2's determinism test). No id format change needed.
- **No-op guard addition (deviation worth flagging):** the spec did not call this out; it emerged from the undo-stack design — `deriveUndoRedo`'s bookkeeping mirrors state only if every batch changes state. Recorded in the milestone decision table. Side benefit: same-spot drags stop polluting the log.
- **Type consistency:** `dismissedConflictIds` (state/detail/fixtures), `batchId`/`origin` (envelope/schema/appendToStream/toEnvelope), `foldEnvelopes(envelopes, toSeq?)`, `decideHistoryCommand(envelopes, command)`, endpoint response keys `{history}`/`{trip}` — cross-checked across Tasks 1–9. E2E accessible names ("Undo", "Redo", "History", "Revert to here", "Back to now", `Viewing version N (read-only)`, `history-entry` testid) pinned in Tasks 8–9 and consumed verbatim in Task 10.
- **Placeholder scan:** every code step contains complete code; the only "mirror the existing pattern" references are to files the executor must read anyway in the same task (int-test DB setup, apiClient test harness), never to undefined code.
