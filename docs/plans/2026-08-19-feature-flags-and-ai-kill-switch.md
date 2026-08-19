# Feature Flags and the AI Kill Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add feature flagging via Vercel Flags, and use it to switch model calls between live and simulated so the deployed app can be shared publicly without token spend.

**Architecture:** `handleAiRequest` already accepts an injectable `LanguageModel` (a seam built for tests). The kill switch reuses it: flag off means a *different model*, not a different code path, so the whole pipeline — tool resolution, atomic batch, event append, projection — runs identically and the trip really changes. The response is marked `simulated: true`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, `flags@^4.3.0`, `@flags-sdk/vercel@^1.4.6`, AI SDK v7 (`ai@^7.0.34`), Vitest (unit + integration), Playwright, pnpm workspaces.

**Spec:** `docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md` — read it first; this plan argues from it.

## Global Constraints

- **The lint wall is law.** UI code may not import `@tc/domain` or `@/server/*`. Only `src/server/**`, `src/app/api/**`, and (after Task 2) `src/app/.well-known/**` are exempt. See `apps/web/eslint.config.mjs`.
- **The element wall is law.** In `.tsx`, no raw `button`/`input`/`h1`-`h6`/`table` and no `style=` attributes — render through `src/components/ui` primitives. Exceptions need a line-level `eslint-disable` with a reason.
- **TypeScript strict everywhere.** No `any` without a written justification.
- **A comment asserting an invariant must have a test enforcing it** (`AGENTS.md`, testing model). This applies to every comment written in this plan.
- **Flag key is exactly `ai-live`.** Value `true` = call a real model. Fail-closed default is `false`.
- **`AI_LIVE` is a local-dev and CI escape hatch only.** It is never set in a Vercel environment. Document it as bluntly as `AUTH_DEV_LOGIN`.
- **Money is integer minor units**; the simulated model emits no `cost` at all, so this should not come up.
- **Conventional commits**, scoped to one logical change: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- **Verification before completion:** run the command, read the output, then claim. `pnpm check` = `typecheck && lint && test`.

## Deviation from the spec, recorded

