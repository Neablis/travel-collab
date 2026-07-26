# AI id-resolver refactor — manifest-driven, server-minted, batch-aware

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI planning surface never handle a UUID — the model references entities by human terms only; the server injects/mints/resolves every id — driven by one manifest instead of per-tool code, and resolving references against the trip *as the batch builds it*.

**Architecture:** A single id-field manifest (`idFields.ts`) classifies every command field as `inject` / `mint` / `ref`. `buildPlanningTools` derives each tool's schema from it (drop inject+mint, swap ref→`<entity>Ref`) and records the model's raw intents. After generation, one pure, ordered, batch-aware pass (`resolveBatch`) mints new ids, resolves refs against a running **`TripState` advanced by the real `decideTripCommand` + `evolveTrip`** (so "add a day, then put lunch on it" works, *and* removals/moves renumber correctly for later refs), and drops commands that can't resolve or that the domain would reject — then the survivors go as one atomic batch. This SUPERSEDES KI-8's four per-tool `execute()` branches.

**Tech Stack:** Next.js (App Router) + TypeScript, Zod, Vercel AI SDK v7 (`ai`), Vitest, Drizzle/Postgres (int tests only).

## Global Constraints

- Tool schemas are DERIVED from `@tc/contracts` `BatchableCommand`, never hand-written duplicates (ADR-015 / Invariant 5).
- The AI never emits, copies, or invents a UUID — for existing OR new entities.
- Atomic batches only (ADR-013): resolved survivors submit as ONE `executeTripCommandBatch` call.
- Money is integer minor units; keep the money-units notes on money-bearing tools (regression risk — KI-8 added them).
- Conflicts are referenced by their 1-based `ref` from the envelope's `activeConflicts`, never a raw conflict id.
- `pnpm --filter web typecheck` and `pnpm --filter web lint` must stay green. Unit tests run under the jsdom runner (`vitest.unit.config.ts`); `*.int.test.ts` need a migrated test Postgres and are DB-gated.

---

## Starting state (already committed on `claude/ai-id-resolver-refactor-plan-f83bd6`)

These are committed and verified — **do not rebuild them**:

- **`apps/web/src/server/ai/idFields.ts`** — the manifest. Exports `ID_FIELDS` (mapped exhaustively over `BatchableCommand["type"]`), `IdRole`, `RefEntity`, `refParamName(entity)`, `REF_PARAM_NAMES`.
- **`apps/web/src/server/ai/batchResolver.ts`** — `resolveBatch(intents, detail, { tripId, mintId? })` → `{ commands, errors }`. Batch-aware ordered projection, server-minting, ref resolution (activity by title/id, day by "day N"/id/backlog, conflict by 1-based ref via `activeConflicts`), `BatchableCommand.safeParse` typed boundary. Exports `RawToolIntent`, `BatchResolutionError`, `ResolvedBatch`.
- **`apps/web/src/server/ai/batchResolver.test.ts`** — 10 tests, all green (incl. the "activity onto a day added earlier in the same batch" dependency case).

> ⚠️ The `batchResolver` internals above are **superseded by Tasks 6–9** — see the gap review below. Its append-only projection is replaced by a real `TripState`, and `resolveBatch` gains an `actorId` option. The public shape (`RawToolIntent` in, `{ commands, errors }` out) survives; `BatchResolutionError` gains `code` and `causeIndex`.

`planningTools.ts` and `handleAiRequest.ts` are at the KI-8 baseline (per-tool resolver). This plan replaces the planning-tools half and rewires the handler.

### Live-testing findings (2026-07-25)

A real run against the deployed KI-8 build ("plan a Rochester trip", `deepseek-v4-flash`) surfaced three things this plan must address:

1. **A no-op sub-command aborted the whole batch → nothing applied.** The model emitted `SetTripCurrency "USD"` on a trip that already defaults to USD; that decides to a `no-op` ([decide.ts:26](../../apps/web/src/server/commands.ts) via `okUnlessNoOp`), and `executeTripCommandBatch` aborts the entire batch on the first rejection ([commands.ts:162-164](../../apps/web/src/server/commands.ts)). 15 valid `AddDay`s + an activity were rolled back. **Addressed by Task 0 (below).**
2. **Activities targeting a same-batch day were silently dropped.** `AddActivity … dayRef:"day 1"` resolved against the *empty pre-batch* trip → "out of range" → dropped; only the backlog activity survived. **This is exactly what the batch-aware `resolveBatch` (already committed) + Tasks 1–2 fix.**
3. **The model minted duplicate ids and looped** (15 `AddDay`s, repeated `activityId`s across 6 steps). Duplicate ids would themselves abort a batch (`activity-already-exists`). **Server-minting (Tasks 1–2) removes that hazard** — the model never supplies an id. (The raw over-generation is a weak-model artifact; out of scope beyond server-minting.)

### Gap review (2026-07-25): the committed projection is append-only

A read of the committed `resolveBatch` found three failure classes that Tasks 0–4 do **not** close. `BatchProjection` is a bespoke, *append-only* mirror: it has `addDay`/`addActivity` and nothing else, and only `mint`-role fields update it (`batchResolver.ts:165-170`). `RemoveDay`/`RemoveActivity`/`MoveActivity` carry `ref`-role fields, so they never touch it at all.

1. **Structural mutations are invisible to later refs (worst).** Trip with days `[A,B,C]`; batch `RemoveDay{dayRef:"day 1"}` then `AddActivity{dayRef:"day 2"}`. Post-removal, "day 2" means C. The projection's `dayIds` still holds `[A,B,C]`, so it resolves to B. **Silent wrong target, no error.** Same class for `RemoveActivity`: nothing scrubs the removed id from the title index, so a later title ref still matches an activity that is about to be deleted.
2. **A clean partial-drop escalates to a whole-batch abort.** Same trip; batch `RemoveDay{dayRef:"day 1"}` then `AddActivity{dayRef:"day 1"}`. The stale array reports A for both, so `resolveBatch` reports *success* for two commands — then `executeTripCommandBatch` decides them in order against the real evolving state: `RemoveDay(A)` succeeds, `AddActivity{dayId:A}` hits `day-not-found`, and the whole atomic batch rolls back, including the valid `RemoveDay`. The resolver had no way to see it coming because it never modeled the removal.
3. **Cascading drops report misleading causes.** If the `AddActivity` that would have created "Museum" is itself dropped, a later `UpdateActivity{activityRef:"Museum"}` fails with `No activity named "Museum"` — true, but it points at the wrong thing.

Separately, **backward references** (a `dayRef:"day 1"` emitted *before* the `AddDay` that creates it) fail, because the fold is strictly left-to-right. Only the system prompt prevents this today.

**Decisions taken (Mitchell, 2026-07-25).** Tasks 6–10 implement these:

- **Hold a real `TripState`, not a bespoke projection.** `TripDetail` is a strict superset of `TripState` — every state-carried field is present verbatim, and the extras (`date`, `costSubtotal`, `conflicts`, rollups) are derived. So `tripStateFromDetail` is an exact, lossless inverse, not a synthetic stand-in. The resolver advances that state with the *same* `decideTripCommand` + `evolveTrip` the batch executor runs. This closes (1) with exact domain semantics and (2) by construction: a command the domain would reject is now dropped at resolve time, so it can never abort the batch. *Rejected: extending `BatchProjection` with `removeDay`/`removeActivity` — it re-implements `evolve.ts` in a second place that will drift, and it cannot close (2), because it does not know `decide`'s rules (`activity-already-exists`, `conflict-not-found`, `conflict-already-dismissed`).*
- **Hoist `AddDay` intents to the front; nothing else.** `AddDay` is the only command that creates something a positional ref can point at, and `evolveTrip` **appends** it (`evolve.ts:46`). Appends never renumber existing days, so moving every `AddDay` to the front (relative order preserved) provably cannot change what any ref to a pre-existing day means — it only makes a day referenced before it was added resolvable. Activities are *not* hoisted: an `AddActivity`'s title changes which activity a later title ref matches, and its day/position placement depends on the state at its emission point. Backward *title* refs therefore stay unrecovered, explained by (3)'s causal linkage and logged as a known constraint.
  - *Rejected: a fixpoint retry loop ("keep looping till nothing resolves").* It terminates fine, but a command that fails in pass 1 and succeeds in pass 2 is applied **after** commands emitted later than it, so its positional `"day 2"` resolves against a state including those later effects — the exact silent-retarget bug, relocated to the retry path. It also needs a retryable-vs-terminal classification of domain rejection codes in the AI layer: a new hard coupling and a prime drift site.
  - *Rejected: phase ordering (trip → day → activity).* It globally reorders, forcing `RemoveDay{day 1}` ahead of an `AddActivity{dayRef:"day 2"}` the model emitted first — promoting the silent-retarget bug to a design rule. It leaves `AddDay`-vs-`RemoveDay` order within the day phase undefined (which changes what numbers new days get), makes `MoveActivity` position indices meaningless once moves are grouped away from the adds that populate the day, and still does not fix same-tier dependencies (`UpdateActivity` referencing an activity added in the same batch is activity-level on both ends).
  - Both rejected approaches are pinned by **failing-under-them regression tests** in Task 9, so the decision is recorded in executable form.
