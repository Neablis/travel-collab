# AI id-resolver refactor — manifest-driven, server-minted, batch-aware

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI planning surface never handle a UUID — the model references entities by human terms only; the server injects/mints/resolves every id — driven by one manifest instead of per-tool code, and resolving references against the trip *as the batch builds it*.

**Architecture:** A single id-field manifest (`idFields.ts`) classifies every command field as `inject` / `mint` / `ref`. `buildPlanningTools` derives each tool's schema from it (drop inject+mint, swap ref→`<entity>Ref`) and records the model's raw intents. After generation, one pure, ordered, batch-aware pass (`resolveBatch`) mints new ids, resolves refs against a running projection (so "add a day, then put lunch on it" works), and drops unresolvable commands — then the survivors go as one atomic batch. This SUPERSEDES KI-8's four per-tool `execute()` branches.

**Tech Stack:** Next.js (App Router) + TypeScript, Zod, Vercel AI SDK v7 (`ai`), Vitest, Drizzle/Postgres (int tests only).

## Global Constraints

- Tool schemas are DERIVED from `@tc/contracts` `BatchableCommand`, never hand-written duplicates (ADR-015 / Invariant 5).
- The AI never emits, copies, or invents a UUID — for existing OR new entities.
- Atomic batches only (ADR-013): resolved survivors submit as ONE `executeTripCommandBatch` call.
- Money is integer minor units; keep the money-units notes on money-bearing tools (regression risk — KI-8 added them).
- Conflicts are referenced by their 1-based `ref` from the envelope's `activeConflicts`, never a raw conflict id.
- `pnpm --filter web typecheck` and `pnpm --filter web lint` must stay green. Unit tests run under the jsdom runner (`vitest.unit.config.ts`); `*.int.test.ts` need a migrated test Postgres and are DB-gated.

---

## Starting state (already done on branch `claude/ai-id-resolver-refactor`)

These are committed and verified — **do not rebuild them**:

- **`apps/web/src/server/ai/idFields.ts`** — the manifest. Exports `ID_FIELDS` (mapped exhaustively over `BatchableCommand["type"]`), `IdRole`, `RefEntity`, `refParamName(entity)`, `REF_PARAM_NAMES`.
- **`apps/web/src/server/ai/batchResolver.ts`** — `resolveBatch(intents, detail, { tripId, mintId? })` → `{ commands, errors }`. Batch-aware ordered projection, server-minting, ref resolution (activity by title/id, day by "day N"/id/backlog, conflict by 1-based ref via `activeConflicts`), `BatchableCommand.safeParse` typed boundary. Exports `RawToolIntent`, `BatchResolutionError`, `ResolvedBatch`.
- **`apps/web/src/server/ai/batchResolver.test.ts`** — 10 tests, all green (incl. the "activity onto a day added earlier in the same batch" dependency case).

`planningTools.ts` and `handleAiRequest.ts` are at the KI-8 baseline (per-tool resolver). This plan replaces the planning-tools half and rewires the handler.

Verify starting state before Task 1:

```bash
cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai/batchResolver.test.ts
# Expected: Test Files 1 passed, Tests 10 passed
pnpm --filter web typecheck   # Expected: exit 0
```

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

## Task 5: Full verification + PR

- [ ] **Step 1: Whole-package checks**

```bash
pnpm --filter web typecheck   # exit 0
pnpm --filter web lint        # clean
cd apps/web && pnpm exec vitest run -c vitest.unit.config.ts src/server/ai
# Expected: batchResolver (10), idFields (2), planningTools (4), context, gateway, pageTools, planSummary — all pass
```

- [ ] **Step 2: Sanity — the AI surface exposes no uuid params.** Confirm no planning tool's inputSchema contains `activityId`, `dayId`, `toDayId`, or `conflictId` (only `activityRef`/`dayRef`/`conflictRef`). The Task 1 test already asserts the key ones; eyeball the rest if desired.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin claude/ai-id-resolver-refactor
gh pr create --base main --title "M7: manifest-driven, server-minted, batch-aware AI id resolution" \
  --body "Supersedes KI-8's per-tool ref resolver with one manifest-driven engine. The AI never handles a UUID (server injects tripId, mints new ids, resolves human refs). Resolution is batch-aware, so 'add a day then put an activity on it' works. Fixes the remaining gaps: intra-batch dependencies + model-minted UUIDs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

> **PR base decision:** target `main` if PR #15 (the M7 branch) has merged by then; otherwise target `claude/next-milestone-388cd0` to stack on it. Check with `gh pr view 15 --json state`.

---

## Gotchas / context the executor needs

- **Shared branch churn.** This branch forked from `claude/next-milestone-388cd0` at KI-8 (`2bfd185`) + main merge. If more AI-surface commits land there, rebase before the final push.
- **KI-8 is what you're replacing.** The current `planningTools.ts` (before Task 1) has four per-tool branches (AddActivity/RemoveDay/DismissConflict/REF_TOOL_TYPES) + a `collect()` safeParse. All of that behavior now lives in the manifest + `resolveBatch`. Don't reintroduce per-tool code.
- **Deferred resolution = no mid-generation self-correction.** The old design let a bad ref surface as a tool result mid-request; the new design resolves after generation. This is intentional (eager resolution can't see a day the batch is about to add) — errors surface in `resolutionErrors`/`meta` instead.
- **Partial apply.** A bad ref drops one command; the survivors still submit as one atomic batch. If a *resolved* command later fails in the domain (`decide.ts`), the whole batch still rejects atomically — that's correct.
- **Zod strips unknown keys.** An old client/mock passing `dayId`/`activityId` to a now-id-less tool schema is harmless — the field is stripped, the server mints.
- **`activeConflicts` is the single source of conflict `ref` numbering** (see `context.ts`); `resolveBatch` already resolves conflict refs through it — keep them in lockstep.
- **Do NOT run `*.int.test.ts` against the dev DB** — `beforeEach` deletes trip tables.