The spec's §1 sketch put the `aiLive()` accessor in `src/server/flags.ts`. This plan puts it in `src/server/ai/modelSelection.ts` instead, and keeps `flags.ts` **declarations-only**. Reason: `getProviderData(flags)` in Task 2 enumerates the module's exports and expects every one of them to be a flag definition — a stray exported function is at best skipped and at worst a runtime error. Splitting also makes `aiLive()` unit-testable by mocking `@/server/flags`, which a same-module call could not be. Nothing else in the spec changes.

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/server/flags.ts` | **Create.** Flag declarations only. No functions, no re-exports. |
| `apps/web/src/app/.well-known/vercel/flags/route.ts` | **Create.** Flags Explorer discovery endpoint. |
| `apps/web/eslint.config.mjs` | **Modify.** Widen the lint-wall exemption for `.well-known`. |
| `scripts/check-lint-wall.mjs` | **Modify.** Assert the wall still rejects `@/server/*` from ordinary UI. |
| `apps/web/src/server/ai/simulatedModel.ts` | **Create.** A hand-rolled `LanguageModelV4` emitting canned tool calls. |
| `apps/web/src/server/ai/modelSelection.ts` | **Create.** `aiLive()` + `selectAiModel()`. The only place the flag is read. |
| `apps/web/src/server/ai/handleAiRequest.ts` | **Modify.** `model` becomes optional; `simulated` threads into meta, notices, and every response body. |
| `apps/web/src/lib/apiClient.ts` | **Modify.** `simulated` on both AI client functions' results. |
| `apps/web/src/components/assistant/AssistantRail.tsx` | **Modify.** Render a "Simulated" badge. |
| `apps/web/src/components/board/TripBoardScreen.tsx` | **Modify.** Track and pass `simulated`. |
| `apps/web/src/components/pages/ai/ComposePanel.tsx` | **Modify.** Render a "Simulated" badge. |
| `.env.example` | **Modify.** `FLAGS_SECRET`, `AI_LIVE`. |
| `docs/architecture/ADR-019-…md` | **Create.** The decision record. |

---

### Task 1: Confirm Vercel Flags is available, then install the SDK

**This task is a gate.** Risk 1 in the spec is that the Flags product may not be enabled on this account. Find out before writing code that assumes it.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `flags` and `@flags-sdk/vercel` resolvable from `apps/web`; `FLAGS_SECRET` and `AI_LIVE` documented.

- [ ] **Step 1: Check whether the Flags product is enabled**

```bash
npx vercel flags ls
```

Expected: a list of flags (possibly empty), **not** an error about the feature being unavailable on the plan.

**If this fails because Flags is not available on the plan: STOP and report to Mitchell.** Do not improvise a different provider. The spec's fallback (a plain `decide()` over Edge Config) changes only `src/server/flags.ts`, but choosing it is Mitchell's call, not the implementer's.

- [ ] **Step 2: Install the SDK**

```bash
pnpm --filter web add flags@^4.3.0 @flags-sdk/vercel@^1.4.6
```

- [ ] **Step 3: Verify both packages resolve**

```bash
pnpm --filter web exec node -e "import('flags/next').then(m => console.log(typeof m.flag, typeof m.getProviderData, typeof m.createFlagsDiscoveryEndpoint))"
```

Expected: `function function function`

- [ ] **Step 4: Generate a flags secret and add both variables to `.env.example`**

Generate a value to give Mitchell for the Vercel dashboard:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Append to `.env.example`, after the `AI_MODEL` block:

```
# Flags Explorer auth (Vercel Flags). Required in preview/production for the
# .well-known/vercel/flags discovery endpoint; unset locally is fine — the
# endpoint just 401s. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
FLAGS_SECRET=
# LOCAL/CI ESCAPE HATCH ONLY. NEVER set this in a Vercel environment — it
# overrides the `ai-live` feature flag entirely, which is the one control
# standing between a shared deployment and an unbounded AI token bill.
# false = the AI endpoint returns a simulated plan and calls no model.
AI_LIVE=false
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml .env.example
git commit -m "chore(flags): add the Flags SDK and document FLAGS_SECRET / AI_LIVE"
```

---

### Task 2: The flag declaration, the discovery endpoint, and the lint wall

**Files:**
- Create: `apps/web/src/server/flags.ts`
- Create: `apps/web/src/app/.well-known/vercel/flags/route.ts`
- Modify: `apps/web/eslint.config.mjs:20`
- Modify: `scripts/check-lint-wall.mjs`

**Interfaces:**
- Consumes: `flags`, `@flags-sdk/vercel` from Task 1.
- Produces: `aiLiveFlag` — an awaitable `() => Promise<boolean>` exported from `@/server/flags`. Task 4 imports it and nothing else does.

- [ ] **Step 1: Write the flag declaration**

Create `apps/web/src/server/flags.ts`:

```ts
// Server-only, same rule as server/config.ts: never import this from UI code.
// Flag values reach the UI as props from a server component, never by a client
// component importing this module.
//
// DECLARATIONS ONLY. `getProviderData(flags)` in the discovery endpoint
// enumerates this module's exports and expects every one to be a flag
// definition — an exported helper function would be skipped at best and throw
// at worst. The `aiLive()` accessor therefore lives in ai/modelSelection.ts.
import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// When false, POST /api/trips/:id/ai returns a SIMULATED plan: a canned model
// emits tool calls, the real pipeline applies them, and the response carries
// `simulated: true`. No provider is contacted and no tokens are spent.
//
// `defaultValue: false` is deliberate and fails CLOSED — an unreachable Flags
// service degrades to simulated, never to spending. The Flags SDK uses
// defaultValue whenever `decide` returns undefined OR throws, adapter errors
// included, so this covers the outage case as well as the unconfigured one.
//
// No `decide` here on purpose: the SDK treats an explicitly provided `decide`
// as an OVERRIDE of the adapter, and returning `undefined` from it falls to
// `defaultValue` rather than through to the adapter. So a "check the env var,
// else ask Vercel" decide is not expressible — that override lives one level
// up, in aiLive().
export const aiLiveFlag = flag<boolean>({
  key: "ai-live",
  description:
    "When off, /api/trips/:id/ai returns a simulated plan instead of calling a model.",
  options: [
    { label: "Simulated", value: false },
    { label: "Live", value: true },
  ],
  defaultValue: false,
  adapter: vercelAdapter(),
});
```

- [ ] **Step 2: Write the discovery endpoint**

Create `apps/web/src/app/.well-known/vercel/flags/route.ts`:

```ts
// Flags Explorer discovery endpoint. Exposes this app's flag definitions to
// the Vercel Toolbar so a flag can be inspected and OVERRIDDEN PER SESSION on
// a preview deployment — which is how a reviewer turns on live AI for
// themselves without changing the value for everyone else.
//
// Authenticated by FLAGS_SECRET (createFlagsDiscoveryEndpoint verifies it).
// With the secret unset the endpoint 401s, which is the correct local-dev
// behavior — there is no toolbar to serve.
//
// The path is fixed by the Flags Explorer and is NOT under src/app/api, so
// eslint.config.mjs carries an explicit exemption for src/app/.well-known/**
// to let this file import @/server/*. See the comment there.
import { createFlagsDiscoveryEndpoint, getProviderData } from "flags/next";
import * as flags from "@/server/flags";

export const GET = createFlagsDiscoveryEndpoint(async () => getProviderData(flags));
```

- [ ] **Step 3: Run lint to watch the wall reject it**

```bash
pnpm --filter web lint
```

Expected: **FAIL**, on `src/app/.well-known/vercel/flags/route.ts`, with `"UI must call the API, not server internals (AGENTS.md lint wall)."`

This failure is the point. It proves the wall is live and that the exemption in the next step is load-bearing rather than decorative.

- [ ] **Step 4: Widen the exemption, with a reason**

In `apps/web/eslint.config.mjs`, in the lint-wall block (around line 17-20):

```diff
   {
     // THE LINT WALL (AGENTS.md): UI code may not touch the domain package or
     // server internals. Route handlers and src/server are the exempt shell.
+    // `.well-known` routes join that shell: they are protocol endpoints served
+    // to tooling, not UI, and their paths are fixed by the spec that defines
+    // them (the Flags Explorer requires exactly .well-known/vercel/flags), so
+    // they cannot be moved under src/app/api to inherit its exemption.
     files: ["src/**/*.{ts,tsx}"],
