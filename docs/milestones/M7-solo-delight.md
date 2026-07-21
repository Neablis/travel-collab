# M7 — Solo delight (dynamic pages, macros, templates, constrained AI)

**Status:** In progress — Wave 0 (design + plan complete)
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

- [ ] **Demo on the deployed Vercel URL:** open a trip's **Notebook** → the two
      default pages (**Trip Overview**, **Day Sheet**) exist. Open Trip Overview
      → trip name/dates/cost total + per-day itinerary blocks render live. Add a
      cost on the board → reopen the page → the total updates. Open a fresh empty
      trip's Notebook → default pages render as a legible skeleton (every macro
      shows its empty/unbound state). Point a Day Sheet at a day → its blocks
      populate. Type `{{` in the editor → autocomplete → insert `{{cost.trip}}`
      → it resolves. **Undo** a trip revert → macros update, prose persists.

- [ ] **AI demo:** on a page, prompt "make a one-page overview of this trip" →
      a valid page is composed (only registry macros, validated). On the board,
      prompt "add a museum visit on day 2" → one atomic batch → one history entry
      → one undo reverts it.

- [ ] **Tests:** `@tc/pages` unit tests (resolvers: ok/empty/unbound; registry
      validation), pages CRUD integration tests, the AI batch-path integration
      test, and the M7 e2e script all green; all prior milestones' e2e scripts
      still green; projection-rebuild golden test still green (unchanged).

- [ ] A retro note appended at gate close.
