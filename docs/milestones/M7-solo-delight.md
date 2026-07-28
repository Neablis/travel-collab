# M7 — Solo delight (dynamic pages, macros, templates, constrained AI)

**Status:** Gate closed 2026-07-21; **AI-layer hardening continued through 2026-07-26** (24 further commits — see "Post-gate retro" at the end of this file). Merged to `main` 2026-07-26 via PR #15 (`4093b59`); this retro and KI-11/12/13 landed separately on 2026-07-27, the squash snapshot having predated them.
Design spec: `docs/specs/2026-07-20-M7-solo-delight-design.md`
Decision records: `docs/architecture/ADR-014-pages-crud-module.md`, `docs/architecture/ADR-015-ai-gateway-derived-tools.md`

## Scope

- **Dynamic pages with typed macros:** Rich-text documents (TipTap) that embed
  typed macro objects — inline scalars (`{{cost.trip}}`, `{{trip.name}}`) and
  block embeds (`{{itinerary.day}}`) — which resolve live against `TripDetail`.
  Macros are custom TipTap nodes, not text interpolation; resolution is pure and
  happens at render time.

- **Macro registry as single source of truth:** One declarative registry table
  (`name`, `kind`, Zod `params` schema, `description`, `emptyText`, pure
  `resolver`) drives autocomplete, renderers, and AI tool vocabulary. Three
  consumers, one table, no drift.

- **Default templates, lazily instantiated:** Trip Overview (name, dates, cost
  total, per-day itinerary blocks) and Day Sheet (context-bound to a day) are
  code-defined seed documents. On first visit to a trip's Notebook, defaults are
  instantiated into ordinary page rows; later template edits don't touch existing
  pages.

- **Notebook route outside time-travel:** A dedicated `/trips/[tripId]/pages`
  route subtree for the Pages tab. Pages read the projection and never write
  planning data; reverting rewinds the plan but not the prose. Macros soften
  this by auto-updating when the trip state changes.

- **Pages as a CRUD module (ADR-014):** Pages follow the ADR-003 scope precedent
  — CRUD operations live outside the trip command pipeline. Content is ProseMirror
  JSON (Yjs-ready for M8/M11 CRDT migration). No event sourcing, no entry in trip
  history.

- **Schema-derived, constrained AI (ADR-015):** All model calls route through
  Vercel AI Gateway. Two tool families, both derived from schemas (never
  hand-written): planning tools from `@tc/contracts` command schemas (executed as
  an M6 atomic batch), page tools from the macro registry (registry-generated
  enum). A typed context envelope (surface + summarized projection + surface-
  relevant tools only) bounds hallucination and token usage.

- **Integration layer in new `@tc/pages` package:** Pure package (depends on
  `@tc/contracts` only) mirrors the `@tc/predict` precedent — importable by both
  UI and server without tripping the `@tc/domain` lint wall. Exports the macro
  registry, resolver types, and page operations.

- **Empty / unbound semantics:** Three-state resolution results: `ok` (render
  value), `empty` (valid path, no data yet → declarative placeholder chip), and
  `unbound` (macro needs context the page lacks → actionable binding chip). A
  template instantiated into a brand-new empty trip renders as a fully legible
  skeleton.

## Exit gate

- [x] **Demo on the deployed Vercel URL:** open a trip's **Notebook** → the two
      default pages (**Trip Overview**, **Day Sheet**) exist. Open Trip Overview
      → trip name/dates/cost total + per-day itinerary blocks render live. Add a
      cost on the board → reopen the page → the total updates. Open a fresh empty
      trip's Notebook → default pages render as a legible skeleton (every macro
      shows its empty/unbound state). Point a Day Sheet at a day → its blocks
      populate. Type `{{` in the editor → autocomplete → insert `{{cost.trip}}`
      → it resolves. **Undo** a trip revert → macros update, prose persists.
      *(Live click-through waived — see retro note; covered locally by the
      Task 6.1 e2e specs, which exercise this exact script end-to-end.)*

- [x] **AI demo:** on a page, prompt "make a one-page overview of this trip" →
      a valid page is composed (only registry macros, validated). On the board,
      prompt "add a museum visit on day 2" → one atomic batch → one history entry
      → one undo reverts it.
      *(Live click-through waived — see retro note; the equivalent behavior is
      covered by Task 5.5's mocked-model integration test
      (`ai/route.int.test.ts`), never a live AI Gateway call.)*

- [x] **Tests:** `@tc/pages` unit tests (resolvers: ok/empty/unbound; registry
      validation), pages CRUD integration tests, the AI batch-path integration
      test, and the M7 e2e script all green; all prior milestones' e2e scripts
      still green; projection-rebuild golden test still green (unchanged).