-    ignores: ["src/server/**", "src/app/api/**"],
+    ignores: ["src/server/**", "src/app/api/**", "src/app/.well-known/**"],
```

- [ ] **Step 5: Add the regression assertion to the lint-wall check**

`scripts/check-lint-wall.mjs` currently proves the wall rejects `@tc/domain` and permits `@tc/predict`. Step 4 widened the wall, so add proof it did not widen too far. Append before the final exit-code handling, following the file's existing `lintFixture` pattern:

```js
const serverInternals = lintFixture(
  "lint_wall_server_fixture",
  'import "@/server/flags";\nexport default function Fixture() { return null; }\n',
);
if (serverInternals.passed) {
  console.error("LINT WALL BREACHED: @/server/* import from UI was NOT flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: @/server/* import from UI correctly rejected");
}
```

This fixture is written to `apps/web/src/app/__lint_wall_server_fixture__.tsx` — ordinary UI, not under `.well-known` — so it exercises exactly the boundary Step 4 moved.

- [ ] **Step 6: Run lint and the wall check**

```bash
pnpm lint
```

Expected: PASS, including `lint wall OK: @/server/* import from UI correctly rejected`.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/server/flags.ts apps/web/src/app/.well-known apps/web/eslint.config.mjs scripts/check-lint-wall.mjs
git commit -m "feat(flags): declare the ai-live flag and expose the discovery endpoint"
```

---

### Task 3: The simulated model

**Files:**
- Create: `apps/web/src/server/ai/simulatedModel.ts`
- Test: `apps/web/src/server/ai/simulatedModel.test.ts`

**Interfaces:**
- Consumes: `type AiSurface` from `@/server/ai/context` (`"page" | "board" | "combined"`).
- Produces:
  - `simulatedModel(surface: AiSurface): LanguageModel`
  - `SIMULATED_MODEL_ID: string` — the value `"simulated/no-op"`, which appears in `meta.model.requested`.

**Background the implementer needs.** The AI SDK calls `doGenerate` once per step. `handleAiRequest` sets `stopWhen: isStepCount(32)` for board/combined. A fake that re-emits its tool calls on every `doGenerate` gets them collected and applied **once per remaining step** — 32 batches instead of one. The existing `modelThatNeverStops` helper in `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts` was written to document exactly this. So: tool calls on the first call, `"stop"` on every one after.

`LanguageModelV4` requires `specificationVersion: "v4"`, `provider`, `modelId`, `supportedUrls`, `doGenerate`, and `doStream`. `@ai-sdk/provider` is not a direct dependency of `apps/web`, so do not import the type by name — return `LanguageModel` (from `ai`, already a dependency) and let structural typing check the object literal.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/server/ai/simulatedModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { simulatedModel, SIMULATED_MODEL_ID } from "@/server/ai/simulatedModel";

// `simulatedModel` returns `LanguageModel`, which is `string | LanguageModelV4`
// — so `.doGenerate` is not reachable on the union — and LanguageModelV4 itself
// is not importable, because @ai-sdk/provider is not a direct dependency of
// apps/web. Narrow through one local structural type instead of fighting the
// union at every call site. `doGenerate` reads none of its options, so `{}`
// tests exactly as much as reconstructing LanguageModelV4CallOptions would.
type Call = { type: string; toolName: string; input: string; toolCallId: string };
type Generated = { content: Call[]; finishReason: { unified: string; raw: undefined } };
type Probe = {
  specificationVersion: string;
  modelId: string;
  doGenerate: (options: unknown) => Promise<Generated>;
  doStream: (options: unknown) => Promise<unknown>;
};

const probe = (surface: "page" | "board" | "combined") => simulatedModel(surface) as unknown as Probe;
const callsOf = (result: Generated) => result.content.filter((c) => c.type === "tool-call");

describe("simulatedModel", () => {
  it("identifies itself so meta.model.requested is honest", () => {
    expect(probe("board")).toMatchObject({ specificationVersion: "v4", modelId: SIMULATED_MODEL_ID });
    expect(SIMULATED_MODEL_ID).toBe("simulated/no-op");
  });

  it("emits two AddDay and three AddActivity calls for the board surface", async () => {
    const result = await probe("board").doGenerate({});
    expect(callsOf(result).map((c) => c.toolName)).toEqual([
      "AddDay",
      "AddDay",
      "AddActivity",
      "AddActivity",
      "AddActivity",
    ]);
    expect(result.finishReason).toEqual({ unified: "tool-calls", raw: undefined });
  });

  it("emits no location and no cost, so nothing reaches the geocoder or the wallet", async () => {
    const result = await probe("board").doGenerate({});
    for (const call of callsOf(result)) {
      const input = JSON.parse(call.input) as Record<string, unknown>;
      expect(input).not.toHaveProperty("location");
      expect(input).not.toHaveProperty("cost");
    }
  });

  it("emits one compose_page call for the page surface", async () => {
    const calls = callsOf(await probe("page").doGenerate({}));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe("compose_page");
    const input = JSON.parse(calls[0]!.input) as { title: string; blocks: unknown[] };
    expect(input.title).toBeTruthy();
    expect(input.blocks.length).toBeGreaterThan(0);
  });

  // The 32-step budget makes this the difference between one batch and 32.
  it("stops after the first step instead of re-emitting forever", async () => {
    const model = probe("board");
    await model.doGenerate({});
    const second = await model.doGenerate({});
    expect(second.finishReason).toEqual({ unified: "stop", raw: undefined });
    expect(callsOf(second)).toHaveLength(0);
  });

  it("gives each tool call a distinct id", async () => {
    const ids = callsOf(await probe("board").doGenerate({})).map((c) => c.toolCallId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses to stream rather than pretending to", async () => {
    await expect(probe("board").doStream({})).rejects.toThrow(/does not stream/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test -- simulatedModel
```

Expected: FAIL — `Failed to resolve import "@/server/ai/simulatedModel"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/server/ai/simulatedModel.ts`:

```ts
// The "AI is switched off" model (see docs/specs/2026-08-19-feature-flags-and-
// ai-kill-switch-design.md). It is a real LanguageModelV4 that contacts
// nothing: generateText calls doGenerate, gets canned tool calls back, and the
// rest of handleAiRequest proceeds exactly as it would for a real model —
// resolveBatch, the atomic batch, the event append, the projection. The trip
// really changes. That is the point: a shared deployment stays exercisable at
// zero token cost.
//
// Hand-rolled rather than `MockLanguageModelV4` from `ai/test`, so no test
// utility ships in the server bundle. Typed as `LanguageModel` (from `ai`, a
// direct dependency) rather than `LanguageModelV4` (from `@ai-sdk/provider`,
// which is not) — structural typing checks the literal either way.
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import type { AiSurface } from "@/server/ai/context";

export const SIMULATED_MODEL_ID = "simulated/no-op";

// Zero, honestly: nothing was spent. Shape matches AI SDK v7's
// LanguageModelV4Usage (nested objects, not v4's flat promptTokens pair).
const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: undefined, reasoning: undefined },
};

type ToolCall = { type: "tool-call"; toolCallId: string; toolName: string; input: string };

// `input` is a JSON STRING, not an object — LanguageModelV4ToolCall's contract.
function call(toolName: string, input: Record<string, unknown>): ToolCall {
  return { type: "tool-call", toolCallId: randomUUID(), toolName, input: JSON.stringify(input) };
}

// Deterministic on purpose: e2e asserts this exact content, and a reviewer
// should be able to recognize a simulated trip on sight.
//
// AddDay takes no arguments at all — planningTools drops `type` and `tripId`,
// and `dayId` is a `mint` field the server generates. AddActivity keeps
// `title` and swaps `dayId` for the human `dayRef` ("day N", 1-based over the
// days THIS batch creates).
//
// No `location` and no `cost`, and that is load-bearing rather than lazy:
// enrichCommandLocations no-ops when there is nothing to look up, so the
// simulated path cannot reach LocationIQ. That is how "the kill switch covers
// the LLM only" stays honest without a second branch — enforced by the
// empty-locationReport assertion in route.int.test.ts.
function planCalls(): ToolCall[] {
  return [
    call("AddDay", {}),
    call("AddDay", {}),
    call("AddActivity", { title: "Sample: morning walk", dayRef: "day 1" }),
    call("AddActivity", { title: "Sample: long lunch", dayRef: "day 1" }),
    call("AddActivity", { title: "Sample: museum in the afternoon", dayRef: "day 2" }),
  ];
}

// Headings and paragraphs only — no macro blocks, so this stays decoupled from
// the @tc/pages macro registry and passes validateComposedPage unconditionally.
function pageCalls(): ToolCall[] {
  return [
    call("compose_page", {
      title: "Sample page",
      blocks: [
        { type: "heading", level: 2, text: "This page is simulated" },
        {
          type: "paragraph",
          text: "AI is switched off on this deployment, so this page was composed by the server rather than by a model. Everything else about it is real — it saves, versions, and edits like any other page.",
        },
      ],
    }),
  ];
}

export function simulatedModel(surface: AiSurface): LanguageModel {
  // One step's worth of calls, then silence. The AI SDK loops doGenerate until
  // `stopWhen` fires (32 steps for board/combined), and re-emitting on every
  // call would apply the same plan once per remaining step — the failure
  // `modelThatNeverStops` documents in route.int.test.ts.
  let spent = false;

  return {
    specificationVersion: "v4",
    provider: "simulated",
    modelId: SIMULATED_MODEL_ID,
    supportedUrls: {},
    async doGenerate() {
      if (spent) {
        return { content: [], finishReason: { unified: "stop", raw: undefined }, usage: NO_USAGE, warnings: [] };
      }
      spent = true;
      return {
        content: surface === "page" ? pageCalls() : planCalls(),
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: NO_USAGE,
        warnings: [],
      };
    },
    async doStream() {
      // handleAiRequest only ever calls generateText, never streamText. Throwing
      // is better than a fake stream: if streaming is added later, this fails
      // loudly at the seam instead of silently serving canned data forever.
      throw new Error("simulatedModel does not stream — handleAiRequest uses generateText only");
    },
  } as unknown as LanguageModel;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web test -- simulatedModel
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: PASS. If the `as unknown as LanguageModel` cast turns out to be unnecessary, remove it — an unneeded cast hides real type errors. Only keep it if the literal genuinely cannot satisfy the union directly, and if you keep it, leave a comment saying which member rejected it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/ai/simulatedModel.ts apps/web/src/server/ai/simulatedModel.test.ts
git commit -m "feat(ai): add the simulated model used when the ai-live flag is off"
```

---

### Task 4: Model selection

**Files:**
- Create: `apps/web/src/server/ai/modelSelection.ts`
- Test: `apps/web/src/server/ai/modelSelection.test.ts`

**Interfaces:**
- Consumes: `aiLiveFlag` from `@/server/flags` (Task 2); `simulatedModel`, `SIMULATED_MODEL_ID` from `@/server/ai/simulatedModel` (Task 3); `aiModel` from `@/server/ai/gateway`.
- Produces:
  - `aiLive(): Promise<boolean>`
  - `selectAiModel(surface: AiSurface): Promise<{ model: LanguageModel; simulated: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/server/ai/modelSelection.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked so the real module — and therefore `flags/next`, which reaches for
// next/headers and a request scope — never loads in a unit test.
const aiLiveFlag = vi.fn<() => Promise<boolean>>();
vi.mock("@/server/flags", () => ({ aiLiveFlag: () => aiLiveFlag() }));

// aiModel() throws without AI_GATEWAY_API_KEY; stub it so the live branch is
// testable without a key, and so a stray call is visible.
const aiModel = vi.fn(() => "gateway/fake-model");
vi.mock("@/server/ai/gateway", () => ({ aiModel: () => aiModel() }));

const { aiLive, selectAiModel } = await import("@/server/ai/modelSelection");
const { SIMULATED_MODEL_ID } = await import("@/server/ai/simulatedModel");

const ORIGINAL = process.env.AI_LIVE;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_LIVE;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AI_LIVE;
  else process.env.AI_LIVE = ORIGINAL;
});

describe("aiLive", () => {
  it("consults the flag when AI_LIVE is unset", async () => {
    aiLiveFlag.mockResolvedValue(true);
    await expect(aiLive()).resolves.toBe(true);
    expect(aiLiveFlag).toHaveBeenCalledOnce();
  });

  it('treats AI_LIVE="true" as live without consulting the flag', async () => {
    process.env.AI_LIVE = "true";
    await expect(aiLive()).resolves.toBe(true);
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });

  it('treats AI_LIVE="false" as simulated without consulting the flag', async () => {
    process.env.AI_LIVE = "false";
    aiLiveFlag.mockResolvedValue(true);
    await expect(aiLive()).resolves.toBe(false);
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });

  // Anything that isn't exactly "true" is off. A typo must not spend money.
  it("treats any other AI_LIVE value as simulated", async () => {
    for (const value of ["", "1", "yes", "TRUE", "live"]) {
      process.env.AI_LIVE = value;
      await expect(aiLive()).resolves.toBe(false);
    }
    expect(aiLiveFlag).not.toHaveBeenCalled();
  });
});

describe("selectAiModel", () => {
  it("returns the gateway model when the flag is on", async () => {
    aiLiveFlag.mockResolvedValue(true);
    const selected = await selectAiModel("board");
    expect(selected).toEqual({ model: "gateway/fake-model", simulated: false });
    expect(aiModel).toHaveBeenCalledOnce();
  });

  it("returns the simulated model when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    const selected = await selectAiModel("board");
    expect(selected.simulated).toBe(true);
    expect(selected.model).toMatchObject({ modelId: SIMULATED_MODEL_ID });
  });

  // The whole point of the kill switch: the flag-off path must not construct a
  // gateway client, which is what would carry the API key and the spend.
  it("never constructs a gateway client when the flag is off", async () => {
    aiLiveFlag.mockResolvedValue(false);
    await selectAiModel("board");
    await selectAiModel("page");
    expect(aiModel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test -- modelSelection
```

Expected: FAIL — `Failed to resolve import "@/server/ai/modelSelection"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/server/ai/modelSelection.ts`:

```ts
// The single place the ai-live flag is read. handleAiRequest asks this which
// model to use; it does not know a flag exists.
import type { LanguageModel } from "ai";
import { aiLiveFlag } from "@/server/flags";
import { aiModel } from "@/server/ai/gateway";
import { simulatedModel } from "@/server/ai/simulatedModel";
import type { AiSurface } from "@/server/ai/context";

// AI_LIVE short-circuits the flag entirely. It has to live here rather than in
// the flag's own `decide`, because the Flags SDK treats an explicit `decide` as
// an override of the adapter — a decide returning undefined falls to
// `defaultValue`, not through to Vercel — so "env var, else ask Vercel" is not
// expressible inside the declaration.
//
// Strictly "true" and nothing else: a typo must fail toward not spending money.
//
// LOCAL AND CI ONLY. On Vercel this variable is unset and the flag is the sole
// source of truth. See .env.example.
export async function aiLive(): Promise<boolean> {
  if (process.env.AI_LIVE !== undefined) return process.env.AI_LIVE === "true";
  return aiLiveFlag();
}

// `aiModel()` is called ONLY on the live branch — it constructs the gateway
// client that carries AI_GATEWAY_API_KEY, and it throws when that key is unset.
// Calling it eagerly would both spend-enable the off path and break simulated
// mode on a deployment that has no key at all. Enforced by a test.
export async function selectAiModel(
  surface: AiSurface,
): Promise<{ model: LanguageModel; simulated: boolean }> {
  return (await aiLive())
    ? { model: aiModel(), simulated: false }
    : { model: simulatedModel(surface), simulated: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web test -- modelSelection
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/modelSelection.ts apps/web/src/server/ai/modelSelection.test.ts
git commit -m "feat(ai): select the gateway or simulated model from the ai-live flag"
```

---

### Task 5: Thread `simulated` through the request handler

**Files:**
- Modify: `apps/web/src/server/ai/handleAiRequest.ts`
- Test: `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts`

**Interfaces:**
- Consumes: `selectAiModel` from `@/server/ai/modelSelection` (Task 4).
- Produces: every AI response body gains `simulated: boolean`; `AiCallMeta` gains `simulated: boolean`; `handleAiRequest`'s third parameter becomes `model?: LanguageModel`.

**Requires a running Postgres** (`docker compose up -d`), same as any `*.int.test.ts`.

- [ ] **Step 1: Write the failing integration tests**

Append to `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts`. Note this file already mocks `@/server/geocoding` so `getGeocoder()` throws if reached — which makes the "no geocoder" assertion below free.

```ts
describe("simulated mode", () => {
  it("applies a real plan and marks it simulated", async () => {
    const tripId = await seedTrip();
    const { simulatedModel } = await import("@/server/ai/simulatedModel");
    const res = await handleAiRequest(
      req(tripId, { prompt: "plan me something", surface: "board" }),
      tripId,
      simulatedModel("board"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      simulated: boolean;
      message: string;
      detail: { days: unknown[]; activities: Record<string, unknown> };
      meta: { simulated: boolean; model: { requested: string } };
    };

    // Simulated, and saying so in both channels.
    expect(body.simulated).toBe(true);
    expect(body.meta.simulated).toBe(true);
    expect(body.message).toContain("Simulated response");
    expect(body.meta.model.requested).toBe("simulated/no-op");

    // And genuinely applied — this is what separates it from a canned refusal.
    expect(body.detail.days).toHaveLength(2);
    expect(Object.keys(body.detail.activities)).toHaveLength(3);
  });

  // The geocoding mock throws on any call, so reaching this line at all proves
  // the simulated path never touched LocationIQ.
  it("never reaches the geocoder, because it emits no locations", async () => {
    const tripId = await seedTrip();
    const { simulatedModel } = await import("@/server/ai/simulatedModel");
    const res = await handleAiRequest(
      req(tripId, { prompt: "plan me something", surface: "board" }),
      tripId,
      simulatedModel("board"),
    );
    const body = (await res.json()) as { locationReport: { unverified: string[]; failed: string[]; skipped: string[] } };
    expect(body.locationReport.unverified).toEqual([]);
    expect(body.locationReport.failed).toEqual([]);
    expect(body.locationReport.skipped).toEqual([]);
  });

  it("composes a valid page on the page surface", async () => {
    const tripId = await seedTrip();
    const { simulatedModel } = await import("@/server/ai/simulatedModel");
    const res = await handleAiRequest(
      req(tripId, { prompt: "write me a page", surface: "page", pageContext: { tripId } }),
      tripId,
      simulatedModel("page"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { simulated: boolean; content: unknown };
    expect(body.simulated).toBe(true);
    expect(validateComposedPage(body.content as never)).not.toHaveProperty("error");
  });

  // The 32-step budget is the hazard: a model that re-emits every step applies
  // its plan once per remaining step. Two days, not sixty-four.
  it("applies the plan exactly once despite the 32-step budget", async () => {
    const tripId = await seedTrip();
    const { simulatedModel } = await import("@/server/ai/simulatedModel");
    const res = await handleAiRequest(
      req(tripId, { prompt: "plan me something", surface: "board" }),
      tripId,
      simulatedModel("board"),
    );
    const body = (await res.json()) as { detail: { days: unknown[] }; meta: { steps: number } };
    expect(body.detail.days).toHaveLength(2);
    expect(body.meta.steps).toBe(2); // one step of tool calls, one to stop
  });

  it("marks an injected model as not simulated", async () => {
    const tripId = await seedTrip();
    const res = await handleAiRequest(
      req(tripId, { prompt: "add a day", surface: "board" }),
      tripId,
      modelWithToolCalls([toolCall("AddDay", {})]),
    );
    const body = (await res.json()) as { simulated: boolean; message: string };
    expect(body.simulated).toBe(false);
    expect(body.message).not.toContain("Simulated response");
  });

  // The spec's core promise, stated as a test: with AI off the endpoint works
  // on a deployment carrying no AI_GATEWAY_API_KEY at all. This is the ONLY
  // test in this file that omits the model argument, so it is the only one
  // exercising the real selectAiModel() path — AI_LIVE short-circuits before
  // the Vercel adapter is consulted, so no request scope and no network are
  // needed. If aiModel() ever creeps back onto the off path, this fails.
  it("serves a request with no model injected and no gateway key set", async () => {
    const tripId = await seedTrip();
    const priorLive = process.env.AI_LIVE;
    const priorKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_LIVE = "false";
    delete process.env.AI_GATEWAY_API_KEY;
    try {
      const res = await handleAiRequest(req(tripId, { prompt: "plan me something", surface: "board" }), tripId);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { simulated: boolean; detail: { days: unknown[] } };
      expect(body.simulated).toBe(true);
      expect(body.detail.days).toHaveLength(2);
    } finally {
      if (priorLive === undefined) delete process.env.AI_LIVE;
      else process.env.AI_LIVE = priorLive;
      if (priorKey !== undefined) process.env.AI_GATEWAY_API_KEY = priorKey;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
docker compose up -d
pnpm --filter web test:int -- ai/route
```

Expected: FAIL — `body.simulated` is `undefined`, not `true`.

- [ ] **Step 3: Update the module comment at the top of `handleAiRequest.ts`**

The existing block (lines 8-15) describes a `model` default that is about to stop existing. Replace that paragraph with:

```ts
// Model selection: `handleAiRequest` takes an OPTIONAL `model`. When a caller
// injects one — which is every test in route.int.test.ts, and nothing else —
// it is used as-is and no flag is consulted, so test behavior is unchanged
// from before the kill switch existed. When none is injected, which is every
// real request, `selectAiModel()` decides: the real gateway model when the
// `ai-live` flag is on, the simulated model when it is off. The default
// parameter form (`model: LanguageModel = aiModel()`) could not survive that
// change, because a default is evaluated at call time and would construct the
// gateway client — and throw on a missing AI_GATEWAY_API_KEY — before the flag
// could be read.
//
// Selection happens AFTER guard() on purpose: guard() is where the session is
// established, so the per-user targeting described in the design spec's §6 can
// later be added to the flag declaration without moving this call site.
```

- [ ] **Step 4: Make the code changes**

Four edits in `apps/web/src/server/ai/handleAiRequest.ts`:

**(a)** Swap the `aiModel` import for `selectAiModel`:

```diff
-import { aiModel } from "@/server/ai/gateway";
+import { selectAiModel } from "@/server/ai/modelSelection";
```

**(b)** Add `simulated` to `AiCallMeta`, `buildAiMeta`, and `failedMeta`:

```diff
 interface AiCallMeta {
   model: { requested: string; served: string | null };
+  // True when no provider was contacted — the plan came from simulatedModel
+  // because the ai-live flag is off. See modelSelection.ts.
+  simulated: boolean;
   finishReason: string;
```

```diff
-function buildAiMeta(result: AiResultLike, model: LanguageModel, durationMs: number): AiCallMeta {
+function buildAiMeta(
+  result: AiResultLike,
+  model: LanguageModel,
+  durationMs: number,
+  simulated: boolean,
+): AiCallMeta {
   return {
     model: { requested: requestedModelId(model), served: result.finalStep?.response?.modelId ?? null },
+    simulated,
```

```diff
-function failedMeta(model: LanguageModel, durationMs: number): Pick<AiCallMeta, "model" | "maxRetries" | "durationMs"> {
+function failedMeta(
+  model: LanguageModel,
+  durationMs: number,
+  simulated: boolean,
+): Pick<AiCallMeta, "model" | "simulated" | "maxRetries" | "durationMs"> {
   return {
     model: { requested: requestedModelId(model), served: null },
+    simulated,
```

Update all four `buildAiMeta(...)` / `failedMeta(...)` call sites to pass `simulated`.

**(c)** Add the notice constant, next to `TRUNCATED_NOTICE`:

```ts
// What the user is told when the ai-live flag is off. The plan they are looking
// at is real — it applied, it is undoable, it is in the history — but no model
// wrote it, and nothing about the response should let that be mistaken.
const SIMULATED_NOTICE = "Simulated response — AI is disabled on this deployment.";
```

**(d)** Change the signature and resolve the model:

```diff
 export async function handleAiRequest(
   request: Request,
   tripId: string,
-  model: LanguageModel = aiModel(),
+  model?: LanguageModel,
   geocoder?: Geocoder,
 ): Promise<Response> {
   const g = await guard(tripId);
   if ("error" in g) return g.error;
   const { userId, detail } = g;

   const parsed = AiRequest.safeParse(await request.json().catch(() => null));
   if (!parsed.success) {
     return Response.json({ error: "malformed request" }, { status: 400 });
   }
   const { prompt, surface, pageContext } = parsed.data;
+
+  // Injected model => that model, never simulated. No model => ask the flag.
+  const selected = model ? { model, simulated: false } : await selectAiModel(surface);
+  const activeModel = selected.model;
+  const { simulated } = selected;
+  const baseNotices = simulated ? [SIMULATED_NOTICE] : [];
```

Then, throughout the rest of the function:
- replace every `model` passed to `generateText`, `buildAiMeta`, and `failedMeta` with `activeModel`;
- add `simulated` to the four `Response.json({...})` success and failure bodies;
- replace the two `withNotices(...)` calls' notice arrays so they start from `baseNotices`:
  - the zero-commands path: `withNotices(msg, [...baseNotices, ...(meta.truncated ? [TRUNCATED_NOTICE] : [])])`
  - the applied path: initialize `const notices: string[] = [...baseNotices];` instead of `= []`.

- [ ] **Step 5: Run the integration tests**

```bash
pnpm --filter web test:int -- ai/route
```

Expected: PASS — the six new tests, **and every pre-existing test in the file unchanged**. That second half is the real result: it is the evidence that an injected model still bypasses flag evaluation entirely.

- [ ] **Step 6: Run the whole check**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/server/ai/handleAiRequest.ts "apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts"
git commit -m "feat(ai): return a simulated plan when the ai-live flag is off"
```

---

### Task 6: Surface "simulated" in the UI

**Files:**
- Modify: `apps/web/src/lib/apiClient.ts:100-156`
- Modify: `apps/web/src/components/assistant/AssistantRail.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx:120-136`
- Modify: `apps/web/src/components/pages/ai/ComposePanel.tsx`
- Test: `apps/web/src/components/assistant/AssistantRail.test.tsx`

**Interfaces:**
- Consumes: the `simulated` field added to every AI response in Task 5.
- Produces:
  - `PlanOutcome = CommandOutcome & { message: string; simulated: boolean }`
  - `composeAiPage(...): Promise<ApiResult<{ content: PageContent; simulated: boolean }>>` — **note this is a breaking change** to the existing return type, which was a bare `PageContent`. `ComposePanel` is the only caller.
  - `AssistantRail` gains an optional `simulated?: boolean` prop.

- [ ] **Step 1: Write the failing component test**

Append to `apps/web/src/components/assistant/AssistantRail.test.tsx`, following the render helper already used in that file:

```ts
it("shows a Simulated badge when the last answer came from the server, not a model", () => {
  render(<AssistantRail {...baseProps} simulated />);
  expect(screen.getByText("Simulated")).toBeInTheDocument();
});

it("shows no badge for a real answer", () => {
  render(<AssistantRail {...baseProps} />);
  expect(screen.queryByText("Simulated")).not.toBeInTheDocument();
});
```

If the existing file has no `baseProps`, build one from `AssistantRail`'s required props: `contextLine`, `suggestions`, `quickAsks`, `onAsk`, `onKeepGhost`, `onDismiss`, `onHide`. Reuse the file's existing fixtures rather than inventing new ones.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test -- AssistantRail
```

Expected: FAIL — `Unable to find an element with the text: Simulated`.

- [ ] **Step 3: Update the API client**

In `apps/web/src/lib/apiClient.ts`:

```diff
-export type PlanOutcome = CommandOutcome & { message: string };
+// `simulated` is true when the ai-live flag is off: the change really applied,
+// but the server composed it rather than a model. Surfaced so the UI can say so.
+export type PlanOutcome = CommandOutcome & { message: string; simulated: boolean };
```

In `composeAiPlan`, extend the response parse:

```diff
-  const data = (await res.json()) as { detail: unknown; history: unknown; message?: unknown };
+  const data = (await res.json()) as {
+    detail: unknown;
+    history: unknown;
+    message?: unknown;
+    simulated?: unknown;
+  };
   return {
     ok: true,
     value: {
       ...parseOutcome(data),
       message: typeof data.message === "string" ? data.message : "",
+      simulated: data.simulated === true,
     },
   };
```

In `composeAiPage`, change the return type and body:

```diff
 export async function composeAiPage(
   tripId: string,
   prompt: string,
   pageContext: PageContext,
-): Promise<ApiResult<PageContent>> {
+): Promise<ApiResult<{ content: PageContent; simulated: boolean }>> {
```

```diff
-  const data = (await res.json()) as { content: unknown };
-  return { ok: true, value: PageContent.parse(data.content) };
+  const data = (await res.json()) as { content: unknown; simulated?: unknown };
+  return { ok: true, value: { content: PageContent.parse(data.content), simulated: data.simulated === true } };
```

- [ ] **Step 4: Render the badge in `AssistantRail`**

Add to the props type, beside `askError`:

```ts
  /** True when the last answer was composed by the server because the ai-live
   * flag is off. The change is real; the authorship is not a model. */
  simulated?: boolean;
