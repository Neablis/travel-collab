# M7 Solo Delight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** Turn the planning projection into dynamic, communicable **pages** — rich text (TipTap) embedding typed **macro objects** (inline scalars + block embeds) that resolve live against `TripDetail`; auto-instantiated, freely-editable **templates**; a **Notebook** route; and **AI generation** (via Vercel AI Gateway) that both authors pages and edits the plan, constrained to a typed, schema-derived tool surface.

**Architecture:** Pages are a new **CRUD module** (ADR-014), *not* event-sourced — content is ProseMirror/TipTap JSON, Yjs-ready for M8 multiplayer. A new pure package **`@tc/pages`** (mirrors the `@tc/predict`/ADR-013 precedent; depends on `@tc/contracts` only) holds the **macro registry**: one declarative table (`name`, `kind`, Zod `params`, `description`, `emptyText`, pure `resolve`) that is the single source of truth for autocomplete, renderers, **and** AI tools. Resolvers are pure `(TripDetail, PageContext, params) → Result` where `Result = ok | empty | unbound`. AI plan-edits flow through the standard command pipeline as an **M6 atomic batch** (ADR-013); AI tools are **derived** from command schemas + the registry, never hand-written (Invariant 5). Spec: `docs/specs/2026-07-20-M7-solo-delight-design.md`.