- [x] A retro note appended at gate close.

## Retro (2026-07-21)

**What shipped:** dynamic pages (TipTap) with typed macro nodes resolving
live against `TripDetail`; a single macro registry (`@tc/pages`) driving
autocomplete, renderers, and AI tool vocabulary from one source; lazily
instantiated default templates (Trip Overview, Day Sheet) that seed on first
Notebook visit without touching later template edits; a Notebook route
(`/trips/[tripId]/pages`) outside time-travel, with pages as a plain CRUD
module (ADR-014) — no event sourcing, Yjs-ready content for the future M8/M11
CRDT migration; ok/empty/unbound three-state macro resolution so a
brand-new empty trip's default pages render as a legible skeleton; and
schema-derived, constrained AI (ADR-015) via Vercel AI Gateway — planning
tools derived from `@tc/contracts` command schemas (executed as one M6
atomic batch), page tools derived from the macro registry, both bounded by a
typed context envelope (surface + summarized projection + surface-relevant
tools only). Trip templates were re-scoped out to M9 per the 2026-07-20
design reframe (see `TODO.md`).

**Two real bugs found and fixed during TDD:**

1. **`pages.ts` `.returning()` timestamp-format bug (Wave 3, Task 3.2).**
   `createPage`'s first-pass implementation returned `toPage(row)` built from
   the pre-insert JS object, whose `createdAt`/`updatedAt` were
   `new Date().toISOString()` strings (`T` separator, `Z` suffix). Every
   other repository function (`updatePage`, `getPage`) instead round-trips
   through Postgres, whose `timestamptz` column (drizzle, `mode: "string"`)
   serializes as `"2026-07-21 06:44:15.130+00"` (space separator, `+00`
   offset). Comparing the two differently-formatted strings with `>=`
   deterministically failed (`' '` sorts before `'T'` lexicographically,
   independent of actual chronological order) — a real, reproducible
   correctness bug, not a flake. Fixed by adding `.returning()` to the insert
   and building the returned `Page` from the DB row like every other
   function, so all `pages.ts` timestamps now share one source of format
   truth.
2. **AI SDK `toolResults` step-scoping bug (Wave 5, Task 5.5).** The AI route
   integration test initially reported "model did not compose a page" even
   though the mock model did call `compose_page`. Root cause: AI SDK v4's
   `GenerateTextResult.toolResults` is `lastStep.toolResults` — only the
   *final* step's tool results, not every step's. With `maxSteps > 1`, a
   trailing "stop" step with no tool calls became the last step, so
   `result.toolResults` came back empty even though an earlier step had a
   real tool call. Fixed by scanning `result.steps.flatMap(s =>
   s.toolResults)` instead of trusting the top-level `toolResults` field.

**Deploy-gate demo (including the AI compose/plan-edit demo) not yet
performed** — pending Mitchell's manual click-through; local e2e (Task 6.1)
covers the equivalent behavior for pages/macros/day-binding/autocomplete
with a mocked AI safety boundary; AI behavior itself is validated only by
Task 5.5's mocked-model integration test, never a live call. This mirrors
the M4 precedent (waiving live click-through in favor of local coverage,
recorded honestly here rather than silently skipped).