```

Destructure it with the others (`simulated = false`), import the primitive:

```ts
import { Badge } from "@/components/ui/badge";
```

and render it immediately above the `askError` block (around line 160), so the badge and the error share the spot directly over the ask box:

```tsx
{simulated && (
  <Badge variant="info" className="mb-1.5 self-start">
    Simulated
  </Badge>
)}
```

- [ ] **Step 5: Track it in `TripBoardScreen`**

```diff
+  // Whether the rail's last answer was simulated (ai-live flag off).
+  const [askSimulated, setAskSimulated] = useState(false);
```

```diff
   const submitAssistantAsk = async (text: string) => {
     setAskStatus("loading");
     setAskError(null);
     const result = await composeAiPlan(tripId, text, "board");
     if (!result.ok) {
       setAskStatus("error");
       setAskError(result.error.message);
       return;
     }
+    setAskSimulated(result.value.simulated);
     applyOutcome(result.value);
     setAskStatus("idle");
   };
```

and pass `simulated={askSimulated}` where the component already passes `askError` to `AssistantRail`.

- [ ] **Step 6: Update `ComposePanel` for the changed `composeAiPage` shape**

```diff
+  const [simulated, setSimulated] = useState(false);
```

```diff
       const result = await composeAiPage(props.tripId, prompt, props.pageContext);
       if (!result.ok) {
         setError(result.error.message);
         setStatus("error");
         return;
       }