- **Name the cause of a cascaded drop.** `BatchResolutionError` gains `code` and `causeIndex` (Task 8).

Verify starting state before Task 1:

```bash
cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai/batchResolver.test.ts
# Expected: Test Files 1 passed, Tests 10 passed
pnpm --filter web typecheck   # Expected: exit 0
```

---

## Task 0: Atomic batches tolerate a no-op sub-command

**Do this first — it's independent of the AI layer and unblocks batches immediately** (see live-testing finding #1). A single redundant command (e.g. `SetTripCurrency "USD"` on a USD trip) must not roll back an otherwise-valid batch.

**Files:**
- Modify: `apps/web/src/server/commands.ts` (the `executeTripCommandBatch` decide loop)
- Test: `apps/web/src/server/commands.int.test.ts` (DB-gated — needs the migrated test Postgres; `beforeEach` wipes tables, never point at the dev DB)

**Interfaces:**
- Consumes: `decideTripCommand(state, command, { actorId })` → `{ ok: true; events: TripEvent[] } | { ok: false; rejection: { code: string; message: string } }`; `evolveTrip(state, event)` — both from `@tc/domain`.

- [ ] **Step 1: Write the failing tests** (add inside the existing `describe("executeTripCommandBatch", ...)` block; `exec` and `randomUUID` already exist in the file)

```typescript
  it("skips a no-op sub-command instead of aborting the batch", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "No-op batch trip" }); // defaults currency USD
    const dayId = randomUUID();
    const result = await executeTripCommandBatch(
      [
        { type: "SetTripCurrency", tripId, currency: "USD" }, // no-op: already USD
        { type: "AddDay", tripId, dayId },
      ],
      "user-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.detail.days).toHaveLength(1); // the AddDay applied despite the no-op
  });

  it("rejects a batch that is entirely no-ops", async () => {
    const tripId = randomUUID();
    await exec({ type: "CreateTrip", tripId, name: "All no-op trip" });
    const result = await executeTripCommandBatch(
      [{ type: "SetTripCurrency", tripId, currency: "USD" }],
      "user-1",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe("no-op");
  });
```

- [ ] **Step 2: Run — expect the first test to FAIL** (requires the test Postgres)

Run: `pnpm --filter web test:int -- commands.int.test.ts`
Expected: "skips a no-op sub-command…" FAILS — the batch currently aborts on the no-op and `result.ok` is `false`. (If no test DB is available here, note it and proceed; the change is small and mechanical.)

- [ ] **Step 3: Update the decide loop in `executeTripCommandBatch`.** Replace the loop (currently: `if (!decision.ok) return { ok: false, error: decision.rejection };`) with:

```typescript
    // Decide each command in order against the evolving state. A no-op
    // sub-command is SKIPPED, not fatal — one redundant Set*/etc. must not roll
    // back an otherwise-valid batch (2026-07-25 live-testing finding). Real
    // rejections (day-not-found, activity-already-exists, …) still abort.
    const events: TripEvent[] = [];
    for (const command of commands) {
      const decision = decideTripCommand(state, command, { actorId });
      if (!decision.ok) {
        if (decision.rejection.code === "no-op") continue;
        return { ok: false, error: decision.rejection };
      }
      for (const event of decision.events) state = evolveTrip(state, event);
      events.push(...decision.events);
    }
    // If every sub-command was a no-op there is nothing to append — report it the
    // same way a single no-op command does, rather than appending an empty batch
    // (appendToStream requires ≥1 event and one batch = one history entry).
    if (events.length === 0) {
      return { ok: false, error: { code: "no-op", message: "This change would have no effect." } };
    }
```

- [ ] **Step 4: Run tests — expect PASS**, and confirm the existing "is all-or-nothing — a later invalid command appends nothing" test still passes (it uses a *real* rejection, not a no-op, so it must still abort).

Run: `pnpm --filter web test:int -- commands.int.test.ts`
Also: `grep -rn "no-op" apps/web/src/server/commands.int.test.ts packages/domain/src` — update any test that asserts a *batch* with a no-op is rejected (a single-command no-op rejection is unchanged and correct).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/commands.ts apps/web/src/server/commands.int.test.ts
git commit -m "fix(M7): atomic batches skip a no-op sub-command instead of aborting"
```

> **Optional handler polish (~~do in Task 2~~ — superseded by Task 7):** after Task 2 wires the AI path, a whole-batch no-op surfaces as the batch's `no-op` error (HTTP 400 via `STATUS`). Task 7's dry-run makes this moot: no-op sub-commands are skipped during resolution, so an all-redundant request resolves to zero commands and returns the friendly 200 "I couldn't turn that into any changes" response without ever calling `executeTripCommandBatch`. Don't build the mapping separately.

---

## Task 1: Manifest-driven `buildPlanningTools`

Replace KI-8's per-tool branches with a generic, manifest-driven builder that records raw intents (no resolution in the tool).

**Files:**
- Modify (full rewrite): `apps/web/src/server/ai/planningTools.ts`
- Modify (rewrite): `apps/web/src/server/ai/planningTools.test.ts`

**Interfaces:**
- Consumes: `ID_FIELDS`, `refParamName`, `IdRole` from `./idFields`; `RawToolIntent` from `./batchResolver`.
- Produces: `buildPlanningTools(): { tools: Record<string, Tool>; getCollected: () => RawToolIntent[] }` (NOTE: no longer takes `tripId`/`detail`). `flushPlanningBatch(_tripId, calls, actorId)` unchanged.

- [ ] **Step 1: Write the new failing tests** (replace the whole file)

`apps/web/src/server/ai/planningTools.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { BatchableCommand } from "@tc/contracts";
import { buildPlanningTools } from "./planningTools";

const EXEC_OPTS = { toolCallId: "c1", messages: [], context: undefined } as never;

function shapeOf(schema: unknown): Record<string, unknown> {
  return (schema as { shape: Record<string, unknown> }).shape;
}

