# M7 design — Solo delight (dynamic pages, macros, templates, constrained AI)

**Date:** 2026-07-20 · **Status:** Approved by Mitchell (decisions 1–12 below)
**Companions:** ADR-014 (Pages as a CRUD module; content Yjs-ready — to be
written), ADR-015 (AI via Vercel AI Gateway; tools derived from schemas — to be
written), ADR-003 (event-sourcing scoped to planning), ADR-013 (atomic batches +
optimistic updates), foundation design §"Rich-text editor at M7 … embeds M11",
`docs/milestones/M7-solo-delight.md`, `AGENTS.md`

## 1. Goal

Turn the planning projection the product has spent M1–M6 populating into
**dynamic, communicable pages**. A page is rich text (TipTap) that embeds
**typed macro objects** — inline scalars (`{{cost.trip}}`, `{{trip.name}}`) and
block embeds (`{{itinerary.day}}`) — which resolve **live** against `TripDetail`.
Predefined **templates** (Trip Overview, Day Sheet) are auto-instantiated per
trip and then freely editable. A **Notebook** (the trip's Pages tab) lists them.
Finally, **AI generation** — via Vercel AI Gateway — builds pages *and* edits the
plan, constrained to a **typed, schema-derived tool surface** so it can only do
what a user could.

This is the reframed M7. The original roadmap line said "basic trip notes page
(no embeds)" with embeds deferred to M11, and listed "trip templates." Both
change by Mitchell's explicit decision (this document): **embeds land now**
(scoped as *data macros over the trip's own projection*, distinct from M11's
*community-object* embeds), and **trip templates move to M9** (they are
clone-with-lineage machinery, M9's bet, and would otherwise be built twice).

No invariant weakens. Pages **read** the projection and never write planning data
— the event log stays the sole source of truth for planning (§Invariant 1).
Macro resolvers are **pure functions over `TripDetail`**, keeping the domain-core
purity discipline at the integration layer. AI plan-edits flow through the
**standard command pipeline as an M6 atomic batch** — the model cannot bypass
validation. The one genuinely new architectural surface is the **Pages module**,
which is ordinary CRUD by deliberate decision (ADR-014), not event-sourced —
exactly the boundary ADR-003 scoped for.

## 2. Decision log (all explicitly made by Mitchell, 2026-07-20)

| # | Decision | Alternatives rejected |
|---|---|---|
| 1 | **Macros are typed nodes, not text interpolation.** A macro is a custom TipTap node `{ name, params }`; `{{…}}` is the *authoring gesture* (autocomplete inserts a node), never stored resolved text. Resolution happens at render → data is always live | store `{{cost.trip}}` as literal text + regex-replace at render (can't carry params, can't be a selectable/configurable object, dies at the path to interactive C-era components) |
| 2 | **Scope B, built C-compatible.** v1 = inline scalars + block embeds rendering read-only components from resolver *payloads* (structured data, not markup). Upgrading a block to a live interactive lens later is a **renderer swap** — document format, registry, and resolvers untouched | A (inline scalars only — can't express "full trip overview"); C now (full interactive component embedding — M11 territory, over-scoped) |
| 3 | **A macro registry is the single source of truth.** One declarative table: `name`, `kind` (`inline`\|`block`), Zod `params` schema, `description`, `emptyText`, and a pure `resolver`. It drives autocomplete, renderers, **and** the AI tool vocabulary — three consumers, one table, no drift | per-consumer macro lists (autocomplete vs. AI vs. renderers drift apart — the exact duplication Invariant 5 forbids) |
| 4 | **Resolvers are pure `(TripDetail, PageContext, params) → Result`, over the projection only.** Never throw, never return raw `null`. `Result = ok(value) \| empty \| unbound` | resolvers that fetch / read the Pages module / touch I/O (breaks the purity discipline; couples integration to storage) |
| 5 | **Three-state resolution result.** `ok` → render value; `empty` → valid path, no data yet → declarative placeholder chip (registry `emptyText`); `unbound` → macro needs context the page lacks (e.g. `{{cost.day}}` on an unbound page) → actionable "select a day" chip that doubles as the binding affordance | throw/`null` on missing data (a fresh trip's default pages would error instead of rendering as a legible skeleton) |
| 6 | **Pages are a CRUD module, not event-sourced (ADR-014).** New `pages` table; content = TipTap/ProseMirror JSON; editor-local undo via ProseMirror history. References trips by ID only; knows nothing of planning internals | event-source page edits (prose doesn't decompose into domain commands; snapshot-events make the M2 history UI meaningless and bloat the log; concurrent text on an OCC stream degenerates to last-writer-wins — the ADR-003 "half-evented" boundary smell) |
| 7 | **Content is Yjs-ready; single-player now, no CRDT plumbing yet.** TipTap's collaboration layer is natively Yjs; ProseMirror-JSON ↔ Y.Doc is mechanical. The M8/M11 migration converts stored docs once and rides M8's realtime transport ADR | Yjs from day one (carries CRDT plumbing through a single-player milestone for zero current benefit; pre-empts M8's transport ADR — YAGNI) |
| 8 | **Notes live outside time-travel (ADR-014 consequence).** Revert-to-state rewinds the *plan*, not the *prose* — deliberately. Macros soften this: a reverted page's dynamic parts auto-update (resolved live), only hand-written prose is outside history and gets its own (later collaborative) undo | forcing pages into the history substrate to gain revert (reverting a schedule should not delete written paragraphs; and see #6) |
| 9 | **Copy-on-create templates, lazily instantiated.** Templates are code-defined seed documents beside the registry. On **first visit** to a trip's Notebook, defaults are instantiated into ordinary page rows — no backfill migration for existing trips/fixtures. Later template edits don't touch existing pages | linked instantiation w/ propagation/sync (three-way doc merge + conflict UX — M9-adjacent fork machinery, wrong milestone); eager backfill migration (needs a data migration for every existing trip) |
| 10 | **Two default templates: Trip Overview + Day Sheet.** Trip Overview = name, dates, cost total, per-day itinerary blocks. Day Sheet = context-bound to a day (date, that day's itinerary block, day cost). Two is enough to prove the system; more is content, not architecture | one template (doesn't exercise context binding); many (content, not validation) |
| 11 | **Notebook = the Pages tab itself**, a plain per-trip UI surface (list: title, context binding, last edited; create/rename/delete). Not itself a macro-page in v1 | a `pages.list` macro-page (its resolver would read the Pages module, breaking the "resolvers are pure over the projection" rule for zero user-visible gain — noted as a C-era upgrade once resolvers learn multiple sources) |
| 12 | **AI does both page-authoring and plan-editing, constrained to a typed, schema-derived tool surface (ADR-015).** Two tool families, both *derived, never hand-written*: **planning tools ← `@tc/contracts` command schemas** (executed as an M6 atomic batch through the standard pipeline); **page tools ← the macro registry** (macro vocabulary is a registry-generated enum). A typed **context envelope** (surface + summarized projection + surface-relevant tools only) bounds hallucination and token usage | free-form AI prompting (hallucinated tools, unbounded context/tokens); hand-written tool defs (duplicates schemas — violates Invariant 5); pages-only AI (drops the original "AI emits commands" intent) |

## 3. Data ⟷ Integration ⟷ UI (the three layers)

The separation Mitchell called for maps onto existing seams:

```
DATA          TripDetail projection (event-sourced, M1–M6). Unchanged by M7.
              Pages module rows (CRUD, new). Content = TipTap JSON.
                                   │  read-only ▲ (never writes planning data)
INTEGRATION   Macro registry: name → { kind, params(Zod), description,
              emptyText, resolver:(TripDetail, PageContext, params) → Result }.
              Pure. The single source of truth consumed by three surfaces.
                                   │
UI            TipTap editor (authoring: {{ autocomplete → typed node).
              Renderers keyed by macro name (inline chip / block component)
              consuming resolver *payloads*, not markup. ← C-era swap point.
              Notebook (Pages tab). AI compose panel.
```

Why this survives the jump to C: the **renderer is the only layer that changes**
when a block macro graduates from a static read-only list to a live interactive
lens. `itinerary.day`'s resolver already returns the day's structured activity
data; today a dumb `<ul>` renders it, tomorrow the real timeline lens component
renders the same payload. The document format, the registry entry, the AI tool
enum, and the resolver are all untouched. That is the "sets us up for C without a
massive rewrite" property, stated precisely.

## 4. The macro registry (integration layer)

One entry per macro. Illustrative shape (final names/params fixed in the plan):

```ts
type MacroKind = "inline" | "block";
type Result<T> =
  | { status: "ok"; value: T }
  | { status: "empty" }                    // valid path, no data yet
  | { status: "unbound"; needs: "day" };   // page lacks required context

interface MacroDef<P, T> {
  name: string;                 // "cost.trip", "itinerary.day"
  kind: MacroKind;
  params: z.ZodType<P>;         // block macros: optional day ref, falls back to page context
  description: string;          // human- AND machine-readable (feeds AI + autocomplete)
  emptyText: string;            // declarative empty-state copy
  resolve(detail: TripDetail, ctx: PageContext, params: P): Result<T>;
}
```

- **`PageContext`** carries the page's binding — `{ tripId, dayRef?: DayRef }`.
  Trip Overview binds trip-only; Day Sheet binds a day. A block macro that needs
  a day and finds none in params *or* context resolves `unbound`.
- **Starter vocabulary (~4 inline + ~3 block).** Inline: `trip.name`,
  `trip.dates`, `cost.trip`, `cost.day`. Block: `itinerary.day` (a day's
  activities), `itinerary.trip` (all days), `costs.table` (cost breakdown). Exact
  set finalized in the plan; the registry makes adding one a single entry.
- **No nesting, no macro-in-param.** A macro param is a scalar/ref, never another
  macro. Deliberate v1 simplification (accepted debt §9).

## 5. Empty / unbound semantics (decision 5, expanded)

The likely-real cases, and what renders:

| Situation | Result | Inline renders | Block renders |
|---|---|---|---|
| `{{cost.trip}}`, costs entered | `ok` | the value | — |
| `{{cost.trip}}`, no costs yet | `empty` | "— no costs yet" chip | — |
| `{{itinerary.day}}`, empty day | `empty` | — | "No activities on this day yet" row |
| `{{cost.day}}` on a trip-bound page | `unbound` | "⚠ select a day" chip | "⚠ select a day" block |
| trip doesn't exist | n/a | route-level 404 / error boundary (pages are rows under a trip) | — |

The property that matters: **a template instantiated into a brand-new empty trip
renders as a fully legible skeleton**, every macro showing its empty state — the
page shows you what it *will* become. Empty is a feature, not a failure.

## 6. Pages module & storage (ADR-014)

- **Module map placement:** a new **Pages** module — owns pages (+ default-
  template instantiation), CRUD + audit fields (`created_at`, `updated_at`,
  `actor_id` — Invariant 6a), references trips by ID only, knows nothing of
  planning internals. Consumes `TripDetail` read-only via the registry.
- **Table (illustrative):** `pages(id, trip_id, title, context jsonb, content
  jsonb, created_at, updated_at, actor_id)`. `context` = the `PageContext`
  binding; `content` = TipTap JSON.
- **Not event-sourced, by decision.** Server-side, page CRUD is ordinary route
  handlers under `apps/web/src/server`, *not* the command pipeline. This is the
  ADR-003 scope line, held deliberately.
- **Yjs-ready.** Content is ProseMirror-shaped so the M8/M11 CRDT migration is a
  one-time per-doc conversion, not a rewrite (decision 7).

## 7. AI generation (ADR-015)

- **Gateway:** all model calls route through **Vercel AI Gateway** — provider-
  agnostic model string, spend caps + usage in one place, cheap-vs-capable A/B
  per tool family. Deployed on Vercel already; one credential. Own ADR.
- **Two derived tool families:**
  1. **Planning tools ← command schemas.** Each `@tc/contracts` command Zod
     schema *is* a tool (the Vercel AI SDK takes Zod natively). The model's edits
     are emitted as **one M6 atomic batch** through the standard pipeline → one
     history entry ("AI: added 3 activities"), one undo, server-validated like any
     human command. Layered defense: schema-constrained decoding stops most
     hallucination at generation; the pipeline rejects anything that slips
     through. **The model can do nothing a user couldn't.**
  2. **Page tools ← the macro registry.** `insert_block` / `compose_page` whose
     macro vocabulary is a registry-generated enum + param schemas. Unknown macro
     → fails schema validation before touching a document.
- **Typed context envelope, not a transcript dump.** Each request carries a
  schema-defined context: *where* the user is (trip / page / day binding), a
  **summarized** projection (day list w/ dates + activity names + cost totals —
  not full `TripDetail`), and only the **surface-relevant** tool family (page
  tools on a page, planning tools on the board, both in a combined flow). Small
  closed action space + small context = a cheaper model suffices — the point of
  the constraint.
- **Validation before insert.** Page output is validated against the registry;
  unknown macro / bad params → rejected or downgraded to plain text, never a
  broken node.

## 8. What each build decision is validated by (why this milestone has enough meat)

| Bet | Validated in-scope by |
|---|---|
| Typed macro nodes (not text) | Editor round-trip: `{{` insert → save → reload → live resolve |
| Registry as single source of truth | One table driving autocomplete + renderers + AI enums (three consumers) |
| Block embeds → C without rewrite | `itinerary.day` block rendering from a resolver payload — the swap seam exists the moment it works |
| CRUD Pages module / Yjs-ready (ADR-014) | Pages persisting alongside time-travel: revert a trip → macros update, prose persists |
| Empty / unbound semantics | Fresh trip's defaults render as legible skeletons; unbound day-macro chip |
| Copy-on-create templates | Lazy instantiation of Trip Overview + Day Sheet on first Notebook visit |
| Context binding | Point a Day Sheet at a day → it populates |
| AI constrained to derived schemas | Both tool families working with a **small** model — proves the closed-action-space thesis |
| Gateway + atomic batches as AI substrate | One prompt → one batch → one history entry → one undo |

Trip templates (dropped to M9) would validate only clone-with-lineage — M9's
bet, built on fork machinery that doesn't exist yet. Its removal makes the
milestone more honest, not thinner. The phase gate ("Mitchell plans a real trip
and needs no other tool") needs page reuse only on the *second* trip — Phase 3.

## 9. Deliberate, non-trapping tech debt (accepted)

- **Static read-only renderers** in M7 (no interactivity) — the C-era upgrade is
  a renderer swap (§3), not a rewrite.
- **Small vocabulary** (~4 inline + ~3 block) — adding a macro is one registry
  entry.
- **No macro nesting / no macro-in-param** (§4).
- **Client-side resolution** against the already-fetched `TripDetail` — server-
  side resolution (for exports / AI) is additive later precisely because
  resolvers are pure.
- **Notebook not itself a macro-page** — a `pages.list` block macro is a C-era
  add once resolvers learn multiple sources (decision 11).

None of these block C or multiplayer; each is a local, additive extension point.

## 10. Explicitly out of scope (this milestone)

- **Community-object / external embeds** — the *original* M11 "embeds" (Notion-
  style embedded community objects). M7's embeds are strictly data macros over
  the trip's own projection.
- **Trip templates (reusable trip structures)** — moved to M9 (clone-with-
  lineage).
- **Interactive lens components inside pages** (map/calendar/timeline as live
  blocks) — C-era; the renderer seam is prepared, the components aren't wired.
- **Real-time collaborative editing / CRDT plumbing** — M8/M11; content is
  Yjs-*ready*, not Yjs-*backed*.
- **Export / print / PDF / share links** — unchanged from M4's deferral.
- **User-defined templates** — v1 templates are code-defined seeds.

## 11. Non-negotiables carried from AGENTS.md

- Pages read the projection; **never** write planning data. Event log stays the
  sole source of truth for planning (Invariant 1).
- Resolvers pure; the macro/AI integration layer performs no I/O of its own
  beyond the Pages-module CRUD it owns (Invariant 4 discipline, extended to
  integration).
- AI tools + macro vocab are **derived** from `@tc/contracts` / the registry —
  no hand-written duplicate schemas (Invariant 5).
- Every event AI emits carries `actor_id`; the AI actor is a real actor id; pages
  carry `actor_id`; no "the user" singletons (Invariant 6).
- New ADRs (014, 015) recorded before acting on them; contract changes get a
  changelog entry + all consumers in the same PR.
- The DoD holds: unit tests for resolvers + registry; contract/integration tests
  for the Pages endpoints + AI batch path; the M7 e2e script extends the chain;
  projection-rebuild golden test still green (unaffected — pages aren't evented).