-      props.onApply(result.value);
+      setSimulated(result.value.simulated);
+      props.onApply(result.value.content);
       setStatus("idle");
```

```diff
     setMessage(result.value.message);
+    setSimulated(result.value.simulated);
     props.onApplied(result.value);
```

Also `setSimulated(false)` alongside the existing `setMessage(null)` at the top of `submit`, and render the badge next to where `message` is displayed:

```tsx
{simulated && <Badge variant="info">Simulated</Badge>}
```

- [ ] **Step 7: Run the component tests**

```bash
pnpm --filter web test -- AssistantRail ComposePanel TripBoardScreen
```

Expected: PASS. `TripBoardScreen.test.tsx` mocks `composeAiPlan`; if its mock returns an object without `simulated`, `result.value.simulated` is `undefined` and `setAskSimulated(undefined)` breaks the boolean prop type — update the mock's return value to include `simulated: false`.

- [ ] **Step 8: Full check**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/apiClient.ts apps/web/src/components
git commit -m "feat(ui): badge AI answers that were simulated rather than generated"
```

---

### Task 7: End-to-end coverage

**Files:**
- Create: `apps/web/e2e/m10-simulated-ai.spec.ts`

**Interfaces:**
- Consumes: everything above. Runs against a real server with `AI_LIVE=false`.