**Full local gate (2026-07-21), `POSTGRES_PORT=5439`:**
- `pnpm check` (typecheck + lint + lint-wall + color-wall + unit): all green
  across `packages/contracts` (36 tests), `packages/domain` (77 tests),
  `packages/pages` (23 tests), `apps/web` unit (147 tests). One non-blocking
  lint warning (`and` imported but unused in `apps/web/src/server/pages.ts`,
  flagged and accepted in Task 3.2's self-review — copied verbatim from the
  task brief's given code).
- `pnpm --filter web test:int`: 9 files, 44 tests, all green — including the
  **GOLDEN: rebuild from the log equals the live projections** test in
  `commands.int.test.ts`, confirmed green and unaffected (no event/reducer
  changes this milestone).
- `pnpm --filter web test:e2e`: all M7 e2e specs green
  (`m7-solo-delight.spec.ts`, all 3 tests), plus every prior milestone's e2e
  script still green (`smoke`, `m1`–`m6`). One pre-existing flake reproduced
  and confirmed non-regressive: `m1-board.spec.ts` fails on its first attempt
  against a freshly-started `next dev --turbopack` server (cold-start/compile
  latency) and passes cleanly on retry — identical to the pattern documented
  in Task 6.1's report, untouched by any M7 diff.

**Deferred items logged to `docs/known-issues.md`:**
- **KI-6** — the `listPages` lazy-instantiation race (concurrent first
  visits to an empty trip's Notebook can both see zero rows and both seed
  default pages), noted and accepted as out of scope in Task 3.2. A unique
  partial index would close it.
- **KI-7** — the `ai` / `@ai-sdk/gateway` V1/V2 `LanguageModel` provider-type
  skew (installed `@ai-sdk/gateway@1.0.41` targets `LanguageModelV2`; the
  repo's `ai@^4.0.0` pin expects `V1`), bridged with a single documented
  cast at the one call site in Task 5.5. Real fix is a dependency pin/
  upgrade.

## Post-gate retro (2026-07-21 → 2026-07-26)

The gate above closed on 2026-07-21. **Twenty-four more commits followed — 41%
of the branch — every one in the AI layer, every one triggered by Mitchell
manually prompting the deployed build.** `handleAiRequest.ts` was modified 8
times, `planningTools.ts` 5, `batchResolver.ts` 5, `context.ts` 4. This section
records why, because the pattern is more useful than any individual fix.

### One root cause, seven times

| Date | Bug | What a mocked model cannot do |
|---|---|---|
| 07-21 | Context envelope carried titles but no ids → model emitted zero tool calls | Refuse to invent a UUID |
| 07-24 | Move/Update/Remove required verbatim UUIDs → `*Ref` resolution | Get an id subtly wrong |
| 07-24 | KI-8: `RemoveDay`, `DismissConflict`, money minor-units | Choose a wrong format |
| 07-25 | A `no-op` sub-command aborted the entire atomic batch | Emit a redundant command |
| 07-25 | Same-batch `dayRef` resolved against the pre-batch trip | Add a day, then use it |
| 07-26 | Append-only projection ignored removals/moves | Mix removes and adds in one batch |
| 07-26 | `MAX_STEPS.board = 6` truncated every itinerary (`e9fe19b`) | Run longer than its step budget |

Task 5.5's integration test was green through all seven. `MockLanguageModelV4`
is a scripted `doGenerate`: it emits well-formed tool calls, emits them when
told, and stops when told. Real models do none of those reliably. A mock
validates *our* code path given well-formed input; it cannot produce the
malformed input that caused every actual failure. Logged as **KI-11** — it is a
structural limit, not a missing assertion.

This was not concealed. The gate's **AI demo** box carries an explicit waiver
("never a live AI Gateway call"), and the 07-21 retro says so plainly. The
process recorded the risk accurately and the risk then landed. The lesson is
narrower than "be more honest": **"covered locally by mocked tests" was treated
as equivalent coverage, when the waived criterion was the only one exercising a
real model.** A waived gate criterion should carry a scheduled follow-up, not
just a note.

### What to keep

**The `meta` envelope was the highest-leverage thing M7 built.** Every root
cause above was diagnosed from `steps` / `finishReason` / `toolCalls` / `usage`
in the response body — the 07-26 truncation bug was provable in minutes because
`steps: 6` and `finishReason: "tool-calls"` were already there. When trimming
tokens (see `TODO.md`'s "best model for my buck"), **trim the prompt, never the
telemetry.**

### What to do differently

1. **Read the ceiling first.** The 2026-07-25 findings recorded "15 `AddDay`s
   across 6 steps" and attributed it to weak-model over-generation. That is the
   identical `steps == MAX_STEPS` signature as the 07-26 truncation bug — the
   evidence was written into the plan doc five days early and read past, because
   attention was on the resolver then under construction. **A run ending at
   exactly its configured ceiling is a budget problem until proven otherwise.**
   Diagnosis gravitates toward whatever layer is currently being built; the fix
   is to check the boring limits before the interesting logic.
2. **State the invariant before the third rewrite.** The resolver was rebuilt
   three times: per-tool `execute()` resolution (07-24) → manifest-driven
   `resolveBatch` (07-25) → real-`TripState` dry-run (07-26). Each was a real
   improvement, but the final design followed directly from one requirement —
   *the resolver must agree with the executor* — which was reachable at the
   start. Asking "what invariant must this layer hold?" would have skipped two
   rounds.
3. **A milestone whose headline feature is model-driven isn't done at gate
   close.** M7's gate criteria were all satisfiable without a live model. For
   any future AI-facing milestone, at least one exit criterion should be a real
   call whose `meta` is pasted into the milestone file.

### Issues opened from this retro

- **KI-11** — no AI test ever calls a real model; the "real model ≠ mock" class
  is invisible to CI.
- **KI-12** — the AI cannot name a trip (`BatchableCommand` has no
  `SetTripName`) or set its dates, so "plan me a trip" leaves "New TRip" with
  null dates.
- **KI-13** — `pnpm check` is not reliably green (jsdom component tests time out
  under parallel load; a different set fails each run).