**Tech Stack:** Everything M0–M6 used, plus new deps: **`@tiptap/*`** (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/suggestion`) for the editor + custom macro node; the **Vercel AI SDK** (`ai` + `@ai-sdk/gateway`) routing through **Vercel AI Gateway**. One new package `@tc/pages`. One DB migration (the `pages` table). New env var `AI_GATEWAY_API_KEY`.

## Global Constraints

- Read `AGENTS.md` before starting. Its invariants override convenience, always.
- Node >= 20, pnpm >= 9. All commands run from the repo root unless stated. Local Postgres for integration tests: `docker compose up -d` (port 5433); dev server on 3001. Never hardcode a port/URL; use the existing `apps/web/src/config.ts` / `apps/web/src/server/config.ts` defaults.
- **Invariant 1 (scoped event-sourcing, ADR-003):** Pages are CRUD — page reads/writes DO NOT go through the command pipeline and DO NOT touch `events`/`trip_details`. Pages **read** `TripDetail` (via the registry) and **never** write planning data. This is the deliberate ADR-014 boundary; do not "improve" it into event-sourcing.
- **Invariant 4 (purity):** `packages/domain` AND the new `packages/pages` do no I/O, no clock reads, no randomness. Macro resolvers are pure functions of `(TripDetail, PageContext, params)`. Time (e.g. "today") is never read inside a resolver.
- **Invariant 5 (contracts, no drift):** Cross-boundary types live in `@tc/contracts` (Zod; types inferred, never hand-written twice). AI tool schemas are **derived** from `@tc/contracts` command schemas and the `@tc/pages` registry — no second hand-written copy. Contract changes require a `docs/contracts/CHANGELOG.md` entry + all consumers updated in the same PR.
- **Invariant 6 (multi-persona always):** every page row carries `actorId`; every AI-emitted event carries `actor_id`; no "the user" singletons.
- **Lint wall:** UI code (everything in `apps/web/src` except `src/server/**`) may import `@tc/contracts`, `@tc/predict`, `@tc/pages`, and the typed client — never `@tc/domain`, never `src/server` internals. `@tc/pages` is a new bare specifier the `no-restricted-imports` rule never matches (same mechanism as `@tc/predict`); do not touch the lint wall.
- **CRDT-ready, not CRDT-backed:** page `content` is stored as ProseMirror-shaped JSON. Do NOT add Yjs/CRDT plumbing this milestone (YAGNI — M8's transport ADR owns it). Just keep content ProseMirror-JSON-shaped.
- All new event schemas (there are none for pages) — N/A. **No planning event or reducer changes this milestone**, so the projection-rebuild golden test is unaffected and must stay green untouched.
- TypeScript strict everywhere. Commit after every task with the exact message given (conventional commits). Package imports via workspace aliases.
- **Branch:** create `m7-solo-delight` from `main` after M6 is merged (it is — PR #13, `51978fe`). Isolated worktree per parallel implementer (superpowers:using-git-worktrees); merge back sequentially, never a shared tree (AGENTS.md).

## Workstreams & parallel dispatch

Wave 0 (kickoff docs + deps) and Wave 1 (contracts) are **serial and land first** — they are the meeting point. After Wave 1 merges, three tracks are mutually independent and dispatchable as parallel subagents, each in its own worktree:

| Track | Waves/Tasks | Depends on | Independent of |
|---|---|---|---|
| **P (pure)** | Wave 2 — `@tc/pages` registry/resolvers/templates | Wave 1 contracts | Server, UI, AI |
| **S (server)** | Wave 3 — pages table, repo, CRUD routes | Wave 1 contracts | UI, AI, Track P (imports `@tc/pages` only at Wave 3 template-instantiation task — see note) |
| **U (UI)** | Wave 4 — editor, renderers, Notebook route | Wave 1 (MSW mocks) | AI |

Wave 5 (AI) depends on Waves 2+3 (registry + command pipeline + pages repo). Wave 6 (gate) is last and serial. **Note:** Track S's default-template instantiation (Task 3.2b) imports `@tc/pages` template seeds (Task 2.5); if tracks P and S run truly concurrently, S stubs the seed import against the Task 2.5 `Produces` interface and the real wiring is verified at merge. Prefer landing Wave 2 before Wave 3's Task 3.2b.

---

## WAVE 0 — Kickoff: preflight, ADRs, milestone file, dependencies

### Task 0.1: M6 preflight reconciliation

**Files:**
- Read: `docs/milestones/README.md`, `docs/milestones/M6-atomic-changes.md`, `TODO.md`

Per the AGENTS.md standing preflight, reconcile M6's gate-close before starting M7.

- [ ] **Step 1: Verify every M6 flag is flipped.** Confirm ALL of:
  - `TODO.md` line for **M6** is `- [x]` (checked).
  - `docs/milestones/M6-atomic-changes.md` has every exit-gate box checked and a retro note appended.
  - `docs/milestones/README.md` bottom reads `Current milestone: **M7**`.

Run: `grep -n "M6" TODO.md && grep -n "Current milestone" docs/milestones/README.md`
Expected: M6 line shows `[x]`; Current milestone shows **M7**.

- [ ] **Step 2: If any flag is unflipped, STOP and flip it first** in one `docs(M6):` commit, then report to Mitchell before continuing. If all are set (expected — M6 closed via PR #13), record "M6 preflight clean" and proceed. No commit if nothing changed.

### Task 0.2: ADR-014 — Pages as a CRUD module, content Yjs-ready

**Files:**
- Create: `docs/architecture/ADR-014-pages-crud-module.md`

- [ ] **Step 1: Write the ADR.** Use the exact house format (see `ADR-013` header: `# ADR-014: …`, `**Status:** Accepted — 2026-07-20`, `**Deciders:** Mitchell (product/eng), Claude (architect)`, `Design spec: docs/specs/2026-07-20-M7-solo-delight-design.md`). Content must state:
  - **Context:** M7 adds trip pages (rich text + live data macros). The question: event-source page content, or CRUD?
  - **Decision:** Pages are a **CRUD module** (ADR-003 scope precedent). Content is ProseMirror/TipTap JSON in a `pages.content` jsonb column. Page CRUD does not go through the command pipeline; pages **read** `TripDetail` via pure macro resolvers and never write planning data.
  - **Yjs-ready:** content is ProseMirror-shaped so the M8/M11 CRDT migration is a one-time per-doc `Y.Doc` conversion, not a rewrite. No CRDT plumbing now.
  - **Consequence (accept explicitly):** notes live **outside time-travel** — revert-to-state rewinds the plan, not the prose; macros in a reverted page auto-update because they resolve live. Only hand-written prose is outside history (gets editor-local, later collaborative, undo).
  - **Alternatives rejected:** event-sourcing page edits (prose doesn't decompose into domain commands; snapshot-events make the M2 history UI meaningless; concurrent text on an OCC stream degenerates to last-writer-wins).

- [ ] **Step 2: Commit.**
```bash
git add docs/architecture/ADR-014-pages-crud-module.md
git commit -m "docs(M7): ADR-014 — pages as a CRUD module, content Yjs-ready"
```

### Task 0.3: ADR-015 — AI via Vercel AI Gateway, tools derived from schemas

**Files:**
- Create: `docs/architecture/ADR-015-ai-gateway-derived-tools.md`

- [ ] **Step 1: Write the ADR** (house format). Content:
  - **Context:** M7 adds AI that authors pages and edits plans. Need a provider-agnostic model access path + a hallucination/token-safe tool surface.
  - **Decision:** All model calls route through **Vercel AI Gateway** (`@ai-sdk/gateway` + `ai`) — provider-agnostic model string, spend caps + usage in one place, cheap-vs-capable A/B per tool family. Env: `AI_GATEWAY_API_KEY` (server-only). Two tool families, both **derived, never hand-written**: (1) planning tools ← `@tc/contracts` command Zod schemas, executed as one M6 atomic batch through the standard pipeline; (2) page tools ← the `@tc/pages` macro registry (macro vocab = registry-generated enum). A typed **context envelope** (surface + summarized projection + surface-relevant tools only) bounds hallucination and tokens.
  - **Layered defense:** schema-constrained decoding at generation + server-side pipeline/registry validation at execution → the model can do nothing a user couldn't.
  - **Alternatives rejected:** free-form prompting (hallucinated tools, unbounded tokens); hand-written tool defs (violates Invariant 5); a direct provider SDK (loses gateway spend caps + provider-agnosticism).

- [ ] **Step 2: Commit.**
```bash
git add docs/architecture/ADR-015-ai-gateway-derived-tools.md
git commit -m "docs(M7): ADR-015 — AI via Vercel AI Gateway, tools derived from schemas"
```

### Task 0.4: M7 milestone file with exit gate

**Files:**
- Create: `docs/milestones/M7-solo-delight.md`

- [ ] **Step 1: Write the milestone file** matching the shape of `docs/milestones/M6-atomic-changes.md` (Goal, Design record + companions links, Scope bullets, a "Design decisions recorded at planning" table, and an **Exit gate — all must be true** checklist). The exit-gate checklist MUST include (unchecked `- [ ]`):
  - **Demo on the deployed Vercel URL:** open a trip's **Notebook** → the two default pages (**Trip Overview**, **Day Sheet**) exist. Open Trip Overview → trip name/dates/cost total + per-day itinerary blocks render live. Add a cost on the board → reopen the page → the total updates. Open a fresh empty trip's Notebook → default pages render as a legible skeleton (every macro shows its empty/unbound state). Point a Day Sheet at a day → its blocks populate. Type `{{` in the editor → autocomplete → insert `{{cost.trip}}` → it resolves. **Undo** a trip revert → macros update, prose persists.
  - **AI demo:** on a page, prompt "make a one-page overview of this trip" → a valid page is composed (only registry macros, validated). On the board, prompt "add a museum visit on day 2" → one atomic batch → one history entry → one undo reverts it.
  - **Tests:** `@tc/pages` unit tests (resolvers: ok/empty/unbound; registry validation), pages CRUD integration tests, the AI batch-path integration test, and the M7 e2e script all green; all prior milestones' e2e scripts still green; projection-rebuild golden test still green (unchanged).
  - A retro note appended at gate close.

- [ ] **Step 2: Commit.**
```bash
git add docs/milestones/M7-solo-delight.md
git commit -m "docs(M7): milestone file + exit gate"
```

### Task 0.5: Scaffold the `@tc/pages` package + add dependencies

**Files:**
- Create: `packages/pages/package.json`, `packages/pages/tsconfig.json`, `packages/pages/src/index.ts`, `packages/pages/vitest.config.ts`
- Modify: `apps/web/package.json` (add tiptap + ai deps), root `pnpm-workspace.yaml` (already globs `packages/*` — no change needed; verify)
- Modify: `tsconfig.base.json` (add `@tc/pages` path mapping, mirroring `@tc/predict`)

- [ ] **Step 1: Create the package manifest.** Mirror `packages/predict/package.json` (read it first for the exact shape). `packages/pages/package.json`:
```json
{
  "name": "@tc/pages",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@tc/contracts": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/pages/tsconfig.json`** (copy `packages/predict/tsconfig.json` verbatim — same compiler settings, extends `../../tsconfig.base.json`).

- [ ] **Step 3: Create `packages/pages/vitest.config.ts`:**
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 4: Create `packages/pages/src/index.ts`** with a placeholder export (filled by Wave 2):
```ts
// @tc/pages — pure macro registry, resolvers, and template seeds.
// Depends on @tc/contracts only. No I/O, no clock, no randomness (Invariant 4).
export const PACKAGE = "@tc/pages" as const;
```

- [ ] **Step 5: Add the `@tc/pages` path mapping to `tsconfig.base.json`** next to the existing `@tc/predict` entry (read the file, copy the `@tc/predict` line, adapt to `packages/pages/src/index.ts`).

- [ ] **Step 6: Add runtime deps to `apps/web/package.json`** `dependencies` (keep alphabetical): `"@tc/pages": "workspace:*"`, `"@tiptap/react": "^2.11.0"`, `"@tiptap/pm": "^2.11.0"`, `"@tiptap/starter-kit": "^2.11.0"`, `"@tiptap/suggestion": "^2.11.0"`, `"ai": "^4.0.0"`, `"@ai-sdk/gateway": "^1.0.0"`. (Pin to the latest stable at implementation time; verify versions resolve.)

- [ ] **Step 7: Install and typecheck the empty package.**
Run: `pnpm install && pnpm --filter @tc/pages typecheck`
Expected: install succeeds; typecheck passes (empty package).

- [ ] **Step 8: Commit.**
```bash
git add packages/pages tsconfig.base.json apps/web/package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore(M7): scaffold @tc/pages package; add tiptap + ai-sdk deps"
```

---

## WAVE 1 — Contracts (meeting point; lands and is reviewed first)

### Task 1.1: Page & macro contracts

**Files:**
- Create: `packages/contracts/src/pages.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./pages";`)
- Modify: `docs/contracts/CHANGELOG.md` (add an entry)
- Test: `packages/contracts/src/pages.test.ts`

**Interfaces:**
- Produces: `MacroNode`, `PageContent`, `PageContext`, `DayRef`, `Page`, `PageSummary`, `CreatePageInput`, `UpdatePageInput`, `MacroKind`, and their inferred TS types — imported by Waves 2–5.

- [ ] **Step 1: Write the failing test** `packages/contracts/src/pages.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MacroNode, PageContext, Page, CreatePageInput } from "./pages";

describe("page contracts", () => {
  it("accepts a valid inline macro node", () => {
    const node = { type: "macro", attrs: { name: "cost.trip", params: {} } };
    expect(MacroNode.parse(node).attrs.name).toBe("cost.trip");
  });

  it("accepts a block macro node carrying a day param", () => {
    const node = { type: "macro", attrs: { name: "itinerary.day", params: { day: { kind: "index", index: 2 } } } };
    expect(MacroNode.parse(node).attrs.params).toEqual({ day: { kind: "index", index: 2 } });
  });

  it("binds a page to a trip, optionally to a day", () => {
    expect(PageContext.parse({ tripId: crypto.randomUUID() }).dayRef).toBeUndefined();
    const withDay = PageContext.parse({ tripId: crypto.randomUUID(), dayRef: { kind: "index", index: 0 } });
    expect(withDay.dayRef).toEqual({ kind: "index", index: 0 });
  });

  it("validates a full Page row", () => {
    const page = {
      id: crypto.randomUUID(), tripId: crypto.randomUUID(), title: "Overview",
      context: { tripId: crypto.randomUUID() },
      content: { type: "doc", content: [] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), actorId: "user-1",
    };
    expect(Page.parse(page).title).toBe("Overview");
  });

  it("CreatePageInput requires title + context, not id/timestamps", () => {
    const ok = CreatePageInput.safeParse({ title: "X", context: { tripId: crypto.randomUUID() }, content: { type: "doc", content: [] } });
    expect(ok.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter @tc/contracts test -- pages`
Expected: FAIL — cannot find `./pages`.

- [ ] **Step 3: Write `packages/contracts/src/pages.ts`:**
```ts
import { z } from "zod";

// A day binding. "index" = the Nth day (0-based) of the trip; resolvers map it
// to the day at that position in TripDetail.days. (uuid form reserved for a
// later "pin to a specific day" affordance; index is what templates use now.)
export const DayRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("index"), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("dayId"), dayId: z.string().uuid() }),
]);
export type DayRef = z.infer<typeof DayRef>;

// A page's binding context. Trip-bound always; optionally day-bound.
export const PageContext = z.object({
  tripId: z.string().uuid(),
  dayRef: DayRef.optional(),
});
export type PageContext = z.infer<typeof PageContext>;

// Macro params are an open bag validated per-macro by the registry (Wave 2).
// The contract only guarantees the node shape; the registry owns param schemas.
export const MacroNode = z.object({
  type: z.literal("macro"),
  attrs: z.object({
    name: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
});
export type MacroNode = z.infer<typeof MacroNode>;

// Page content is ProseMirror/TipTap JSON. We keep it permissive (a doc node)
// so the editor owns the schema; macro nodes embed within it (validated on the
// way in by the editor + on compose by the AI path).
export const PageContent = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).default([]),
}).passthrough();
export type PageContent = z.infer<typeof PageContent>;

export const MacroKind = z.enum(["inline", "block"]);
export type MacroKind = z.infer<typeof MacroKind>;

export const Page = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  title: z.string().min(1),
  context: PageContext,
  content: PageContent,
  createdAt: z.string(),
  updatedAt: z.string(),
  actorId: z.string().min(1),
});
export type Page = z.infer<typeof Page>;

export const PageSummary = Page.pick({ id: true, tripId: true, title: true, context: true, updatedAt: true });
export type PageSummary = z.infer<typeof PageSummary>;

export const CreatePageInput = z.object({
  title: z.string().min(1),
  context: PageContext,
  content: PageContent,
});
export type CreatePageInput = z.infer<typeof CreatePageInput>;

export const UpdatePageInput = z.object({
  title: z.string().min(1).optional(),
  context: PageContext.optional(),
  content: PageContent.optional(),
});
export type UpdatePageInput = z.infer<typeof UpdatePageInput>;
```

- [ ] **Step 4: Add the export** to `packages/contracts/src/index.ts`: `export * from "./pages";`

- [ ] **Step 5: Run the test, verify it passes.**
Run: `pnpm --filter @tc/contracts test -- pages`
Expected: PASS (5 tests).

- [ ] **Step 6: Add a CHANGELOG entry** to `docs/contracts/CHANGELOG.md` (follow the existing entry format): date `2026-07-20`, "M7: add page & macro contracts (`Page`, `PageContext`, `DayRef`, `MacroNode`, `PageContent`, create/update inputs). Additive — no existing schema changed. Consumers: `@tc/pages`, `apps/web` pages routes + UI."

- [ ] **Step 7: Commit.**
```bash
git add packages/contracts docs/contracts/CHANGELOG.md
git commit -m "feat(M7): page & macro contracts"
```

---

## WAVE 2 — `@tc/pages`: registry, resolvers, templates (Track P, pure)

### Task 2.1: Macro result types + registry types

**Files:**
- Create: `packages/pages/src/result.ts`, `packages/pages/src/registry-types.ts`
- Test: `packages/pages/src/result.test.ts`

**Interfaces:**
- Produces: `MacroResult<T>` (`ok(value)`/`empty()`/`unbound(needs)`), the `ok`/`empty`/`unbound` constructors, `MacroDef<P,T>`, `InlinePayload`, `BlockPayload`, `AnyMacroDef`.

- [ ] **Step 1: Write the failing test** `packages/pages/src/result.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ok, empty, unbound } from "./result";

describe("MacroResult", () => {
  it("ok carries a value", () => {
    const r = ok(42);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value).toBe(42);
  });
  it("empty is valueless", () => { expect(empty().status).toBe("empty"); });
  it("unbound names what it needs", () => {
    const r = unbound("day");
    expect(r).toEqual({ status: "unbound", needs: "day" });
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter @tc/pages test -- result`
Expected: FAIL — cannot find `./result`.

- [ ] **Step 3: Write `packages/pages/src/result.ts`:**
```ts
export type MacroResult<T> =
  | { status: "ok"; value: T }
  | { status: "empty" }
  | { status: "unbound"; needs: "day" };

export const ok = <T>(value: T): MacroResult<T> => ({ status: "ok", value });
export const empty = (): MacroResult<never> => ({ status: "empty" });
export const unbound = (needs: "day"): MacroResult<never> => ({ status: "unbound", needs });
```

- [ ] **Step 4: Write `packages/pages/src/registry-types.ts`:**
```ts
import type { z } from "zod";
import type { TripDetail, PageContext, MacroKind } from "@tc/contracts";
import type { MacroResult } from "./result";

// Inline payloads are display-ready strings; block payloads are structured data
// the renderer turns into a component (NOT markup — the C-era swap point).
export type InlinePayload = string;
export interface ItineraryDayPayload { dayId: string; date: string | null; activities: { title: string; timeWindow: string | null; cost: string | null }[]; }
export interface ItineraryTripPayload { days: ItineraryDayPayload[]; }
export interface CostRow { label: string; amount: string; }
export interface CostsTablePayload { rows: CostRow[]; total: string; }
export type BlockPayload = ItineraryDayPayload | ItineraryTripPayload | CostsTablePayload;

export interface MacroDef<P, T> {
  name: string;                    // "cost.trip", "itinerary.day"
  kind: MacroKind;                 // "inline" | "block"
  params: z.ZodType<P>;            // per-macro param schema (registry owns it)
  description: string;             // human- AND machine-readable (AI + autocomplete)
  emptyText: string;               // declarative empty-state copy
  resolve(detail: TripDetail, ctx: PageContext, params: P): MacroResult<T>;
}

// Existentially-typed entry for the registry map.
export type AnyMacroDef = MacroDef<Record<string, unknown>, InlinePayload | BlockPayload>;
```

- [ ] **Step 5: Run the test, verify it passes.**
Run: `pnpm --filter @tc/pages test -- result`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/pages/src/result.ts packages/pages/src/registry-types.ts packages/pages/src/result.test.ts
git commit -m "feat(M7): macro result + registry types"
```

### Task 2.2: Money formatting helper (shared, pure)

**Files:**
- Create: `packages/pages/src/format.ts`
- Test: `packages/pages/src/format.test.ts`

**Interfaces:**
- Produces: `formatMoney(amountMinor: number, currency: string): string`, `formatDate(iso: string | null): string`.

Note: M4 has a `fmt` display formatter in the UI. This resolver-side copy is deliberate (resolvers are pure and package-local; they must not import UI). Keep the 2-decimal simplification consistent with ADR-008.

- [ ] **Step 1: Write the failing test** `packages/pages/src/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatMoney, formatDate } from "./format";

describe("format helpers", () => {
  it("formats minor units to 2 decimals with currency", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });
  it("formats a plain non-USD currency by code", () => {
    expect(formatMoney(5000, "EUR")).toContain("50.00");
  });
  it("formats an ISO date; passes through null as an em dash", () => {
    expect(formatDate("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatDate(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter @tc/pages test -- format`
Expected: FAIL — cannot find `./format`.

- [ ] **Step 3: Write `packages/pages/src/format.ts`:**
```ts
export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}

export function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Fixed UTC construction — no wall-clock read, deterministic (Invariant 4).
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
```

- [ ] **Step 4: Run the test, verify it passes.**
Run: `pnpm --filter @tc/pages test -- format`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/pages/src/format.ts packages/pages/src/format.test.ts
git commit -m "feat(M7): pure money/date format helpers for resolvers"
```

### Task 2.3: Inline macro resolvers

**Files:**
- Create: `packages/pages/src/macros/inline.ts`
- Test: `packages/pages/src/macros/inline.test.ts`

**Interfaces:**
- Consumes: `MacroDef`, result constructors, `formatMoney`/`formatDate`, `TripDetail`, `PageContext`, `DayRef`.
- Produces: `tripName`, `tripDates`, `costTrip`, `costDay` (each an `AnyMacroDef`), and a helper `resolveDayIndex(detail, ctx, params): number | null`.

- [ ] **Step 1: Write the failing test** `packages/pages/src/macros/inline.test.ts` — cover ok/empty/unbound for each:
```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripName, tripDates, costTrip, costDay } from "./inline";

const base: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan 2026", startDate: "2026-08-01", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [
    { dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 5000 },
    { dayId: "d1", activityIds: [], date: "2026-08-02", costSubtotal: 0 },
  ],
  backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  unscheduledCostSubtotal: 0, tripCostTotal: 5000, budgetRemaining: null,
};
const tripCtx = { tripId: base.tripId };
const dayCtx = { tripId: base.tripId, dayRef: { kind: "index", index: 0 } as const };

describe("inline resolvers", () => {
  it("trip.name resolves the name", () => {
    const r = tripName.resolve(base, tripCtx, {});
    expect(r).toEqual({ status: "ok", value: "Japan 2026" });
  });
  it("trip.dates is empty when no startDate", () => {
    expect(tripDates.resolve({ ...base, startDate: null }, tripCtx, {}).status).toBe("empty");
  });
  it("cost.trip formats the total; empty when zero", () => {
    expect(costTrip.resolve(base, tripCtx, {})).toEqual({ status: "ok", value: "$50.00" });
    expect(costTrip.resolve({ ...base, tripCostTotal: 0 }, tripCtx, {}).status).toBe("empty");
  });
  it("cost.day resolves the bound day; unbound with no day; empty when zero", () => {
    expect(costDay.resolve(base, dayCtx, {})).toEqual({ status: "ok", value: "$50.00" });
    expect(costDay.resolve(base, tripCtx, {}).status).toBe("unbound");
    const day1 = { tripId: base.tripId, dayRef: { kind: "index", index: 1 } as const };
    expect(costDay.resolve(base, day1, {}).status).toBe("empty");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter @tc/pages test -- inline`
Expected: FAIL — cannot find `./inline`.

- [ ] **Step 3: Write `packages/pages/src/macros/inline.ts`:**
```ts
import { z } from "zod";
import type { TripDetail, PageContext } from "@tc/contracts";
import type { MacroDef } from "../registry-types";
import { ok, empty, unbound, type MacroResult } from "../result";
import { formatMoney, formatDate } from "../format";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

// Resolve the bound day's index into TripDetail.days, or null if no/invalid binding.
export function resolveDayIndex(detail: TripDetail, ctx: PageContext): number | null {
  const ref = ctx.dayRef;
  if (!ref) return null;
  if (ref.kind === "index") return ref.index < detail.days.length ? ref.index : null;
  const idx = detail.days.findIndex((d) => d.dayId === ref.dayId);
  return idx === -1 ? null : idx;
}

export const tripName: MacroDef<NoParams, string> = {
  name: "trip.name", kind: "inline", params: NoParams,
  description: "The trip's name.", emptyText: "untitled trip",
  resolve: (d): MacroResult<string> => (d.name.trim() === "" ? empty() : ok(d.name)),
};

export const tripDates: MacroDef<NoParams, string> = {
  name: "trip.dates", kind: "inline", params: NoParams,
  description: "The trip's date range (start date and number of days).", emptyText: "no dates set",
  resolve: (d): MacroResult<string> => {
    if (d.startDate === null) return empty();
    const last = d.days.length > 0 ? d.days[d.days.length - 1]!.date : d.startDate;
    return ok(d.days.length <= 1 ? formatDate(d.startDate) : `${formatDate(d.startDate)} – ${formatDate(last)}`);
  },
};

export const costTrip: MacroDef<NoParams, string> = {
  name: "cost.trip", kind: "inline", params: NoParams,
  description: "Total cost of the whole trip.", emptyText: "no costs yet",
  resolve: (d): MacroResult<string> => (d.tripCostTotal === 0 ? empty() : ok(formatMoney(d.tripCostTotal, d.currency))),
};

export const costDay: MacroDef<NoParams, string> = {
  name: "cost.day", kind: "inline", params: NoParams,
  description: "Total cost of the day this page is pointed at.", emptyText: "no costs on this day",
  resolve: (d, ctx): MacroResult<string> => {
    const idx = resolveDayIndex(d, ctx);
    if (idx === null) return unbound("day");
    const sub = d.days[idx]!.costSubtotal;
    return sub === 0 ? empty() : ok(formatMoney(sub, d.currency));
  },
};
```

- [ ] **Step 4: Run the test, verify it passes.**
Run: `pnpm --filter @tc/pages test -- inline`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/pages/src/macros/inline.ts packages/pages/src/macros/inline.test.ts
git commit -m "feat(M7): inline macro resolvers (trip.name/dates, cost.trip/day)"
```

### Task 2.4: Block macro resolvers

**Files:**
- Create: `packages/pages/src/macros/block.ts`
- Test: `packages/pages/src/macros/block.test.ts`

**Interfaces:**
- Consumes: `resolveDayIndex` (from `./inline`), payload types, `TripDetail`.
- Produces: `itineraryDay`, `itineraryTrip`, `costsTable` (each an `AnyMacroDef`).

- [ ] **Step 1: Write the failing test** `packages/pages/src/macros/block.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { itineraryDay, itineraryTrip, costsTable } from "./block";

const detail: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan", startDate: "2026-08-01", currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 5000 }],
  backlog: [], conflicts: [], dismissedConflictIds: [],
  activities: { a1: { activityId: "a1", title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], cost: { amountMinor: 5000, currency: "USD" } } },
  createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 5000, budgetRemaining: null,
};

describe("block resolvers", () => {
  it("itinerary.day returns the bound day's activities", () => {
    const r = itineraryDay.resolve(detail, { tripId: detail.tripId, dayRef: { kind: "index", index: 0 } }, {});
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.activities[0]!.title).toBe("Museum");
  });
  it("itinerary.day is unbound with no day binding", () => {
    expect(itineraryDay.resolve(detail, { tripId: detail.tripId }, {}).status).toBe("unbound");
  });
  it("itinerary.day is empty for a day with no activities", () => {
    const emptyDay = { ...detail, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] };
    expect(itineraryDay.resolve(emptyDay, { tripId: detail.tripId, dayRef: { kind: "index", index: 0 } }, {}).status).toBe("empty");
  });
  it("itinerary.trip returns all days; empty when there are none", () => {
    expect(itineraryTrip.resolve(detail, { tripId: detail.tripId }, {}).status).toBe("ok");
    expect(itineraryTrip.resolve({ ...detail, days: [] }, { tripId: detail.tripId }, {}).status).toBe("empty");
  });
  it("costs.table lists day + backlog rows with a total; empty when zero", () => {
    const r = costsTable.resolve(detail, { tripId: detail.tripId }, {});
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.total).toBe("$50.00");
    expect(costsTable.resolve({ ...detail, tripCostTotal: 0, days: [{ dayId: "d0", activityIds: [], date: "2026-08-01", costSubtotal: 0 }] }, { tripId: detail.tripId }, {}).status).toBe("empty");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter @tc/pages test -- block`
Expected: FAIL — cannot find `./block`.

- [ ] **Step 3: Write `packages/pages/src/macros/block.ts`:**
```ts
import { z } from "zod";
import type { TripDetail, PageContext } from "@tc/contracts";
import type { MacroDef, ItineraryDayPayload, ItineraryTripPayload, CostsTablePayload } from "../registry-types";
import { ok, empty, unbound, type MacroResult } from "../result";
import { formatMoney } from "../format";
import { resolveDayIndex } from "./inline";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

function dayPayload(detail: TripDetail, idx: number): ItineraryDayPayload {
  const day = detail.days[idx]!;
  return {
    dayId: day.dayId, date: day.date,
    activities: day.activityIds.map((id) => {
      const a = detail.activities[id]!;
      return {
        title: a.title,
        timeWindow: a.timeWindow ? `${a.timeWindow.start}–${a.timeWindow.end}` : null,
        cost: a.cost ? formatMoney(a.cost.amountMinor, detail.currency) : null,
      };
    }),
  };
}

export const itineraryDay: MacroDef<NoParams, ItineraryDayPayload> = {
  name: "itinerary.day", kind: "block", params: NoParams,
  description: "The activity list for the day this page is pointed at.", emptyText: "No activities on this day yet",
  resolve: (d, ctx): MacroResult<ItineraryDayPayload> => {
    const idx = resolveDayIndex(d, ctx);
    if (idx === null) return unbound("day");
    if (d.days[idx]!.activityIds.length === 0) return empty();
    return ok(dayPayload(d, idx));
  },
};

export const itineraryTrip: MacroDef<NoParams, ItineraryTripPayload> = {
  name: "itinerary.trip", kind: "block", params: NoParams,
  description: "The full itinerary — every day and its activities.", emptyText: "No days planned yet",
  resolve: (d): MacroResult<ItineraryTripPayload> => {
    if (d.days.length === 0) return empty();
    return ok({ days: d.days.map((_, i) => dayPayload(d, i)) });
  },
};

export const costsTable: MacroDef<NoParams, CostsTablePayload> = {
  name: "costs.table", kind: "block", params: NoParams,
  description: "A cost breakdown by day plus unscheduled, with a trip total.", emptyText: "no costs yet",
  resolve: (d): MacroResult<CostsTablePayload> => {
    if (d.tripCostTotal === 0) return empty();
    const rows = d.days
      .map((day, i) => ({ label: day.date ? `Day ${i + 1} · ${day.date}` : `Day ${i + 1}`, minor: day.costSubtotal }))
      .filter((r) => r.minor > 0)
      .map((r) => ({ label: r.label, amount: formatMoney(r.minor, d.currency) }));
    if (d.unscheduledCostSubtotal > 0) rows.push({ label: "Unscheduled", amount: formatMoney(d.unscheduledCostSubtotal, d.currency) });
    return ok({ rows, total: formatMoney(d.tripCostTotal, d.currency) });
  },
};
```

- [ ] **Step 4: Run the test, verify it passes.**
Run: `pnpm --filter @tc/pages test -- block`
Expected: PASS.
(Note: if `TimeWindow` field names differ from `start`/`end`, read `packages/contracts/src/activity.ts` and adjust the two references — the test will tell you.)

- [ ] **Step 5: Commit.**
```bash
git add packages/pages/src/macros/block.ts packages/pages/src/macros/block.test.ts
git commit -m "feat(M7): block macro resolvers (itinerary.day/trip, costs.table)"
```

### Task 2.5: Registry assembly, lookup, and validation

**Files:**
- Create: `packages/pages/src/registry.ts`
- Modify: `packages/pages/src/index.ts` (re-export the public surface)
- Test: `packages/pages/src/registry.test.ts`

**Interfaces:**
- Produces: `MACRO_REGISTRY: Record<string, AnyMacroDef>`, `getMacro(name): AnyMacroDef | undefined`, `resolveMacro(detail, ctx, name, rawParams): MacroResult<...> | { status: "unknown" } | { status: "bad-params"; message }`, `macroCatalog(): { name; kind; description; params: JSON-schema-ish }[]`, `MACRO_NAMES: readonly string[]`.

- [ ] **Step 1: Write the failing test** `packages/pages/src/registry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { MACRO_REGISTRY, getMacro, resolveMacro, MACRO_NAMES, macroCatalog } from "./registry";

const detail = { tripId: "11111111-1111-1111-1111-111111111111", name: "T", startDate: null, currency: "USD", budget: null, members: [{ userId: "u1", role: "owner" }], days: [], backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null } as TripDetail;

describe("registry", () => {
  it("registers all seven starter macros keyed by name", () => {
    expect(MACRO_NAMES).toEqual(expect.arrayContaining(["trip.name","trip.dates","cost.trip","cost.day","itinerary.day","itinerary.trip","costs.table"]));
    for (const name of MACRO_NAMES) expect(getMacro(name)!.name).toBe(name);
  });
  it("resolveMacro dispatches to the right resolver", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "trip.name", {})).toEqual({ status: "ok", value: "T" });
  });
  it("resolveMacro reports unknown macros without throwing", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "nope.nope", {}).status).toBe("unknown");
  });
  it("resolveMacro reports bad params without throwing", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "trip.name", { junk: 1 }).status).toBe("ok"); // strip() ignores extras
  });
  it("macroCatalog exposes name/kind/description for the AI + autocomplete", () => {
    const cat = macroCatalog();
    expect(cat.find((m) => m.name === "cost.trip")).toMatchObject({ kind: "inline", description: expect.any(String) });
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter @tc/pages test -- registry`
Expected: FAIL — cannot find `./registry`.

- [ ] **Step 3: Write `packages/pages/src/registry.ts`:**
```ts
import type { TripDetail, PageContext } from "@tc/contracts";
import type { AnyMacroDef, InlinePayload, BlockPayload } from "./registry-types";
import type { MacroResult } from "./result";
import { tripName, tripDates, costTrip, costDay } from "./macros/inline";
import { itineraryDay, itineraryTrip, costsTable } from "./macros/block";

const DEFS: AnyMacroDef[] = [
  tripName, tripDates, costTrip, costDay, itineraryDay, itineraryTrip, costsTable,
] as unknown as AnyMacroDef[];

export const MACRO_REGISTRY: Record<string, AnyMacroDef> = Object.fromEntries(DEFS.map((d) => [d.name, d]));
export const MACRO_NAMES: readonly string[] = DEFS.map((d) => d.name);

export function getMacro(name: string): AnyMacroDef | undefined {
  return MACRO_REGISTRY[name];
}

export type ResolveOutcome =
  | MacroResult<InlinePayload | BlockPayload>
  | { status: "unknown" }
  | { status: "bad-params"; message: string };

export function resolveMacro(detail: TripDetail, ctx: PageContext, name: string, rawParams: unknown): ResolveOutcome {
  const def = getMacro(name);
  if (!def) return { status: "unknown" };
  const parsed = def.params.safeParse(rawParams ?? {});
  if (!parsed.success) return { status: "bad-params", message: parsed.error.message };
  return def.resolve(detail, ctx, parsed.data as never);
}

export function macroCatalog(): { name: string; kind: string; description: string; emptyText: string }[] {
  return DEFS.map((d) => ({ name: d.name, kind: d.kind, description: d.description, emptyText: d.emptyText }));
}
```

- [ ] **Step 4: Update `packages/pages/src/index.ts`** to export the public surface:
```ts
// @tc/pages — pure macro registry, resolvers, and template seeds.
export * from "./result";
export * from "./registry-types";
export * from "./registry";
export * from "./templates";
```
(`./templates` lands in Task 2.6 — if running this task alone, add the line in 2.6 instead and export the rest here.)

- [ ] **Step 5: Run the test, verify it passes.**
Run: `pnpm --filter @tc/pages test -- registry`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/pages/src/registry.ts packages/pages/src/registry.test.ts packages/pages/src/index.ts
git commit -m "feat(M7): macro registry — lookup, safe resolve, AI/autocomplete catalog"
```

### Task 2.6: Template seeds + instantiation

**Files:**
- Create: `packages/pages/src/templates.ts`
- Test: `packages/pages/src/templates.test.ts`

**Interfaces:**
- Consumes: `PageContent`, `PageContext`, `CreatePageInput` (contracts).
- Produces: `DEFAULT_TEMPLATES: TemplateSeed[]` where `TemplateSeed = { key; title; buildContext(tripId): PageContext; content: PageContent }`; `instantiateDefaults(tripId): CreatePageInput[]`.

- [ ] **Step 1: Write the failing test** `packages/pages/src/templates.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, instantiateDefaults } from "./templates";
import { CreatePageInput, MacroNode } from "@tc/contracts";

describe("templates", () => {
  it("ships exactly Trip Overview + Day Sheet", () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.key)).toEqual(["trip-overview", "day-sheet"]);
  });
  it("instantiateDefaults produces valid CreatePageInputs bound to the trip", () => {
    const tripId = crypto.randomUUID();
    const inputs = instantiateDefaults(tripId);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(CreatePageInput.safeParse(input).success).toBe(true);
    expect(inputs[0]!.context.tripId).toBe(tripId);
    expect(inputs[1]!.context.dayRef).toEqual({ kind: "index", index: 0 }); // Day Sheet binds day 0
  });
  it("templates embed only registry macro nodes", () => {
    const nodes: unknown[] = [];
    const walk = (n: any) => { if (n?.type === "macro") nodes.push(n); (n?.content ?? []).forEach(walk); };
    DEFAULT_TEMPLATES.forEach((t) => walk(t.content));
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) expect(MacroNode.safeParse(n).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter @tc/pages test -- templates`
Expected: FAIL — cannot find `./templates`.

- [ ] **Step 3: Write `packages/pages/src/templates.ts`.** Build ProseMirror-shaped docs. Helper builders keep it readable:
```ts
import type { PageContent, PageContext, CreatePageInput } from "@tc/contracts";

const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });
const macro = (name: string, params: Record<string, unknown> = {}) => ({ type: "macro", attrs: { name, params } });

export interface TemplateSeed {
  key: string;
  title: string;
  buildContext(tripId: string): PageContext;
  content: PageContent;
}

const tripOverview: TemplateSeed = {
  key: "trip-overview",
  title: "Trip Overview",
  buildContext: (tripId) => ({ tripId }),
  content: {
    type: "doc",
    content: [
      heading("Overview"),
      para(macro("trip.name"), text(" — "), macro("trip.dates")),
      para(text("Total cost: "), macro("cost.trip")),
      heading("Itinerary"),
      macro("itinerary.trip"),
      heading("Costs"),
      macro("costs.table"),
    ],
  },
};

const daySheet: TemplateSeed = {
  key: "day-sheet",
  title: "Day Sheet",
  buildContext: (tripId) => ({ tripId, dayRef: { kind: "index", index: 0 } }),
  content: {
    type: "doc",
    content: [
      heading("Day plan"),
      para(text("Cost for the day: "), macro("cost.day")),
      macro("itinerary.day"),
    ],
  },
};

export const DEFAULT_TEMPLATES: TemplateSeed[] = [tripOverview, daySheet];

export function instantiateDefaults(tripId: string): CreatePageInput[] {
  return DEFAULT_TEMPLATES.map((t) => ({ title: t.title, context: t.buildContext(tripId), content: t.content }));
}
```

- [ ] **Step 4: Ensure `./templates` is exported** from `index.ts` (added in Task 2.5 Step 4).

- [ ] **Step 5: Run the test, verify it passes.**
Run: `pnpm --filter @tc/pages test -- templates`
Expected: PASS.

- [ ] **Step 6: Run the whole package + typecheck.**
Run: `pnpm --filter @tc/pages test && pnpm --filter @tc/pages typecheck`
Expected: all green.

- [ ] **Step 7: Commit.**
```bash
git add packages/pages/src/templates.ts packages/pages/src/templates.test.ts packages/pages/src/index.ts
git commit -m "feat(M7): default template seeds + lazy instantiation"
```

---

## WAVE 3 — Server: Pages CRUD module (Track S)

### Task 3.1: `pages` table — schema + migration

**Files:**
- Modify: `apps/web/src/server/db/schema.ts` (add `pages` table)
- Create (generated): `apps/web/drizzle/0003_*.sql`
- Test: `apps/web/src/server/pages.int.test.ts` (created in 3.2; the migration is verified there)

- [ ] **Step 1: Add the `pages` table** to `apps/web/src/server/db/schema.ts` (append; import `PageContent`, `PageContext` types):
```ts
import type { Origin, TripDetail, TripMember, PageContent, PageContext } from "@tc/contracts";
// ... existing tables ...

export const pages = pgTable("pages", {
  id: uuid("id").primaryKey(),
  tripId: uuid("trip_id").notNull(),
  title: text("title").notNull(),
  context: jsonb("context").$type<PageContext>().notNull(),
  content: jsonb("content").$type<PageContent>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  actorId: text("actor_id").notNull(),
}, (t) => [index("pages_trip").on(t.tripId)]);
```
(Add `index` to the `drizzle-orm/pg-core` import.)

- [ ] **Step 2: Generate the migration.**
Run: `pnpm --filter web db:generate`
Expected: a new `apps/web/drizzle/0003_*.sql` creating `pages`. Inspect it — it must `CREATE TABLE "pages"` with the columns above and an index on `trip_id`, and touch nothing else.

- [ ] **Step 3: Apply it locally and confirm.**
Run: `docker compose up -d && pnpm --filter web db:migrate`
Expected: migration applies cleanly.

- [ ] **Step 4: Commit.**
```bash
git add apps/web/src/server/db/schema.ts apps/web/drizzle/
git commit -m "feat(M7): pages table + migration"
```

### Task 3.2: Pages repository (CRUD + lazy default instantiation)

**Files:**
- Create: `apps/web/src/server/pages.ts`
- Test: `apps/web/src/server/pages.int.test.ts`

**Interfaces:**
- Consumes: `db`, `pages` table, `instantiateDefaults` (`@tc/pages`), contracts.
- Produces: `listPages(tripId): Promise<PageSummary[]>` (instantiates defaults on first call for a trip with zero pages), `getPage(id): Promise<Page | null>`, `createPage(tripId, input, actorId): Promise<Page>`, `updatePage(id, input): Promise<Page | null>`, `deletePage(id): Promise<boolean>`.

- [ ] **Step 1: Write the failing integration test** `apps/web/src/server/pages.int.test.ts` (mirror the setup of `apps/web/src/server/commands.int.test.ts` — same DB reset/beforeEach harness; read it first):
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { listPages, getPage, createPage, updatePage, deletePage } from "./pages";
import { resetDb, seedTrip } from "./testing/dbHarness"; // reuse existing harness util (see commands.int.test.ts imports)

describe("pages repository", () => {
  beforeEach(async () => { await resetDb(); });

  it("lazily instantiates the two default pages on first list", async () => {
    const { tripId } = await seedTrip();
    const first = await listPages(tripId);
    expect(first.map((p) => p.title).sort()).toEqual(["Day Sheet", "Trip Overview"]);
    const second = await listPages(tripId); // idempotent — no duplicate instantiation
    expect(second).toHaveLength(2);
  });

  it("creates, reads, updates, deletes a page", async () => {
    const { tripId } = await seedTrip();
    const created = await createPage(tripId, { title: "Notes", context: { tripId }, content: { type: "doc", content: [] } }, "user-1");
    expect(created.title).toBe("Notes");
    const fetched = await getPage(created.id);
    expect(fetched!.id).toBe(created.id);
    const updated = await updatePage(created.id, { title: "Renamed" });
    expect(updated!.title).toBe("Renamed");
    expect(updated!.updatedAt >= created.updatedAt).toBe(true);
    expect(await deletePage(created.id)).toBe(true);
    expect(await getPage(created.id)).toBeNull();
  });
});
```
(If no shared `dbHarness`/`seedTrip` exists, inline the same reset + a `CreateTrip` command call that `commands.int.test.ts` uses to make a trip, and read a real `tripId` from it.)

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter web test:int -- pages`
Expected: FAIL — cannot find `./pages`.

- [ ] **Step 3: Write `apps/web/src/server/pages.ts`:**
```ts
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Page, PageSummary, CreatePageInput, UpdatePageInput } from "@tc/contracts";
import { instantiateDefaults } from "@tc/pages";
import { db } from "./db/client";
import { pages } from "./db/schema";

function toPage(row: typeof pages.$inferSelect): Page {
  return { id: row.id, tripId: row.tripId, title: row.title, context: row.context, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt, actorId: row.actorId };
}

export async function createPage(tripId: string, input: CreatePageInput, actorId: string): Promise<Page> {
  const now = new Date().toISOString();
  const row = { id: randomUUID(), tripId, title: input.title, context: input.context, content: input.content, createdAt: now, updatedAt: now, actorId };
  await db.insert(pages).values(row);
  return toPage(row);
}

export async function listPages(tripId: string): Promise<PageSummary[]> {
  const existing = await db.select().from(pages).where(eq(pages.tripId, tripId));
  if (existing.length === 0) {
    // Lazy default instantiation — first visit only (idempotent: guarded by the zero-rows check).
    for (const seed of instantiateDefaults(tripId)) await createPage(tripId, seed, "system");
    const seeded = await db.select().from(pages).where(eq(pages.tripId, tripId));
    return seeded.map(toPage);
  }
  return existing.map(toPage);
}

export async function getPage(id: string): Promise<Page | null> {
  const [row] = await db.select().from(pages).where(eq(pages.id, id));
  return row ? toPage(row) : null;
}

export async function updatePage(id: string, input: UpdatePageInput): Promise<Page | null> {
  const patch: Partial<typeof pages.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.context !== undefined) patch.context = input.context;
  if (input.content !== undefined) patch.content = input.content;
  const [row] = await db.update(pages).set(patch).where(eq(pages.id, id)).returning();
  return row ? toPage(row) : null;
}

export async function deletePage(id: string): Promise<boolean> {
  const rows = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
  return rows.length > 0;
}
```
Note the lazy instantiation uses `actorId: "system"` for seeded defaults; user-created pages carry the real actor (Invariant 6a). If concurrent first-visits are a concern, the `trip_id` index + the zero-rows guard make a duplicate benign (a later task could add a unique partial index; out of scope now — note as known-issue if it worries the reviewer).

- [ ] **Step 4: Run the test, verify it passes.**
Run: `pnpm --filter web test:int -- pages`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/server/pages.ts apps/web/src/server/pages.int.test.ts
git commit -m "feat(M7): pages repository — CRUD + lazy default instantiation"
```

### Task 3.3: Pages API routes

**Files:**
- Create: `apps/web/src/app/api/trips/[tripId]/pages/route.ts` (GET list, POST create)
- Create: `apps/web/src/app/api/trips/[tripId]/pages/[pageId]/route.ts` (GET, PATCH, DELETE)
- Test: `apps/web/src/app/api/trips/[tripId]/pages/route.int.test.ts`

**Interfaces:**
- Consumes: `auth`, `getTripDetail` (membership check), pages repo.
- Produces: REST endpoints; membership-gated like the trip GET route.

- [ ] **Step 1: Write the failing test** (mirror `apps/web/src/app/api/trips/[tripId]/commands/batch/route.int.test.ts` for the request-harness style). Cover: unauthenticated → 401; non-member → 403; member GET list → the two defaults; POST create → 201 with the page; PATCH → updated; DELETE → 204/ok.

- [ ] **Step 2: Run it, verify it fails.**
Run: `pnpm --filter web test:int -- pages/route`
Expected: FAIL — routes missing.

- [ ] **Step 3: Write the list/create route** `apps/web/src/app/api/trips/[tripId]/pages/route.ts`:
```ts
import { CreatePageInput } from "@tc/contracts";
import { auth } from "@/server/auth";
import { getTripDetail } from "@/server/projections";
import { listPages, createPage } from "@/server/pages";

async function guard(tripId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  const detail = await getTripDetail(tripId);
  if (detail === null) return { error: Response.json({ error: "not-found" }, { status: 404 }) };
  if (!detail.members.some((m) => m.userId === session.user!.id)) return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { userId: session.user.id };
}

export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const g = await guard(tripId);
  if ("error" in g) return g.error;
  return Response.json({ pages: await listPages(tripId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const g = await guard(tripId);
  if ("error" in g) return g.error;
  const body = CreatePageInput.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "invalid-page" }, { status: 400 });
  if (body.data.context.tripId !== tripId) return Response.json({ error: "context tripId mismatch" }, { status: 400 });
  const page = await createPage(tripId, body.data, g.userId);
  return Response.json({ page }, { status: 201 });
}
```

- [ ] **Step 4: Write the item route** `apps/web/src/app/api/trips/[tripId]/pages/[pageId]/route.ts` (GET/PATCH/DELETE) reusing the same `guard` (extract it to `apps/web/src/server/pages-guard.ts` to avoid duplication — DRY). PATCH validates `UpdatePageInput`; DELETE returns `{ ok: true }` or 404. Ensure the page's `tripId` matches the URL (404 otherwise).

- [ ] **Step 5: Run the test, verify it passes.**
Run: `pnpm --filter web test:int -- pages/route`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add apps/web/src/app/api/trips/ apps/web/src/server/pages-guard.ts
git commit -m "feat(M7): pages REST routes (list/create/get/update/delete)"
```

---

## WAVE 4 — UI: editor, renderers, Notebook route (Track U)

### Task 4.1: MSW mocks + typed page client

**Files:**
- Create: `apps/web/src/lib/pagesClient.ts`
- Modify: `apps/web/src/mocks/handlers.ts` (add page endpoints)
- Test: `apps/web/src/lib/pagesClient.test.ts`

**Interfaces:**
- Produces: `fetchPages(tripId)`, `fetchPage(tripId, pageId)`, `createPage(tripId, input)`, `updatePage(tripId, pageId, patch)`, `deletePage(tripId, pageId)` — all returning contract-parsed types.

- [ ] **Step 1: Write the failing test** using MSW (mirror an existing `*Client.test.ts` if present; else the `src/mocks` setup). Assert `fetchPages` returns `PageSummary[]` and `createPage` round-trips a `Page`.
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter web test -- pagesClient` → FAIL.
- [ ] **Step 3: Write `pagesClient.ts`** — thin `fetch` wrappers hitting `/api/trips/:id/pages[/:pageId]`, each `Page.parse`/`PageSummary.parse`-ing the response (contract-honest client, the pattern the trip client uses).
- [ ] **Step 4: Add MSW handlers** returning `instantiateDefaults`-shaped data so the UI works against mocks before the server exists.
- [ ] **Step 5: Run the test, verify it passes.** Run: `pnpm --filter web test -- pagesClient` → PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(M7): typed pages client + MSW handlers"`

### Task 4.2: Macro renderers (inline chip + block components)

**Files:**
- Create: `apps/web/src/components/pages/MacroView.tsx`, `apps/web/src/components/pages/blocks/ItineraryDayBlock.tsx`, `.../ItineraryTripBlock.tsx`, `.../CostsTableBlock.tsx`, `.../EmptyChip.tsx`
- Test: `apps/web/src/components/pages/MacroView.test.tsx`

**Interfaces:**
- Consumes: `resolveMacro` (`@tc/pages`), `TripDetail`, `PageContext`.
- Produces: `<MacroView detail context name params />` — resolves and renders ok/empty/unbound. **This is the C-era swap seam:** block components consume resolver *payloads*; swapping a block for a live lens later touches only these files.

- [ ] **Step 1: Write the failing test** `MacroView.test.tsx` — render `cost.trip` with a total (shows formatted value), with zero (shows "no costs yet" chip), and `cost.day` with no day binding (shows "select a day" actionable chip). Use `@testing-library/react`.
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter web test -- MacroView` → FAIL.
- [ ] **Step 3: Write `MacroView.tsx`:**
```tsx
"use client";
import type { TripDetail, PageContext } from "@tc/contracts";
import { resolveMacro, getMacro } from "@tc/pages";
import { EmptyChip } from "./EmptyChip";
import { ItineraryDayBlock } from "./blocks/ItineraryDayBlock";
import { ItineraryTripBlock } from "./blocks/ItineraryTripBlock";
import { CostsTableBlock } from "./blocks/CostsTableBlock";

export function MacroView({ detail, context, name, params, onBindDay }: {
  detail: TripDetail; context: PageContext; name: string; params: Record<string, unknown>;
  onBindDay?: () => void;
}) {
  const def = getMacro(name);
  const outcome = resolveMacro(detail, context, name, params);
  if (outcome.status === "unknown") return <EmptyChip tone="error" label={`unknown macro: ${name}`} />;
  if (outcome.status === "bad-params") return <EmptyChip tone="error" label={`bad params: ${name}`} />;
  if (outcome.status === "unbound") return <EmptyChip tone="action" label="select a day" onClick={onBindDay} />;
  if (outcome.status === "empty") return <EmptyChip tone="muted" label={def?.emptyText ?? "—"} />;
  // ok:
  if (def?.kind === "inline") return <span className="text-fg">{outcome.value as string}</span>;
  switch (name) {
    case "itinerary.day": return <ItineraryDayBlock payload={outcome.value as never} />;
    case "itinerary.trip": return <ItineraryTripBlock payload={outcome.value as never} />;
    case "costs.table": return <CostsTableBlock payload={outcome.value as never} />;
    default: return <EmptyChip tone="error" label={`no renderer: ${name}`} />;
  }
}
```
- [ ] **Step 4: Write `EmptyChip.tsx`** and the three block components — plain read-only Tailwind using the M5 design tokens (`text-fg`, `bg-surface`, `border-hairline`, etc.; read `apps/web/src/components/ui` for the token vocabulary). Block components render lists/tables from the payload only.
- [ ] **Step 5: Run the test, verify it passes.** Run: `pnpm --filter web test -- MacroView` → PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(M7): macro renderers (inline + block) with ok/empty/unbound"`

### Task 4.3: TipTap editor with the custom macro node

**Files:**
- Create: `apps/web/src/components/pages/editor/MacroNodeExtension.ts`, `apps/web/src/components/pages/editor/PageEditor.tsx`, `apps/web/src/components/pages/editor/useMacroSuggestion.ts`
- Test: `apps/web/src/components/pages/editor/MacroNodeExtension.test.ts`

**Interfaces:**
- Consumes: TipTap, `MACRO_NAMES`/`macroCatalog` (`@tc/pages`), `MacroView`, `TripDetail`, `PageContext`.
- Produces: `<PageEditor detail context value onChange />` — a TipTap editor whose `macro` node renders via `MacroView` (React NodeView), with `{{` autocomplete inserting nodes.

- [ ] **Step 1: Write the failing test** for `MacroNodeExtension` — parse/serialize round-trip: a doc containing `{ type: "macro", attrs: { name: "cost.trip", params: {} } }` survives `getJSON()` unchanged. (Node-level test; the NodeView render is covered by the e2e.)
- [ ] **Step 2: Run it, verify it fails.** → FAIL.
- [ ] **Step 3: Write `MacroNodeExtension.ts`** — a TipTap `Node` named `macro`, `atom: true`, `inline` false for blocks / a second inline variant, `addAttributes` for `name` + `params`, `parseHTML`/`renderHTML` with a `data-macro` marker, and `addNodeView` returning a `ReactNodeView` that renders `<MacroView>`. (Two node types or one node with a `kind` attr — pick one; recommend one `macro` node whose `MacroView` decides inline vs block by `getMacro(name).kind`, wrapped in a `NodeViewWrapper`.)
- [ ] **Step 4: Write `useMacroSuggestion.ts`** — a `@tiptap/suggestion` config triggered by `{{`, listing `macroCatalog()` items, inserting a `macro` node on select. Filter by typed text against `name`/`description`.
- [ ] **Step 5: Write `PageEditor.tsx`** — `useEditor` with `StarterKit` + `MacroNodeExtension` + the suggestion, `content={value}`, `onUpdate` → `onChange(editor.getJSON())`. Pass `detail`/`context` down to the NodeView via extension storage or React context.
- [ ] **Step 6: Run the test, verify it passes.** → PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat(M7): TipTap editor + custom macro node + {{ autocomplete"`

### Task 4.4: Notebook route (list) + page editor route

**Files:**
- Create: `apps/web/src/app/trips/[tripId]/pages/page.tsx` (Notebook list)
- Create: `apps/web/src/app/trips/[tripId]/pages/[pageId]/page.tsx` (editor)
- Create: `apps/web/src/components/pages/NotebookScreen.tsx`, `apps/web/src/components/pages/PageScreen.tsx`, `apps/web/src/components/pages/DayBindingControl.tsx`
- Modify: `apps/web/src/components/trip/TripHeader.tsx` (add a "Notebook" link to the trip nav, pointing at `/trips/:id/pages`)
- Test: `apps/web/src/components/pages/NotebookScreen.test.tsx`, `PageScreen.test.tsx`

**Interfaces:**
- Consumes: `pagesClient`, `PageEditor`, `MacroView`, the trip detail fetch (for resolver context).
- Produces: the two routes (separate route subtree — decided 2026-07-20, refines spec decision 11); the editor autosaves via `updatePage` (debounced), and `DayBindingControl` sets `context.dayRef` (satisfies the "point at a day" gesture + the `unbound` chip's action).

- [ ] **Step 1: Write the failing tests** — NotebookScreen lists pages + "New page"/rename/delete; PageScreen loads a page, renders the editor, and a day-bound page shows populated blocks. Mock `pagesClient` + a `TripDetail`.
- [ ] **Step 2: Run them, verify they fail.** → FAIL.
- [ ] **Step 3: Implement `NotebookScreen.tsx`** — fetch `listPages`, render cards (title, binding, updatedAt), create/rename/delete via the client, link each to the editor route. On mount it triggers the lazy default instantiation server-side (first `listPages`).
- [ ] **Step 4: Implement `PageScreen.tsx`** — fetch the page + the trip detail (reuse the existing trip fetch/client), render `<PageEditor detail context value onChange>`, debounce-autosave via `updatePage`, and mount `DayBindingControl` (a day picker writing `context.dayRef`). Wire the `MacroView onBindDay` to open it.
- [ ] **Step 5: Add the Notebook nav entry** in `TripHeader.tsx` (a link, not a lens — the lens system stays projection-only). Keep it visually consistent with the existing lens tabs.
- [ ] **Step 6: Run the tests, verify they pass.** → PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat(M7): Notebook + page editor routes, day binding"`

---

## WAVE 5 — AI generation via Vercel AI Gateway (depends on Waves 2+3)

### Task 5.1: Gateway config + env

**Files:**
- Modify: `apps/web/src/server/config.ts` (add `aiGatewayApiKey`, `aiModel`)
- Modify: `.env.example` (document `AI_GATEWAY_API_KEY`, `AI_MODEL`)
- Create: `apps/web/src/server/ai/gateway.ts`
- Test: `apps/web/src/server/ai/gateway.test.ts`

**Interfaces:**
- Produces: `aiModel()` returning a configured gateway model handle; throws a clear error if `AI_GATEWAY_API_KEY` is unset (server-only).

- [ ] **Step 1: Write the failing test** — `aiModel()` throws "AI_GATEWAY_API_KEY not set" when the env is absent; returns a handle when present. (Unit — no network.)
- [ ] **Step 2: Run it, verify it fails.** → FAIL.
- [ ] **Step 3: Implement.** Add `aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY ?? ""` and `aiModel: process.env.AI_MODEL ?? "anthropic/claude-haiku-4-5"` to `serverConfig`. `gateway.ts` uses `@ai-sdk/gateway`'s `createGateway({ apiKey })` and returns `gateway(serverConfig.aiModel)`. Default to a **cheap** model (the closed-action-space thesis — ADR-015). Guard: throw if the key is empty.
- [ ] **Step 4: Run the test, verify it passes.** → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(M7): Vercel AI Gateway config + model handle"`

### Task 5.2: Planning tools derived from command schemas

**Files:**
- Create: `apps/web/src/server/ai/planningTools.ts`
- Test: `apps/web/src/server/ai/planningTools.test.ts`

**Interfaces:**
- Consumes: `BatchableCommand` (contracts), the AI SDK `tool()`, `executeTripCommandBatch`.
- Produces: `buildPlanningTools(tripId): Record<string, Tool>` — each batchable command type becomes a `tool` whose `parameters` is that command's Zod schema (minus `tripId`, injected server-side), collecting calls into a pending batch; `flushPlanningBatch(tripId, calls, actorId)` executes them as **one atomic batch** via `executeTripCommandBatch`.

- [ ] **Step 1: Write the failing test** — assert the tool set's keys match the `BatchableCommand` union members, that a tool's `parameters` rejects a malformed command, and that `flushPlanningBatch` calls `executeTripCommandBatch` with the collected commands (mock the command service). No hand-written schema — derive from `BatchableCommand`.
- [ ] **Step 2: Run it, verify it fails.** → FAIL.
- [ ] **Step 3: Implement `planningTools.ts`.** Enumerate the `BatchableCommand` discriminated-union options; for each, create `tool({ description, parameters: <that member's schema omitting tripId>, execute: (args) => collect({ ...args, tripId }) })`. `flushPlanningBatch` submits the collected array to `executeTripCommandBatch(commands, actorId)` → one `batchId`, one history entry (ADR-013). (Read `packages/contracts/src/*` to get the `BatchableCommand` definition and iterate its options; if the union isn't programmatically enumerable, add a `BATCHABLE_COMMAND_SCHEMAS` export to contracts in a small contract change — changelog + this consumer.)
- [ ] **Step 4: Run the test, verify it passes.** → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(M7): AI planning tools derived from command schemas → atomic batch"`

### Task 5.3: Page tools derived from the registry

**Files:**
- Create: `apps/web/src/server/ai/pageTools.ts`
- Test: `apps/web/src/server/ai/pageTools.test.ts`

**Interfaces:**
- Consumes: `macroCatalog`, `MACRO_NAMES` (`@tc/pages`), the AI SDK `tool()`.
- Produces: `buildPageTools()` → an `insert_block`/`compose_page` toolset whose macro `name` is a Zod `enum(MACRO_NAMES)`; `validateComposedPage(content): PageContent | { error }` rejecting any non-registry macro node.

- [ ] **Step 1: Write the failing test** — `compose_page` accepts a doc of registry macros; `validateComposedPage` rejects a doc containing `{{nope.nope}}`; the macro-name param is a closed enum (unknown names fail schema validation).
- [ ] **Step 2: Run it, verify it fails.** → FAIL.
- [ ] **Step 3: Implement `pageTools.ts`** — the compose tool's parameters describe a simplified page shape (title + array of blocks, each a paragraph/heading/macro), macro `name` constrained to `z.enum(MACRO_NAMES)`. `validateComposedPage` walks the doc, `MacroNode.parse`-ing each macro node and checking `getMacro(name)` exists + params pass the macro's schema; on any failure return `{ error }` (the route downgrades or rejects — ADR-015 "validated before insert").
- [ ] **Step 4: Run the test, verify it passes.** → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(M7): AI page tools derived from the macro registry"`

### Task 5.4: Context envelope builder

**Files:**
- Create: `apps/web/src/server/ai/context.ts`
- Test: `apps/web/src/server/ai/context.test.ts`

**Interfaces:**
- Consumes: `TripDetail`, `macroCatalog`.
- Produces: `buildEnvelope({ detail, surface, pageContext? })` → `{ surface, tripSummary, macros, tools }` where `tripSummary` is a **compact** projection (day list: date + activity titles + cost totals — NOT full `TripDetail`) and `tools` names only the surface-relevant family.

- [ ] **Step 1: Write the failing test** — a `page` surface envelope includes the macro catalog + a summarized trip (no raw activity objects, no conflicts array), and `tools: ["page"]`; a `board` surface yields `tools: ["planning"]`; a `combined` surface yields both. Assert the summary is materially smaller than the full detail (e.g. no `activities` record, no `conflicts`).
- [ ] **Step 2: Run it, verify it fails.** → FAIL.
- [ ] **Step 3: Implement `context.ts`** — map `detail.days` to `{ index, date, activities: [titles], cost }`, include `name`, `currency`, `tripCostTotal`; attach `macroCatalog()` for page/combined surfaces; select the tool family by surface. Keep it a pure function (testable, token-bounded).
- [ ] **Step 4: Run the test, verify it passes.** → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(M7): typed AI context envelope (summarized projection + scoped tools)"`

### Task 5.5: AI route + compose panel UI

**Files:**
- Create: `apps/web/src/app/api/trips/[tripId]/ai/route.ts`
- Create: `apps/web/src/components/pages/ai/ComposePanel.tsx`
- Test: `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts`

**Interfaces:**
- Consumes: `aiModel`, `buildEnvelope`, `buildPlanningTools`/`flushPlanningBatch`, `buildPageTools`/`validateComposedPage`, `generateText`/`generateObject` (AI SDK), `auth` + membership guard.
- Produces: `POST /api/trips/:id/ai` `{ prompt, surface, pageContext? }` → for `page` surface returns a validated `PageContent`; for `board`/`combined` executes an atomic batch and returns the new `detail`/`history`. A `ComposePanel` UI on the page editor (and optionally the board) sends the prompt and applies the result.

- [ ] **Step 1: Write the failing integration test** — **mock the model** (inject a fake `aiModel` returning a canned tool call / object). Assert: a page-surface request yields a doc that passes `validateComposedPage`; a board-surface request calls `executeTripCommandBatch` once (one batch); an unauthenticated request → 401; a non-member → 403; a model producing an unknown macro → the response is rejected/downgraded, never a broken node. No real network.
- [ ] **Step 2: Run it, verify it fails.** → FAIL.
- [ ] **Step 3: Implement the route** — guard (auth + membership, reuse `pages-guard`), fetch `getTripDetail`, `buildEnvelope`, call the AI SDK with the surface-appropriate tools + a system prompt that hands the model ONLY the envelope. Page surface: `generateObject`/tool → `validateComposedPage` → return content (or `{ error }`). Board/combined: collect tool calls → `flushPlanningBatch` → return `{ detail, history }`. Design the model interface so it's injectable for the test (accept an optional model arg defaulting to `aiModel()`).
- [ ] **Step 4: Implement `ComposePanel.tsx`** — a prompt box; on submit POSTs to the AI route; for pages, sets the editor content to the returned doc (user reviews before it autosaves); for the board, the returned detail/history flow through the existing optimistic/refetch path.
- [ ] **Step 5: Run the test, verify it passes.** → PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(M7): AI route + compose panel — pages & plan edits, validated"`

---

## WAVE 6 — Gate: e2e, checks, close-out

### Task 6.1: M7 e2e script

**Files:**
- Create: `apps/web/e2e/m7-solo-delight.spec.ts`
- Read: `apps/web/e2e/helpers.ts`, an existing spec (e.g. `m6-optimistic.spec.ts`) for the harness

- [ ] **Step 1: Write the happy-path e2e** (Playwright, mirroring the existing specs' auth/seed helpers). Cover the exit-gate demo: open a trip → Notebook → the two defaults exist → open Trip Overview → name/dates/total + itinerary render → add a cost via the board → reopen → total updated → open Day Sheet, bind it to a day → blocks populate → type `{{` → autocomplete → insert `cost.trip` → resolves. If AI is reliably testable with a mocked model in e2e, add a compose step; otherwise assert the ComposePanel renders and defer the model call to the integration test (note this in the spec).
- [ ] **Step 2: Run it green locally.**
Run: `pnpm --filter web test:e2e -- m7`
Expected: PASS.
- [ ] **Step 3: Run ALL prior e2e specs** to confirm nothing regressed.
Run: `pnpm --filter web test:e2e`
Expected: every milestone's spec green.
- [ ] **Step 4: Commit.** `git commit -m "test(M7): e2e — notebook, dynamic pages, day binding, autocomplete"`

### Task 6.2: Full check + gate-close + PR

**Files:**
- Modify: `TODO.md`, `docs/milestones/M7-solo-delight.md`, `docs/milestones/README.md`, `docs/known-issues.md` (if any KI logged)

- [ ] **Step 1: Run the whole gate.**
Run: `pnpm check && pnpm --filter web test:int && pnpm --filter web test:e2e`
Expected: typecheck + lint (incl. lint-wall + color-wall) + unit + integration + e2e ALL green. The projection-rebuild golden test is green and untouched (no event/reducer changes).

- [ ] **Step 2: Deploy-gate demo** on the Vercel preview/prod URL per the M7 exit gate (Task 0.4). If Mitchell waives the click-through in favor of the local e2e (as at M4), record the waiver in the milestone retro.

- [ ] **Step 3: Run the gate-close checklist in ONE commit** (per `docs/milestones/README.md`): tick M7 in `TODO.md`; check every exit-gate box in `M7-solo-delight.md`; append the retro note; bump `Current milestone` to **Phase 1 gate review** (the next `TODO.md` item) in `docs/milestones/README.md`. Log any deferred item (e.g. the concurrent-first-visit unique index, or AI eval hardening) in `docs/known-issues.md`.
```bash
git add TODO.md docs/milestones/ docs/known-issues.md
git commit -m "docs(M7): close the milestone — gate-close checklist in one commit"
```

- [ ] **Step 4: Open the PR** to `main`.
```bash
gh pr create --title "M7: Solo delight — dynamic pages, macros, templates, constrained AI" --body "$(cat <<'EOF'
Implements M7 per docs/specs/2026-07-20-M7-solo-delight-design.md and docs/plans/2026-07-20-M7-solo-delight.md.

- New @tc/pages package: macro registry, pure resolvers (ok/empty/unbound), template seeds
- Pages CRUD module (ADR-014): pages table, repo, REST routes, lazy default instantiation
- TipTap editor + custom macro node + {{ autocomplete; macro renderers (inline + block)
- Notebook + page editor routes; day binding
- AI via Vercel AI Gateway (ADR-015): planning tools ← command schemas (atomic batch), page tools ← registry; typed context envelope
- ADR-014, ADR-015, milestone file, e2e, contracts changelog

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR opens; CI green before merge.

---

## Self-review (completed against the spec)

- **Spec coverage:** Every spec §/decision maps to a task — typed macro nodes (2.5/4.3), registry-as-source-of-truth (2.5, consumed in 4.2/4.3/5.2/5.3), B-built-for-C swap seam (4.2 block components), CRUD Pages module + Yjs-ready content (0.2/1.1/3.x), ok/empty/unbound (2.1–2.4/4.2), copy-on-create lazy templates (2.6/3.2), Notebook (4.4, as a **route** per the 2026-07-20 refinement), context binding (4.4 DayBindingControl), AI both families derived + atomic batch + envelope + gateway (5.1–5.5), out-of-scope items untouched (no Yjs, no interactive lenses, no trip templates), invariants (Global Constraints + per-task notes), preflight/ADRs/milestone/gate (0.1/0.2/0.3/0.4/6.2).
- **Placeholder scan:** No "TBD/handle appropriately". The few narrative steps (4.1, 4.4, 5.x UI) name exact files, interfaces, and assertions; load-bearing/tricky code (contracts, resolvers, registry, repo, tools) is written in full.
- **Type consistency:** `MacroResult`/`ok`/`empty`/`unbound`, `MacroDef`, `resolveMacro`, `macroCatalog`/`MACRO_NAMES`, `instantiateDefaults`, `PageContext`/`DayRef`/`MacroNode`/`Page`/`CreatePageInput`/`UpdatePageInput`, `listPages`/`getPage`/`createPage`/`updatePage`/`deletePage` are named identically wherever they're consumed across waves.
- **Deviations from spec flagged:** (a) Notebook is a **separate route**, not the lens "Pages tab" of spec decision 11 — Mitchell chose this 2026-07-20; spec to be synced. (b) A new **`@tc/pages`** package houses the registry — Mitchell approved 2026-07-20; ADR-014 notes it.