describe("buildPlanningTools", () => {
  it("has exactly one tool per BatchableCommand union member, keyed by type", () => {
    const expected = BatchableCommand.options.map((o) => o.shape.type.value).sort();
    const { tools } = buildPlanningTools();
    expect(Object.keys(tools).sort()).toEqual(expected);
  });

  it("drops mint + inject id fields and swaps ref fields for <entity>Ref", () => {
    const { tools } = buildPlanningTools();
    // AddActivity: activityId (mint) + dayId (ref) gone; dayRef present; no tripId/type.
    const add = shapeOf(tools.AddActivity!.inputSchema);
    expect(add).not.toHaveProperty("activityId");
    expect(add).not.toHaveProperty("dayId");
    expect(add).not.toHaveProperty("tripId");
    expect(add).toHaveProperty("dayRef");
    expect(add).toHaveProperty("title");
    // AddDay: dayId (mint) gone — nothing id-bearing left.
    expect(shapeOf(tools.AddDay!.inputSchema)).not.toHaveProperty("dayId");
    // MoveActivity: activityRef + dayRef, not activityId/toDayId.
    const move = shapeOf(tools.MoveActivity!.inputSchema);
    expect(move).toHaveProperty("activityRef");
    expect(move).toHaveProperty("dayRef");
    expect(move).toHaveProperty("position");
    expect(move).not.toHaveProperty("activityId");
    expect(move).not.toHaveProperty("toDayId");
    // RemoveDay -> dayRef; DismissConflict -> conflictRef; RemoveActivity -> activityRef.
    expect(shapeOf(tools.RemoveDay!.inputSchema)).toHaveProperty("dayRef");
    expect(shapeOf(tools.DismissConflict!.inputSchema)).toHaveProperty("conflictRef");
    expect(shapeOf(tools.RemoveActivity!.inputSchema)).toHaveProperty("activityRef");
  });

  it("records the model's raw intent (type + args), resolving nothing", async () => {
    const { tools, getCollected } = buildPlanningTools();
    await tools.MoveActivity!.execute!(
      { activityRef: "Colosseum tour", dayRef: "day 2", position: 0 },
      EXEC_OPTS,
    );
    expect(getCollected()).toEqual([
      { type: "MoveActivity", args: { activityRef: "Colosseum tour", dayRef: "day 2", position: 0 } },
    ]);
  });

  it("AddActivity accepts a validated payload with no ids", () => {
    const { tools } = buildPlanningTools();
    const parsed = (tools.AddActivity!.inputSchema as unknown as ZodTypeAny).safeParse({
      title: "Lunch",
      dayRef: "day 1",
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai/planningTools.test.ts`
Expected: FAIL — current KI-8 `buildPlanningTools` requires `(tripId, detail)` and still exposes `activityId`/records resolved commands.

- [ ] **Step 3: Rewrite `planningTools.ts`** (replace the whole file)

```typescript
// AI planning tools derived from @tc/contracts command schemas (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
//
// Each BatchableCommand member becomes one tool. Its inputSchema is that
// command's schema TRANSFORMED by the id-field manifest (idFields.ts) so the AI
// never handles a UUID: `type` is dropped (implied by the tool name); `inject`
// fields (tripId) are dropped (server-injected); `mint` fields (new ids) are
// dropped (server-generated); `ref` fields (an EXISTING day/activity/conflict)
// are swapped for a human `<entity>Ref`. A tool call records the model's raw
// intent only — resolveBatch (batchResolver.ts) turns the ordered batch into
// concrete commands in one batch-aware pass, then flushPlanningBatch submits
// them as ONE atomic batch (ADR-013).
import { tool, type Tool } from "ai";
import { z } from "zod";
import { BatchableCommand, type BatchableCommand as BatchableCommandType } from "@tc/contracts";
import { executeTripCommandBatch, type CommandResult } from "../commands";
import { ID_FIELDS, refParamName, type IdRole } from "./idFields";
import type { RawToolIntent } from "./batchResolver";

const MONEY_UNITS_NOTE =
  "Money is integer minor units (cents): amountMinor 500 = 5.00, so multiply a decimal amount by 100 (e.g. 500 EUR → amountMinor 50000).";

const DESCRIPTIONS: Record<BatchableCommandType["type"], string> = {
  AddDay: "Add a new day to the trip (the server assigns its id).",
  RemoveDay: 'Remove an existing day (dayRef: "day N" or its dayId); its activities return to the backlog.',
  SetTripStartDate: "Set (or clear, with null) the trip's start date.",
  AddActivity: `Add a new activity; place it on a day via dayRef ("day N") or leave it in the backlog. ${MONEY_UNITS_NOTE}`,
  UpdateActivity: `Update fields on an existing activity (activityRef — its title or id). Omitted fields are unchanged. ${MONEY_UNITS_NOTE}`,
  MoveActivity:
    'Move an activity (activityRef) to a different day (dayRef: "day N", a dayId, or null/backlog) and position.',
  RemoveActivity: "Remove an activity from the trip (activityRef — its title or id).",
  DismissConflict:
    "Dismiss an active conflict by its number in the context's `conflicts` list (conflictRef: e.g. 1). Only conflicts shown there can be dismissed.",
  SetTripCurrency: "Set the trip's currency (ISO 4217 code).",
  SetTripBudget: `Set (or clear, with null) the trip's budget. ${MONEY_UNITS_NOTE}`,
};

const activityRefSchema = z
  .string()
  .min(1)
  .describe("An existing activity's exact title (as shown in the context) or its id.");

const conflictRefSchema = z
  .union([z.string(), z.number().int()])
  .describe("The conflict to dismiss, by its `ref` number in the context's `conflicts` list (e.g. 1). Never a raw conflict id.");

function dayRefSchema(backlog: "null" | "omit" | undefined): z.ZodTypeAny {
  const base = z
    .union([z.string(), z.number().int()])
    .nullable()
    .describe('A day as "day N" (1-based, e.g. "day 2"), a dayId, or "backlog"/null for the backlog.');
  // `omit` backlog fields are truly optional (a bare add = backlog); `null`
  // backlog fields must be stated (choose a day or the backlog).
  return backlog === "omit" ? base.optional() : base;
}

function refSchemaFor(role: Extract<IdRole, { role: "ref" }>): z.ZodTypeAny {
  switch (role.entity) {
    case "activity":
      return activityRefSchema;
    case "day":
      return dayRefSchema(role.backlog);
    case "conflict":
      return conflictRefSchema;
  }
}

export function buildPlanningTools(): {
  tools: Record<string, Tool>;
  getCollected: () => RawToolIntent[];
} {
  const collected: RawToolIntent[] = [];
  const tools: Record<string, Tool> = {};

  for (const optionSchema of BatchableCommand.options as unknown as z.ZodObject<
    { type: z.ZodLiteral<string> } & z.ZodRawShape
  >[]) {
    const type = optionSchema.shape.type.value as BatchableCommandType["type"];

    let schema = optionSchema.omit({ type: true, tripId: true }) as unknown as z.ZodObject<z.ZodRawShape>;
    for (const [field, role] of Object.entries(ID_FIELDS[type]) as [string, IdRole][]) {
      const drop = { [field]: true } as Record<string, true>;
      if (role.role === "mint") {
        schema = schema.omit(drop) as unknown as z.ZodObject<z.ZodRawShape>;
      } else if (role.role === "ref") {
        schema = schema
          .omit(drop)
          .extend({ [refParamName(role.entity)]: refSchemaFor(role) }) as unknown as z.ZodObject<z.ZodRawShape>;
      }
    }

    tools[type] = tool({
      description: DESCRIPTIONS[type],
      inputSchema: schema as unknown as z.ZodTypeAny,
      execute: async (args: Record<string, unknown>) => {
        collected.push({ type, args });
        return { queued: true, type };
      },
    });
  }

  return { tools, getCollected: () => collected };
}

// Submits the resolved commands as ONE atomic batch (ADR-013).
export async function flushPlanningBatch(
  _tripId: string,
  calls: BatchableCommandType[],
  actorId: string,
): Promise<CommandResult> {
  return executeTripCommandBatch(calls, actorId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai/planningTools.test.ts`
Expected: PASS (4 tests). Also run `pnpm --filter web typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/planningTools.ts apps/web/src/server/ai/planningTools.test.ts
git commit -m "refactor(M7): manifest-driven planning tools — no per-tool ref code"
```

---

## Task 2: Wire `handleAiRequest` to `resolveBatch`

**Files:**
- Modify: `apps/web/src/server/ai/handleAiRequest.ts`

**Interfaces:**
- Consumes: `resolveBatch` from `./batchResolver`; `buildPlanningTools()` (no args) from `./planningTools`.

- [ ] **Step 1: Add the import** (near the other `@/server/ai/*` imports)

```typescript
import { resolveBatch } from "@/server/ai/batchResolver";
```

- [ ] **Step 2: Replace the system prompt so the model emits no ids.** Find the `const system = [ ... ]` array. Replace the line `"When adding a NEW entity, generate a fresh random UUID for its id: ..."` and the human-references line with these (KEEP the existing conflict, money, and codes lines):

```typescript
    "You never write, copy, or invent a UUID. The tools take human references and the server assigns all ids:",
    "- Name an existing activity by its exact `title` via `activityRef`.",
    '- Choose a day via `dayRef`: "day N" (1-based, e.g. "day 2"), or "backlog"/null for the backlog.',
    '- To place an activity on a day you add in the SAME request, refer to it by number — e.g. after adding a 3rd day, use "day 3".',
    "- Do NOT provide activityId or dayId; the server generates ids for anything new.",
    "If a title matches two activities, the change is skipped and reported; reference the intended one by its exact `id` from the context.",
```

- [ ] **Step 3: Replace the board/combined section** (from `// board | combined` down to the final `return Response.json({ ... resolvedCommands: calls });` of that surface — NOT the page surface above it):

```typescript
  // board | combined
  const planning = buildPlanningTools();
  const tools = surface === "combined" ? { ...planning.tools, ...buildPageTools().tools } : planning.tools;
  let gen;
  const startedAt = Date.now();
  try {
    gen = await generateText({
      model,
      system,
      prompt,
      tools,
      stopWhen: isStepCount(MAX_STEPS[surface]),
      maxRetries: AI_MAX_RETRIES,
    });
  } catch (err) {
    return Response.json(
      { error: `model call failed: ${errorMessage(err)}`, meta: failedMeta(model, Date.now() - startedAt) },
      { status: 422 },
    );
  }
  const meta = buildAiMeta(gen, model, Date.now() - startedAt);

  // Turn the model's raw tool intents (human refs, no UUIDs) into concrete
  // commands in one batch-aware pass: mint new ids, resolve refs against the
  // trip AS THE BATCH BUILDS IT, and drop any command whose ref can't be
  // matched. `resolutionErrors` are the drops — surfaced for the caller.
  const { commands, errors: resolutionErrors } = resolveBatch(planning.getCollected(), detail, { tripId });

  if (commands.length === 0) {
    const history: TripHistory | null = await getTripHistory(tripId);
    return Response.json({
      detail,
      history,
      message:
        resolutionErrors.length > 0
          ? "I couldn't match that to anything on your trip, so nothing was applied. Try naming the days and activities as they appear on the board."
          : "I couldn't turn that into any changes, so nothing was applied.",
      meta,
      resolvedCommands: [],
      resolutionErrors,
    });
  }

  const batch = await flushPlanningBatch(tripId, commands, userId);
  if (!batch.ok) {
    return Response.json(
      { error: batch.error.message, code: batch.error.code, meta, resolvedCommands: commands, resolutionErrors },
      { status: STATUS[batch.error.code] ?? 400 },
    );
  }
  const summary = summarizeBatch(commands, detail);
  const message =
    resolutionErrors.length > 0
      ? `${summary} (${resolutionErrors.length} other change${resolutionErrors.length === 1 ? "" : "s"} couldn't be matched and ${resolutionErrors.length === 1 ? "was" : "were"} skipped.)`
      : summary;
  return Response.json({
    detail: batch.detail,
    history: batch.history,
    message,
    meta,
    resolvedCommands: commands,
    resolutionErrors,
  });
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter web typecheck` → exit 0. Run `pnpm --filter web lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/handleAiRequest.ts
git commit -m "refactor(M7): resolve AI plan batch via resolveBatch; surface resolutionErrors"
```

---

## Task 3: Enforcement test — no unclassified id field

Guarantees a future command can't ship a uuid field the manifest forgot.

**Files:**
- Create: `apps/web/src/server/ai/idFields.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BatchableCommand } from "@tc/contracts";
import { ID_FIELDS } from "./idFields";

// A field whose schema is a uuid (possibly wrapped in optional/nullable). The
// resolver/schema-transform must know its role, so it must be in ID_FIELDS —
// except `tripId`, which is a universal server-injected field.
function isUuidField(schema: z.ZodTypeAny): boolean {
  let s: z.ZodTypeAny = schema;
  // Unwrap optional/nullable/default wrappers.
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
    s = s._def.innerType;
  }
  if (!(s instanceof z.ZodString)) return false;
  return (s._def.checks ?? []).some((c: { kind: string }) => c.kind === "uuid");
}

describe("ID_FIELDS manifest", () => {
  it("classifies every uuid-bearing command field (except tripId)", () => {
    for (const option of BatchableCommand.options) {
      const type = option.shape.type.value as keyof typeof ID_FIELDS;
      const spec = ID_FIELDS[type];
      for (const [field, fieldSchema] of Object.entries(option.shape)) {
        if (field === "tripId" || field === "type") continue;
        if (isUuidField(fieldSchema as z.ZodTypeAny)) {
          expect(spec, `${type}.${field} is a uuid field but missing from ID_FIELDS`).toHaveProperty(field);
        }
      }
    }
  });

  it("has an entry for every command type", () => {
    const types = BatchableCommand.options.map((o) => o.shape.type.value).sort();
    expect(Object.keys(ID_FIELDS).sort()).toEqual(types);
  });
});
```

- [ ] **Step 2: Run — expect PASS** (the manifest is already complete). If it FAILS, a real gap exists: add the missing field to `ID_FIELDS` in `idFields.ts` with its correct role.

Run: `cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai/idFields.test.ts`
Expected: PASS (2 tests).

> Note: `conflictId` on DismissConflict is `z.string().min(1)` (NOT a uuid), so `isUuidField` won't flag it — it's classified in `ID_FIELDS` anyway. This test only enforces the *uuid* fields; that's the class that silently hallucinates.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server/ai/idFields.test.ts
git commit -m "test(M7): enforce every uuid command field is classified in ID_FIELDS"
```

---

## Task 4: Integration test — server-mint + intra-batch dependency (DB-gated)

**Files:**
- Modify: `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts`

**Interfaces:**
- Consumes: existing `modelWithToolCalls`, `toolCall`, `seedTrip`, `handleAiRequest`, `executeTripCommand` helpers in that file.

> The existing board tests keep passing: with server-minting, an AddDay tool call's model-supplied `dayId` is simply stripped by the (id-less) schema and the server mints one. Add the dependency case below.

- [ ] **Step 1: Add the dependency test** (inside the `describe("POST /api/trips/:id/ai")` block)

```typescript
  it("board surface: adds a day and places an activity on it in one batch", async () => {
    const tripId = await seedTrip(); // 0 days
    const model = modelWithToolCalls([
      toolCall("AddDay", {}),
      toolCall("AddActivity", { title: "Lunch at the market", dayRef: "day 1" }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "add a day and put lunch on it", surface: "board" }),
      tripId,
      model,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The new day exists and carries the activity — proof the AddActivity's
    // "day 1" resolved to the day minted by the AddDay earlier in the SAME batch.
    expect(body.detail.days).toHaveLength(1);
    expect(body.detail.days[0].activityIds).toHaveLength(1);
    const addedId = body.detail.days[0].activityIds[0];
    expect(body.detail.activities[addedId].title).toBe("Lunch at the market");
    // resolvedCommands shows the linkage: AddActivity.dayId === AddDay.dayId.
    const [addDay, addActivity] = body.resolvedCommands;
    expect(addActivity.dayId).toBe(addDay.dayId);
    expect(body.resolutionErrors).toEqual([]);
  });
```

- [ ] **Step 2: Run — requires a migrated test Postgres** (has the M7 `pages` migration; `beforeEach` wipes trip tables — NEVER point at the dev DB). If unavailable in this environment, SKIP running and note it; the unit coverage in `batchResolver.test.ts` already proves the dependency logic.

Run (only with a real test DB configured): `pnpm --filter web test:int -- route.int.test.ts`
Expected: the new test PASS alongside the existing suite.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts"
git commit -m "test(M7): int — server-mint + intra-batch day dependency"
```

---

> **Where's Task 5?** It was "Full verification + PR" and is now **Task 11**, at the end — the gap-review work (Tasks 6–10) has to land before the final verification sweep. Nothing was dropped.

---

## Task 6: `tripStateFromDetail` — the lossless inverse (domain)

The resolver needs a real `TripState` to dry-run the domain against, and it only ever holds a `TripDetail` (from `guard()`). This is the exact inverse of `tripDetailFromState` for the state-carried fields.

**Files:**
- Modify: `packages/domain/src/trip/detail.ts` (append; `TripState` and `TripDetail` are already imported there)
- Modify: `packages/domain/test/detail.test.ts`

**Interfaces:**
- Produces: `tripStateFromDetail(detail: TripDetail): TripState` — pure, exported through `packages/domain/src/index.ts`'s existing `export * from "./trip/detail"` (no index change needed).

- [ ] **Step 1: Write the failing round-trip test** (append to `packages/domain/test/detail.test.ts`)

The property that matters: rebuilding the document from the reconstructed state reproduces the document. If someone adds a field to `TripState`, this fails.

```typescript
describe("tripStateFromDetail", () => {
  it("round-trips: detail → state → detail is identity", () => {
    const detail = projectTripDetails(stream())[0]!;
    const rebuilt = tripDetailFromState(tripStateFromDetail(detail), detail.createdAt);
    expect(rebuilt).toEqual(detail);
  });

  it("carries the fields a decision depends on", () => {
    const detail = projectTripDetails(stream())[0]!;
    const state = tripStateFromDetail(detail);
    expect(state.days.map((d) => d.dayId)).toEqual(detail.days.map((d) => d.dayId));
    expect(state.days[0]!.activityIds).toEqual(detail.days[0]!.activityIds);
    expect(Object.keys(state.activities).sort()).toEqual(Object.keys(detail.activities).sort());
    expect(state.currency).toBe(detail.currency);
    expect(state.dismissedConflictIds).toEqual(detail.dismissedConflictIds);
  });
});
```

Add `tripDetailFromState, tripStateFromDetail` to the file's existing `from "../src"` import.

> The fixture `stream()` already covers a day with two timed, overlapping activities — so the round-trip exercises derived conflicts, not just flat fields.

- [ ] **Step 2: Run — expect FAIL** (`tripStateFromDetail` is not exported yet)

Run: `pnpm --filter @tc/domain test -- detail.test.ts`

- [ ] **Step 3: Append to `packages/domain/src/trip/detail.ts`**

```typescript
// The exact inverse of `tripDetailFromState` for the fields TripState carries.
// TripDetail is a strict SUPERSET of TripState — everything else on the
// document (each day's `date` and `costSubtotal`, `conflicts`, the rollups) is
// derived — so this loses nothing and invents nothing; the round-trip test in
// test/detail.test.ts pins that. It exists so a caller holding only the read
// model (the AI batch resolver) can dry-run the REAL decide/evolve pipeline
// instead of maintaining a parallel, hand-rolled projection that drifts.
export function tripStateFromDetail(detail: TripDetail): TripState {
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

- [ ] **Step 4: Run — expect PASS.** Also `pnpm --filter @tc/domain test` (whole package) → green, and `pnpm --filter web typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/trip/detail.ts packages/domain/test/detail.test.ts
git commit -m "feat(M7): tripStateFromDetail — lossless detail→state inverse for the AI dry-run"
```

---

## Task 7: `resolveBatch` dry-runs the real domain

Replaces the append-only `BatchProjection` with a running `TripState` advanced by `decideTripCommand` + `evolveTrip`. Closes gap-review failures (1) and (2).

**Files:**
- Modify (substantial rewrite): `apps/web/src/server/ai/batchResolver.ts`
- Modify: `apps/web/src/server/ai/batchResolver.test.ts`
- Modify: `apps/web/src/server/ai/handleAiRequest.ts` (pass `actorId` — required for this to typecheck)

**Interfaces:**
- Consumes: `decideTripCommand`, `evolveTrip`, `tripStateFromDetail`, `type TripState` from `@tc/domain` (`apps/web/src/server/**` is the only app code permitted to import the domain — see AGENTS.md's architecture map).
- Produces: `resolveBatch(intents, detail, { tripId, actorId, mintId? })`. `BatchResolutionError` gains `code: string`.

> **Breaking-test warning — read before Step 1.** The committed test `"resolves DismissConflict by its 1-based ref number to the real conflict id"` (`batchResolver.test.ts:159`) hand-writes `{ id: "conflict-id-one", kind: "overlap", … }` into the fixture's `conflicts` array. `detectConflicts` can never *derive* that id, and `decideTripCommand`'s `DismissConflict` branch checks `detectConflicts(state).some((c) => c.id === command.conflictId)` (`decide.ts:178`). Under the dry-run it will reject `conflict-not-found` and the test will fail. That is the check working, not a regression — the fixture describes a trip that cannot exist. Step 1 rebuilds it from genuinely derivable conflicts.

- [ ] **Step 1: Write the failing tests.** Add two new `describe` blocks, and rewrite the `"resolves DismissConflict by its 1-based ref number…"` case (keep `"drops a DismissConflict whose ref number isn't in the context"` as-is — it fails at ref resolution, before `decide`, so the dry-run doesn't affect it).

First, a helper that builds a detail whose conflicts are *real* (put it near `tripWithDays`):

```typescript
import { tripDetailFromState, tripStateFromDetail } from "@tc/domain";

const ACTOR = "user-1";

function resolve(intents: RawToolIntent[], detail: TripDetail) {
  return resolveBatch(intents, detail, { tripId: TRIP_ID, actorId: ACTOR, mintId: sequentialMinter() });
}

// A detail whose `conflicts` are DERIVED, not asserted — round-tripping through
// the domain guarantees the resolver's ref map and decideTripCommand's own
// detectConflicts agree about which conflicts exist.
function derivedDetail(detail: TripDetail): TripDetail {
  return tripDetailFromState(tripStateFromDetail(detail), detail.createdAt);
}

function activity(activityId: string, title: string, timeWindow: { start: string; end: string } | null) {
  return { activityId, title, timeWindow, location: null, notes: null, anchors: [], cost: null };
}

// Two days, each holding a genuine time-overlap pair → exactly two conflicts,
// sorted by id (`time-overlap:<dayId>:…`), so D1's is ref #1 and D2's is ref #2.
function tripWithTwoConflicts(): TripDetail {
  const ids = ["a", "b", "c", "d"].map((c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`);
  const [a1, a2, b1, b2] = ids as [string, string, string, string];
  return derivedDetail(
    tripDetailFixture({
      days: [
        { dayId: D1, activityIds: [a1, a2], date: null, costSubtotal: 0 },
        { dayId: D2, activityIds: [b1, b2], date: null, costSubtotal: 0 },
      ],
      activities: {
        [a1]: activity(a1, "Colosseum", { start: "09:00", end: "11:00" }),
        [a2]: activity(a2, "Forum", { start: "10:00", end: "12:00" }),
        [b1]: activity(b1, "Vatican", { start: "09:00", end: "11:00" }),
        [b2]: activity(b2, "Trastevere", { start: "10:00", end: "12:00" }),
      },
    }),
  );
}
```

Then the new cases:

```typescript
describe("resolveBatch — the running state tracks removals and moves", () => {
  it("renumbers day refs after a RemoveDay earlier in the same batch", () => {
    // days [D1,D2,D3]; removing day 1 makes the OLD day 3 the new "day 2".
    const detail = tripWithDays([D1, D2, D3]);
    const { commands, errors } = resolve(
      [
        { type: "RemoveDay", args: { dayRef: "day 1" } },
        { type: "AddActivity", args: { title: "Lunch", dayRef: "day 2" } },
      ],
      detail,
    );

    expect(errors).toEqual([]);
    expect((commands[0] as Extract<BatchableCommand, { type: "RemoveDay" }>).dayId).toBe(D1);
    // The append-only projection resolved this to D2. It must be D3.
    expect((commands[1] as Extract<BatchableCommand, { type: "AddActivity" }>).dayId).toBe(D3);
  });

  it("drops a ref to a day the batch already removed, instead of aborting the batch", () => {
    // The escalation case: previously both commands 'resolved', then the whole
    // atomic batch rolled back on day-not-found. Now the second is dropped.
    const detail = tripWithDays([D1, D2]);
    const { commands, errors } = resolve(
      [
        { type: "RemoveDay", args: { dayRef: "day 1" } },
        { type: "AddActivity", args: { title: "Orphan", dayRef: D1 } },
      ],
      detail,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]!.type).toBe("RemoveDay");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1, type: "AddActivity" });
  });

  it("scrubs a removed activity from title resolution", () => {
    const detail = tripWithDays([D1]);
    const { commands, errors } = resolve(
      [
        { type: "AddActivity", args: { title: "Museum", dayRef: "day 1" } },
        { type: "RemoveActivity", args: { activityRef: "Museum" } },
        { type: "UpdateActivity", args: { activityRef: "Museum", notes: "too late" } },
      ],
      detail,
    );

    expect(commands).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 2, type: "UpdateActivity" });
    expect(errors[0]!.message).toMatch(/no activity named/i);
  });

  it("tracks a MoveActivity, so repeating it is a skipped no-op", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const detail = tripDetailFixture({
      days: [
        { dayId: D1, activityIds: [a], date: null, costSubtotal: 0 },
        { dayId: D2, activityIds: [], date: null, costSubtotal: 0 },
      ],
      activities: { [a]: activity(a, "Museum", null) },
    });
    const move: RawToolIntent = { type: "MoveActivity", args: { activityRef: "Museum", dayRef: "day 2", position: 0 } };

    const { commands, errors } = resolve([move, move], detail);

    expect(commands).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("no-op");
  });
});

describe("resolveBatch — a domain rejection drops one command, never the batch", () => {
  it("skips a no-op sub-command and keeps the rest", () => {
    const detail = tripWithDays([D1]); // fixture currency is already USD
    const { commands, errors } = resolve(
      [
        { type: "SetTripCurrency", args: { currency: "USD" } },
        { type: "AddDay", args: {} },
      ],
      detail,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]!.type).toBe("AddDay");
    expect(errors[0]).toMatchObject({ type: "SetTripCurrency", code: "no-op" });
  });

  it("drops a second dismissal of the same conflict with the domain's own code", () => {
    const detail = tripWithTwoConflicts();
    const dismiss: RawToolIntent = { type: "DismissConflict", args: { conflictRef: 1 } };

    const { commands, errors } = resolve([dismiss, dismiss], detail);

    expect(commands).toHaveLength(1);
    expect(errors[0]!.code).toBe("conflict-already-dismissed");
  });

  it("resolves DismissConflict by its 1-based ref to the real (derivable) conflict id", () => {
    const detail = tripWithTwoConflicts();
    const expected = detail.conflicts[1]!.id;

    const { commands, errors } = resolve([{ type: "DismissConflict", args: { conflictRef: 2 } }], detail);

    expect(errors).toEqual([]);
    expect((commands[0] as Extract<BatchableCommand, { type: "DismissConflict" }>).conflictId).toBe(expected);
  });
});
```

Add `const D3 = "33333333-3333-4333-8333-333333333333";` next to `D1`/`D2`, delete the two old `DismissConflict` cases (the "isn't in the context" one keeps working against `tripWithDays([D1])` — it fails at ref resolution, before decide — so keep it), and route every existing call through the updated `resolve()` helper.

- [ ] **Step 2: Run — expect FAIL** (`actorId` is not a parameter yet; the new expectations don't hold)

Run: `cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai/batchResolver.test.ts`

- [ ] **Step 3: Rewrite `batchResolver.ts`.** Replace the header comment, the `BatchProjection` class, and `resolveBatch`:

```typescript
// Resolves a batch of raw AI tool intents (human refs, no model-supplied UUIDs)
// into concrete BatchableCommands in ONE ordered, DOMAIN-ACCURATE pass.
//
// Why a deferred pass instead of resolving inside each tool's execute(): a
// command can reference an entity CREATED EARLIER IN THE SAME BATCH — "add a
// day, then put lunch on it". Resolving each call against the frozen pre-batch
// trip makes that new day invisible.
//
// Why a real TripState instead of a bespoke projection: refs also depend on what
// the batch REMOVES and MOVES. Day refs are positional ("day 2"), so a RemoveDay
// earlier in the batch renumbers every later day ref, and a RemoveActivity
// invalidates a later title ref. An append-only mirror got both silently wrong.
// So we hold the real TripState and advance it with the real decideTripCommand +
// evolveTrip — the same functions executeTripCommandBatch will run — which buys:
//   1. removals/moves reflected for later refs, with exact domain semantics;
//   2. a command the domain WOULD reject is dropped here, so one bad
//      sub-command can no longer abort the whole atomic batch downstream;
//   3. a `no-op` sub-command skipped exactly as the batch executor skips it.
// The server owns every id — `inject` (tripId), `mint` (new day/activity ids),
// `ref` (resolve a human ref to an existing id) — driven entirely by ID_FIELDS.
// Errors are per-command: a drop removes just that command (recorded in
// `errors`, with the domain's own rejection `code`); the rest still form one
// atomic batch.
import { randomUUID } from "node:crypto";
import { BatchableCommand, type TripDetail } from "@tc/contracts";
import { decideTripCommand, evolveTrip, tripStateFromDetail, type TripState } from "@tc/domain";
import { activeConflicts } from "./context";
import { ID_FIELDS, REF_PARAM_NAMES, refParamName, type IdRole, type RefEntity } from "./idFields";

export interface BatchResolutionError {
  // The model's EMISSION position — kept stable so a caller can line an error
  // up with `meta.toolCalls` regardless of the order commands were resolved in.
  index: number;
  type: BatchableCommand["type"];
  // The domain rejection code (`no-op`, `day-not-found`, …) or a resolver code
  // (`unresolved-ref`, `invalid-command`). `no-op` is informational, not a
  // failure — callers should exclude it from user-facing "couldn't do that" counts.
  code: string;
  message: string;
}

type ConflictRefMap = ReadonlyMap<number, string>;

// Ref lookups read the CURRENT state directly rather than maintaining parallel
// indices — that duplicated bookkeeping is exactly what drifted. A trip holds
// tens of entities and a batch tens of refs, so the rescan is free, and there
// is precisely one source of truth for what exists.
function resolveDay(state: TripState, refVal: unknown): Resolved<string | null> {
  if (refVal === undefined || refVal === null) return { ok: true, value: null };
  if (typeof refVal === "number") return dayByNumber(state, refVal, String(refVal));

  const s = String(refVal).trim();
  if (s.toLowerCase() === "backlog") return { ok: true, value: null };
  if (UUID_RE.test(s)) {
    return state.days.some((d) => d.dayId === s)
      ? { ok: true, value: s }
      : { ok: false, error: `No day with id ${s} exists on this trip at that point in the batch.` };
  }
  const m = /^(?:day\s*)?(\d+)$/i.exec(s);
  if (!m) {
    return { ok: false, error: `Couldn't read “${refVal}” as a day. Use "day N" (1-based), a dayId, or "backlog".` };
  }
  return dayByNumber(state, Number(m[1]), `“${refVal}”`);
}

function dayByNumber(state: TripState, n: number, label: string): Resolved<string | null> {
  if (!Number.isInteger(n) || n < 1 || n > state.days.length) {
    return {
      ok: false,
      error: `Day ${label} is out of range — this trip has ${state.days.length} day(s) at that point in the batch.`,
    };
  }
  return { ok: true, value: state.days[n - 1]!.dayId };
}

function resolveActivity(state: TripState, refVal: unknown): Resolved<string> {
  if (typeof refVal !== "string" || refVal.trim() === "") {
    return { ok: false, error: "An activity reference (title or id) is required." };
  }
  const s = refVal.trim();
  if (UUID_RE.test(s)) {
    return state.activities[s] !== undefined
      ? { ok: true, value: s }
      : { ok: false, error: `No activity with id ${s} exists on this trip at that point in the batch.` };
  }
  const key = s.toLowerCase();
  const matches = Object.entries(state.activities)
    .filter(([, a]) => a.title.trim().toLowerCase() === key)
    .map(([id]) => id);
  if (matches.length === 0) {
    return { ok: false, error: `No activity named “${refVal}”. Use its exact title (as shown in context) or its id.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `“${refVal}” matches ${matches.length} activities. Reference the one you mean by its exact id.`,
    };
  }
  return { ok: true, value: matches[0]! };
}

// Conflict ref numbering is PINNED to the pre-batch envelope: the model
// referenced the list it was shown, so it must not renumber as the batch changes
// which conflicts are active. Whether the conflict is STILL active when the
// dismissal is decided is decideTripCommand's call, not the ref map's.
function resolveConflict(byRef: ConflictRefMap, refVal: unknown): Resolved<string> {
  const n = typeof refVal === "number" ? refVal : Number(String(refVal).trim());
  if (!Number.isInteger(n)) {
    return { ok: false, error: `Couldn't read “${refVal}” as a conflict number. Use its ref from the context's conflicts list.` };
  }
  const id = byRef.get(n);
  return id !== undefined
    ? { ok: true, value: id }
    : { ok: false, error: `No conflict #${n} in the context — only listed conflicts can be dismissed.` };
}

function resolveRef(
  state: TripState,
  byRef: ConflictRefMap,
  entity: RefEntity,
  refVal: unknown,
): Resolved<string | null> {
  switch (entity) {
    case "day":
      return resolveDay(state, refVal);
    case "activity":
      return resolveActivity(state, refVal);
    case "conflict":
      return resolveConflict(byRef, refVal);
  }
}

export function resolveBatch(
  intents: RawToolIntent[],
  detail: TripDetail,
  opts: { tripId: string; actorId: string; mintId?: () => string },
): ResolvedBatch {
  const { tripId, actorId, mintId = randomUUID } = opts;
  let state = tripStateFromDetail(detail);
  const conflictIdByRef: ConflictRefMap = new Map(activeConflicts(detail).map((c) => [c.ref, c.id] as const));
  const commands: BatchableCommand[] = [];
  const errors: BatchResolutionError[] = [];

  for (const { intent, index } of orderIntents(intents)) {
    const spec = ID_FIELDS[intent.type];
    const command: Record<string, unknown> = { type: intent.type, tripId };

    // Copy every literal field the model supplied; the `<entity>Ref` params are
    // resolved below into their real id fields, so they never pass through raw.
    for (const [key, value] of Object.entries(intent.args)) {
      if (!REF_PARAM_NAMES.has(key)) command[key] = value;
    }

    let failure: { code: string; message: string } | undefined;
    for (const [field, role] of Object.entries(spec) as [string, IdRole][]) {
      if (role.role === "mint") {
        command[field] = mintId();
        continue;
      }
      if (role.role !== "ref") continue;
      const resolved = resolveRef(state, conflictIdByRef, role.entity, intent.args[refParamName(role.entity)]);
      if (!resolved.ok) {
        failure = { code: "unresolved-ref", message: resolved.error };
        break;
      }
      if (resolved.value === null) {
        // A "no day" ref: obey the field's backlog policy, or reject if it has
        // none (the command genuinely needs an existing day).
        if (role.backlog === "null") command[field] = null;
        else if (role.backlog !== "omit") {
          failure = { code: "unresolved-ref", message: "This command needs a specific day, not the backlog." };
          break;
        }
        // "omit": leave the field unset (= backlog).
      } else {
        command[field] = resolved.value;
      }
    }

    if (failure === undefined) {
      // The typed choke point: a resolved command becomes a domain command only
      // by PARSING against the contract, never an unchecked cast. A failure means
      // a ref resolver or the manifest has drifted from BatchableCommand.
      // `.parse` also strips stray keys, so what we collect is exactly the shape.
      const parsed = BatchableCommand.safeParse(command);
      if (!parsed.success) {
        failure = { code: "invalid-command", message: `Could not build a valid command: ${parsed.error.message}` };
      } else {
        // Dry-run the SAME decision executeTripCommandBatch will make. A
        // rejection here would have aborted the whole atomic batch downstream;
        // dropping it now keeps every other command applicable.
        const decision = decideTripCommand(state, parsed.data, { actorId });
        if (decision.ok) {
          for (const event of decision.events) state = evolveTrip(state, event);
          commands.push(parsed.data);
          continue;
        }
        failure = decision.rejection;
      }
    }

    errors.push({ index, type: intent.type, code: failure.code, message: failure.message });
  }

  return { commands, errors };
}
```

`orderIntents` is a placeholder until Task 9 — for this task it is the identity walk, so the fold stays strictly emission-ordered:

```typescript
// Task 9 replaces this with the AddDay hoist. `index` is the model's emission
// position and stays attached to the intent through any reordering.
function orderIntents(intents: RawToolIntent[]): { intent: RawToolIntent; index: number }[] {
  return intents.map((intent, index) => ({ intent, index }));
}
```

**What to keep vs. delete in that file:** delete the `BatchProjection` class outright — every one of its lookups is now a free function over `state`. Keep `RawToolIntent`, `ResolvedBatch`, `UUID_RE`, and the `Resolved<T>` alias unchanged; the new free functions use all four. `BatchResolutionError` is replaced by the version above (it gains `code`).

- [ ] **Step 4: Thread `actorId` through the handler** — `handleAiRequest.ts` (this is required for `typecheck` to pass):

```typescript
  const { commands, errors: resolutionErrors } = resolveBatch(planning.getCollected(), detail, {
    tripId,
    actorId: userId,
  });
```

And exclude informational no-ops from the user-facing count — a redundant `SetTripCurrency` is not something the user needs told about:

```typescript
  const skipped = resolutionErrors.filter((e) => e.code !== "no-op");
  const message =
    skipped.length > 0
      ? `${summary} (${skipped.length} other change${skipped.length === 1 ? "" : "s"} couldn't be matched and ${skipped.length === 1 ? "was" : "were"} skipped.)`
      : summary;
```

Apply the same `skipped.length > 0` test to the `commands.length === 0` branch's message choice.

> This supersedes Task 0's optional-polish note: an all-no-op AI request now resolves to zero commands and returns the friendly 200 "I couldn't turn that into any changes" response, never reaching `executeTripCommandBatch`'s 400.

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai/batchResolver.test.ts
pnpm --filter web typecheck && pnpm --filter web lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/ai/batchResolver.ts apps/web/src/server/ai/batchResolver.test.ts apps/web/src/server/ai/handleAiRequest.ts
git commit -m "fix(M7): resolve the AI batch against a real TripState — removals/moves tracked, rejections dropped not aborted"
```

---

## Task 8: Name the cause of a cascaded drop

Closes gap-review failure (3): when the command that would have created "Museum" is itself dropped, the later ref's error should say so.

**Files:**
- Modify: `apps/web/src/server/ai/batchResolver.ts`
- Modify: `apps/web/src/server/ai/batchResolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("resolveBatch — cascaded drops name their cause", () => {
  it("links a title ref to the dropped command that would have created it", () => {
    const detail = tripWithDays([D1]);
    const { commands, errors } = resolve(
      [
        { type: "AddActivity", args: { title: "Museum", dayRef: "day 9" } }, // dropped: out of range
        { type: "UpdateActivity", args: { activityRef: "Museum", notes: "opens late" } },
      ],
      detail,
    );

    expect(commands).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[1]!.causeIndex).toBe(0);
    expect(errors[1]!.message).toMatch(/would have created/i);
  });

  it("leaves an unrelated failure uncaused", () => {
    const detail = tripWithDays([D1]);
    const { errors } = resolve([{ type: "RemoveActivity", args: { activityRef: "Ghost" } }], detail);

    expect(errors[0]!.causeIndex).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`causeIndex` doesn't exist)

- [ ] **Step 3: Implement.** Add the field to the interface:

```typescript
  // When this drop was CAUSED by an earlier drop — the command that would have
  // created the entity this one references — the earlier command's emission
  // index. Without it a cascade reads as N unrelated failures.
  causeIndex?: number;
```

Add the tracking map in `resolveBatch` (next to `errors`) and the explain helper:

```typescript
  // Titles an earlier DROPPED command would have created or renamed. A later ref
  // to one of them fails for a real reason ("No activity named X") that points at
  // the wrong thing — this lets the error name the actual cause.
  const droppedTitles = new Map<string, number>();
```

Replace the final `errors.push(...)` with:

```typescript
    errors.push(explain({ index, type: intent.type, code: failure.code, message: failure.message }, intent.args, droppedTitles));
    // Recorded AFTER explain(), so a command that both references and sets the
    // same title can never be cited as its own cause.
    const title = typeof intent.args.title === "string" ? intent.args.title.trim().toLowerCase() : undefined;
    if (title !== undefined && !droppedTitles.has(title)) droppedTitles.set(title, index);
```

```typescript
function explain(
  error: BatchResolutionError,
  args: Record<string, unknown>,
  droppedTitles: Map<string, number>,
): BatchResolutionError {
  const ref = args[refParamName("activity")];
  if (typeof ref !== "string") return error;
  const causeIndex = droppedTitles.get(ref.trim().toLowerCase());
  if (causeIndex === undefined) return error;
  return {
    ...error,
    causeIndex,
    message: `${error.message} (The earlier change that would have created “${ref}” was itself skipped.)`,
  };
}
```

- [ ] **Step 4: Run — expect PASS.** Then `pnpm --filter web typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/batchResolver.ts apps/web/src/server/ai/batchResolver.test.ts
git commit -m "fix(M7): cascaded batch drops report their causing command"
```

---

## Task 9: Hoist `AddDay` — and pin the approaches we rejected

Recovers backward day refs. The safety argument is in the gap review: `evolveTrip` **appends** a new day (`evolve.ts:46`), and appends never renumber existing days.

**Files:**
- Modify: `apps/web/src/server/ai/batchResolver.ts` (`orderIntents`)
- Modify: `apps/web/src/server/ai/batchResolver.test.ts`

- [ ] **Step 1: Write the failing tests.** The first is the feature; the rest are hazard pins that must FAIL if anyone later swaps in a fixpoint or a phase sort.

```typescript
describe("resolveBatch — AddDay hoisting", () => {
  it("resolves a day ref the model emitted BEFORE the AddDay that creates it", () => {
    const detail = tripWithDays([]); // no days yet
    const { commands, errors } = resolve(
      [
        { type: "AddActivity", args: { title: "Lunch", dayRef: "day 1" } },
        { type: "AddDay", args: {} },
      ],
      detail,
    );

    expect(errors).toEqual([]);
    // The AddDay is emitted FIRST in the batch — the executor decides in order,
    // so the day must exist before the activity lands on it.
    expect(commands[0]!.type).toBe("AddDay");
    const addDay = commands[0] as Extract<BatchableCommand, { type: "AddDay" }>;
    const lunch = commands[1] as Extract<BatchableCommand, { type: "AddActivity" }>;
    expect(lunch.dayId).toBe(addDay.dayId);
  });

  it("keeps error `index` at the model's emission position, not the resolved one", () => {
    const detail = tripWithDays([]);
    const { errors } = resolve(
      [
        { type: "RemoveActivity", args: { activityRef: "Ghost" } }, // emitted 1st, resolved 2nd
        { type: "AddDay", args: {} },
      ],
      detail,
    );

    expect(errors[0]!.index).toBe(0);
  });

  it("hoisting never retargets a ref to a pre-existing day", () => {
    // Appends don't renumber: "day 1" is D1 whether or not the AddDay runs first.
    const detail = tripWithDays([D1, D2]);
    const { commands, errors } = resolve(
      [
        { type: "RemoveDay", args: { dayRef: "day 1" } },
        { type: "AddDay", args: {} },
      ],
      detail,
    );

    expect(errors).toEqual([]);
    const removeDay = commands.find((c) => c.type === "RemoveDay") as Extract<BatchableCommand, { type: "RemoveDay" }>;
    expect(removeDay.dayId).toBe(D1);
  });
});

describe("resolveBatch — rejected orderings stay rejected", () => {
  it("does NOT phase-sort: a day ref keeps its emission-time meaning", () => {
    // days [D1,D2,D3]. The model asked for day 2 (=D2) BEFORE removing day 1.
    // A trip→day→activity phase sort would run the RemoveDay first and resolve
    // "day 2" to D3 — a silent wrong target. Emission order is the intent.
    const detail = tripWithDays([D1, D2, D3]);
    const { commands, errors } = resolve(
      [
        { type: "AddActivity", args: { title: "Lunch", dayRef: "day 2" } },
        { type: "RemoveDay", args: { dayRef: "day 1" } },
      ],
      detail,
    );

    expect(errors).toEqual([]);
    expect((commands.find((c) => c.type === "AddActivity") as Extract<BatchableCommand, { type: "AddActivity" }>).dayId).toBe(D2);
  });

  it("does NOT retry to a fixpoint: a backward TITLE ref stays dropped", () => {
    // A fixpoint would retry the move after the AddActivity succeeds — applying
    // it out of emission order. Activities are not hoistable, so this drops.
    const detail = tripWithDays([D1]);
    const { commands, errors } = resolve(
      [
        { type: "MoveActivity", args: { activityRef: "Museum", dayRef: "day 1", position: 0 } },
        { type: "AddActivity", args: { title: "Museum", dayRef: "day 1" } },
      ],
      detail,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]!.type).toBe("AddActivity");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 0, type: "MoveActivity", code: "unresolved-ref" });
  });
});
```

Add a `tripWithDays([])` case — confirm the helper handles an empty array (it maps over `dayIds`, so it does).

- [ ] **Step 2: Run — expect the hoisting tests to FAIL** and the two "rejected orderings" tests to PASS already (they pin current behavior; they exist so a future reordering change can't land silently).

- [ ] **Step 3: Replace `orderIntents`**

```typescript
// AddDay is the ONLY command that creates something a POSITIONAL ref can point
// at, and evolveTrip APPENDS it (`days: [...state.days, new]`, evolve.ts:46).
// Appends never renumber existing days — so moving every AddDay to the front,
// relative order preserved, provably cannot change what a ref to a pre-existing
// day means. All it does is make a day the model referenced before adding
// ("day 3" emitted before the third AddDay) resolvable, and give the emitted
// batch an order the executor can apply (the AddDay must be decided before the
// command that targets it, or the batch aborts on day-not-found).
//
// Activities are deliberately NOT hoisted: an AddActivity's title changes which
// activity a later title ref matches, and its day/position placement depends on
// the state at its emission point. Backward TITLE refs therefore stay dropped —
// see docs/known-issues.md KI-10. Reordering everything (a phase sort) or
// retrying to a fixpoint both reintroduce silent wrong targets; the gap-review
// section of this plan records why, and the tests above pin it.
//
// `index` is the model's emission position and rides along through the
// reordering, so errors still line up with `meta.toolCalls`.
function orderIntents(intents: RawToolIntent[]): { intent: RawToolIntent; index: number }[] {
  const numbered = intents.map((intent, index) => ({ intent, index }));
  const isAddDay = (e: { intent: RawToolIntent }) => e.intent.type === "AddDay";
  return [...numbered.filter(isAddDay), ...numbered.filter((e) => !isAddDay(e))];
}
```

- [ ] **Step 4: Run — expect PASS** (whole `batchResolver.test.ts`, then `typecheck` + `lint`).

> `AddDay` can only be rejected with `day-already-exists`, which is impossible against a freshly minted id — so hoisting can never itself cause a drop.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/batchResolver.ts apps/web/src/server/ai/batchResolver.test.ts
git commit -m "fix(M7): hoist AddDay so a day referenced before it is added resolves"
```

---

## Task 10: End-to-end proof + known-issues entry

**Files:**
- Modify: `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts` (DB-gated)
- Modify: `docs/known-issues.md`

- [ ] **Step 1: Add the int test** (inside the `describe("POST /api/trips/:id/ai")` block)

```typescript
  it("board surface: a removal and a dependent add apply as one partial batch", async () => {
    const tripId = await seedTrip();
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, "user-1");
    const keptDayId = randomUUID();
    await executeTripCommand({ type: "AddDay", tripId, dayId: keptDayId }, "user-1");

    // After RemoveDay(day 1), "day 1" is what was day 2 — the resolver must see
    // the removal. Before the dry-run this either targeted the removed day (and
    // aborted the WHOLE batch on day-not-found) or silently hit the wrong day.
    const model = modelWithToolCalls([
      toolCall("RemoveDay", { dayRef: "day 1" }),
      toolCall("AddActivity", { title: "Dinner", dayRef: "day 1" }),
    ]);
    const res = await handleAiRequest(
      req(tripId, { prompt: "drop the first day and add dinner to the remaining one", surface: "board" }),
      tripId,
      model,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail.days).toHaveLength(1);
    expect(body.detail.days[0].dayId).toBe(keptDayId);
    expect(body.detail.days[0].activityIds).toHaveLength(1);
    expect(body.resolutionErrors).toEqual([]);
  });
```

Match the file's existing helper names/signatures (`seedTrip`, `req`, `modelWithToolCalls`, `toolCall`, `executeTripCommand`) — adjust if they differ.

- [ ] **Step 2: Run** (needs the migrated test Postgres; `beforeEach` wipes trip tables — NEVER the dev DB). If unavailable here, note it and rely on the unit coverage.

Run: `pnpm --filter web test:int -- route.int.test.ts`

> Re-run the *whole* file: the dry-run changes which commands reach the batch, so a pre-existing test whose mock emits a redundant command now sees it skipped at resolve time rather than executed.

- [ ] **Step 3: Log the residual constraint in `docs/known-issues.md`**

```markdown
### KI-10 — AI batches don't recover a reference to an activity created later in the same batch

- **Symptom:** if the model emits `UpdateActivity{activityRef:"Museum"}` *before* the `AddActivity` that creates "Museum", the update is dropped with `No activity named "Museum"`. Day refs do not have this problem — `AddDay` intents are hoisted to the front of the batch (`batchResolver.ts`, `orderIntents`).
- **Why it isn't fixed:** hoisting works for days because `evolveTrip` appends them, so it cannot renumber a ref to an existing day. Activities have no such property: hoisting an `AddActivity` changes which activity a later title ref resolves to, and its day/position placement depends on the state where it was emitted. The two general repairs — a fixpoint retry loop and a trip→day→activity phase sort — both apply commands out of emission order and so silently retarget positional day refs. See the gap-review section of `docs/plans/2026-07-25-ai-id-resolver-refactor.md` for the full comparison; `batchResolver.test.ts`'s "rejected orderings stay rejected" block pins the decision.
- **Mitigation:** the system prompt tells the model to create before referencing, the drop is reported in `resolutionErrors`, and a cascaded drop names its causing command via `causeIndex`.
- **First noted:** 2026-07-25 (gap review of the committed `resolveBatch`).
```

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts" docs/known-issues.md
git commit -m "test(M7): int — removal + dependent add applies as one partial batch; log KI-10"
```

---

## Task 11: Full verification + PR

- [ ] **Step 1: Whole-repo checks**

The domain package now carries part of this change (Task 6), so it is no longer enough to run `apps/web` alone:

```bash
pnpm --filter @tc/domain test   # includes the detail→state→detail round-trip
pnpm --filter web typecheck     # exit 0
pnpm --filter web lint          # clean
cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai
# Expected: batchResolver (23), idFields (2), planningTools (4), context, gateway, pageTools, planSummary — all pass
```

`batchResolver` goes 10 → 23: 9 of the original cases unchanged, the `DismissConflict` ref case rewritten against derivable conflicts (Task 7), and 13 new across Tasks 7–9.

With the test Postgres available, also run the DB-gated suites (Tasks 0, 4, 10):

```bash
pnpm --filter web test:int -- commands.int.test.ts   # no-op batch tolerance
pnpm --filter web test:int -- route.int.test.ts       # server-mint, intra-batch dependency, partial batch
```

- [ ] **Step 2: Sanity — the AI surface exposes no uuid params.** Confirm no planning tool's inputSchema contains `activityId`, `dayId`, `toDayId`, or `conflictId` (only `activityRef`/`dayRef`/`conflictRef`). The Task 1 test already asserts the key ones; eyeball the rest if desired.

- [ ] **Step 3: Sanity — the resolver has no parallel bookkeeping left.** The whole point of Tasks 6–9 is one source of truth for what exists. Confirm it stayed that way:

```bash
grep -n "class BatchProjection\|addDay(\|addActivity(\|titleIndex\|daySet" apps/web/src/server/ai/batchResolver.ts
# Expected: no matches — every lookup reads the running TripState directly.
```

- [ ] **Step 4: Push**

The work lives directly on `claude/ai-id-resolver-refactor-plan-f83bd6`, which already carries Tasks 0–4. Push the completed tasks:

```bash
git push origin claude/ai-id-resolver-refactor-plan-f83bd6
```

Confirm the branch's PR (or open one against `main`) describes the gap review as well as the original refactor — the dry-run is a behavior change to how AI batches partially apply, not just an internal cleanup.

---

## Gotchas / context the executor needs

- **Branch.** Work continues directly on `claude/ai-id-resolver-refactor-plan-f83bd6`, which already carries Tasks 0–4 (through `4c939eb`). If other AI-surface commits land, pull before continuing.
- **KI-8 is what you're replacing.** The current `planningTools.ts` (before Task 1) has four per-tool branches (AddActivity/RemoveDay/DismissConflict/REF_TOOL_TYPES) + a `collect()` safeParse. All of that behavior now lives in the manifest + `resolveBatch`. Don't reintroduce per-tool code.
- **Deferred resolution = no mid-generation self-correction.** The old design let a bad ref surface as a tool result mid-request; the new design resolves after generation. This is intentional (eager resolution can't see a day the batch is about to add) — errors surface in `resolutionErrors`/`meta` instead.
- **Partial apply, and what still aborts.** A bad ref *or a command the domain would reject* drops that one command (Task 7); the survivors still submit as one atomic batch. What remains genuinely atomic: if a command that passed the dry-run is nonetheless rejected when the batch executes, the whole batch rolls back. That is now rare rather than routine — see the concurrency note below for the one way it still happens.
- **The dry-run decides against the projection; the batch decides against the log.** `resolveBatch` works from `guard()`'s `TripDetail` (the read model), while `executeTripCommandBatch` folds the event stream. Invariant 2 ("rebuild equals stored") makes those identical *at rest*, so a divergence means a concurrent write landed between the two — which surfaces as a real batch rejection or `concurrency-conflict`. Unchanged by this plan, and correct: the log wins. Don't "fix" it by having the resolver skip the dry-run.
- **Don't reintroduce parallel bookkeeping.** The bug class Tasks 6–9 close came from a second, hand-maintained model of what exists. Ref lookups rescan the running `TripState` on purpose. If a profile ever shows that mattering (it won't at trip scale), cache *derived from* the state — never alongside it.
- **`decideTripCommand` uses the DEFAULT conflict context, not `serverConflictContext()`.** Its `DismissConflict` branch calls `detectConflicts(state)` with no ctx (`decide.ts:178`). The dry-run inherits exactly that, so resolver and executor agree by construction. Don't pass `serverConflictContext()` into the resolver to make it "more accurate" — that would make them disagree.
- **Conflict `ref` numbering is pinned to the pre-batch envelope.** `activeConflicts` (`context.ts`) numbers the list the model was *shown*; the map must not renumber as the batch changes which conflicts are active. Whether a conflict is still dismissible at that point is `decideTripCommand`'s call, and a stale dismissal now drops instead of aborting.
- **A fixture with hand-written `conflicts` is a trap.** Conflict ids are content-derived, so an asserted-but-underivable conflict passes ref resolution and then fails `decide`. Build conflict fixtures through `tripDetailFromState(tripStateFromDetail(...))` (Task 7's `derivedDetail`) so the document describes a trip that can actually exist.
- **Zod strips unknown keys.** An old client/mock passing `dayId`/`activityId` to a now-id-less tool schema is harmless — the field is stripped, the server mints.
- **The system prompt's ordering instruction still earns its keep.** `AddDay` hoisting removes the day half of the problem, but backward *title* refs (KI-10) are still dropped, so keep telling the model to create before referencing.
- **Do NOT run `*.int.test.ts` against the dev DB** — `beforeEach` deletes trip tables.