- [ ] **Step 1: Write the spec**

Read `apps/web/e2e/helpers.ts` first and reuse its sign-in / trip-creation helpers rather than reimplementing them. The spec asserts the two halves of the design at once — it is marked simulated, *and* the plan really applied:

```ts
import { test, expect } from "@playwright/test";
// Reuse this file's existing helpers — do not hand-roll sign-in.
import { signIn, createTrip } from "./helpers";

// Runs with AI_LIVE=false (see the note below), so the AI endpoint returns the
// simulated plan: two days and three activities, deterministic by construction.
test("a simulated AI answer is badged and still really changes the trip", async ({ page }) => {
  await signIn(page);
  const tripId = await createTrip(page, "Simulated AI trip");
  await page.goto(`/trips/${tripId}`);

  await page.getByPlaceholder("Ask about this day…").fill("plan me a couple of days");
  await page.keyboard.press("Enter");

  // Marked as simulated…
  await expect(page.getByText("Simulated")).toBeVisible();

  // …and genuinely applied: the simulated model emits exactly two AddDay calls.
  await expect(page.getByText("Sample: morning walk")).toBeVisible();
  await expect(page.getByText("Sample: museum in the afternoon")).toBeVisible();
});
```

Adjust the selectors to whatever `m8-make-it-real.spec.ts` already uses for day/activity assertions — match the existing suite's conventions rather than introducing new ones.

- [ ] **Step 2: Confirm `AI_LIVE=false` reaches the e2e server**

`playwright.config.ts` starts the web server. Confirm `AI_LIVE=false` is present in `apps/web/.env.local` (loaded by `scripts/preload-dotenv.mjs` via the `test:e2e` script's `NODE_OPTIONS`). If it is not, add it to the config's `webServer.env` explicitly rather than relying on a developer's local file:

```ts
webServer: {
  // …existing config…
  env: { ...process.env, AI_LIVE: "false" },
}
```

- [ ] **Step 3: Run it**

```bash
docker compose up -d
pnpm --filter web db:reseed
pnpm --filter web test:e2e -- m10-simulated-ai
```

Expected: PASS.

**If it fails intermittently rather than consistently**, stop before a third attempt and check `ps aux` for a competing run — KI-21 records confirmed load-related flakiness in this suite that is unrelated to any branch's code. Report it rather than retrying through it.

- [ ] **Step 4: Run the whole e2e suite to confirm nothing regressed**

```bash
pnpm --filter web test:e2e
```

Expected: PASS, all specs.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/m10-simulated-ai.spec.ts apps/web/playwright.config.ts
git commit -m "test(e2e): cover the simulated AI path end to end"
```

---

### Task 8: Documentation

**Files:**
- Create: `docs/architecture/ADR-019-feature-flags-and-simulated-model-seam.md`
- Modify: `docs/guidelines/environments-and-deploys.md`
- Modify: `docs/known-issues.md`
- Modify: `docs/STATUS.md`

**Interfaces:**
- Consumes: the implemented system. Write this last, describing what exists.

- [ ] **Step 1: Write ADR-019**

Follow the house format exactly — read `docs/architecture/ADR-015-ai-gateway-derived-tools.md` first and match its Status / Deciders / Design-spec header, Context, Decision, Consequences structure.

Content, at minimum:

- **Context:** the app is being shared publicly; `AI_GATEWAY_API_KEY` sits behind an endpoint any authenticated visitor can call in a loop; there is no flag infrastructure in the repo.
- **Decision 1:** flags are declared with the Flags SDK (`flags`) against the Vercel adapter, in `apps/web/src/server/flags.ts`, declarations-only. Flag values are read only from `src/server`.
- **Decision 2:** the AI kill switch is implemented by **swapping the injected model**, not by branching the handler — so "off" exercises the identical pipeline and really mutates the trip, and the response is marked `simulated: true`.
- **Decision 3:** fail closed. `defaultValue: false`; an unreachable Flags service degrades to simulated, never to spending.
- **Decision 4:** `AI_LIVE` is a local/CI override living in `aiLive()`, not in the flag's `decide` — with the reason (an explicit `decide` overrides the adapter rather than falling through to it).
- **Consequences:** a Vercel platform dependency; simulated plans write real events, so a visitor exercising the assistant permanently mutates that trip's history; a Flags outage silently downgrades AI quality, mitigated but not eliminated by the on-screen marker; per-user targeting is now one `identify` option away.
- **Alternatives rejected:** a canned refusal (leaves the whole pipeline unexercised); Edge Config (hand-managed JSON and hand-written targeting); flagging LocationIQ as well (breaks the map, the best demo surface, for negligible saving).

- [ ] **Step 2: Add a "Feature flags" section to the environments guideline**

In `docs/guidelines/environments-and-deploys.md`, matching the file's existing structure, cover: where a flag's value lives per environment; how to flip `ai-live` (`vercel flags set ai-live --environment production --variant true`, or the dashboard); how preview per-session overrides work through the Flags Explorer and what `FLAGS_SECRET` is for; and that `AI_LIVE` must never be set in a Vercel environment.

- [ ] **Step 3: File the contracts gap as a known issue**

Add to the Open section of `docs/known-issues.md`, using the file's existing entry format:

```markdown
### KI-22 — The AI response envelope is not in `packages/contracts`
- **Severity:** cleanup
- **Area:** `apps/web/src/server/ai/handleAiRequest.ts`, `apps/web/src/lib/apiClient.ts`
- The `/api/trips/:id/ai` response (`message`, `meta`, `simulated`,
  `resolvedCommands`, `resolutionErrors`, `locationReport`) is assembled ad hoc
  in the handler and parsed loosely by the client — `message` and `simulated`
  are read with `typeof` / `=== true` guards rather than through a schema. This
  sits against Invariant 5 ("contracts change by protocol, not by drift"): the
  envelope is a cross-boundary type that lives in neither `packages/contracts`
  nor the contracts changelog. It surfaced while adding `simulated`
  (2026-08-19), which needed no changelog entry precisely because there is no
  contract to change. Fixing it means schematizing the whole envelope and
  routing both AI client functions through it.
```

- [ ] **Step 4: Update STATUS.md**

Add to "In flight" / "Where we are": feature flagging landed 2026-08-19 as a deliberate off-roadmap insert ahead of M10 Wave 2 Phase 3, why (public sharing, spend protection), that M10's gate is unaffected, and that **Phase 3 (the unscheduled rack) remains the resume-from-here point**.

- [ ] **Step 5: Final full check**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs(flags): record ADR-019, the flags guideline, KI-22, and status"
```

---

## Post-implementation, for Mitchell (not the implementer)

These need dashboard access and cannot be done from the repo:

1. Set `FLAGS_SECRET` in the Vercel project's Preview and Production environments (value generated in Task 1, Step 4).
2. Create the `ai-live` flag in the Vercel dashboard and set it to **false** in Production before the app is shared.
3. Confirm `AI_LIVE` is **not** set in any Vercel environment.
4. Verify the toolbar shows the flag on a preview deploy, and that overriding it to "Live" there produces a real (unbadged) answer.
