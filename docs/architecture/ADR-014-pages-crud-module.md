# ADR-014: Pages as a CRUD module, content Yjs-ready

**Status:** Accepted — 2026-07-20
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-07-20-M7-solo-delight-design.md`

## Context

M7 introduces trip pages: rich-text documents embedded in trip detail view that
can reference live data via macros (budget summaries, itinerary segments, etc.).
The architecture question is whether page content mutations should be modeled as
domain commands (event-sourced as planning changes) or as independent CRUD
operations outside the trip history pipeline.

## Decision

1. **Pages are a CRUD module, not event-sourced.**
   Pages follow the ADR-003 scope precedent: CRUD operations (create, read,
   update, delete) live outside the trip command pipeline. A `pages` table holds
   page metadata (id, trip_id, title, created_at, updated_at); a `pages.content`
   jsonb column stores the rich-text document in ProseMirror/TipTap JSON format.
   Page mutations do not emit domain commands and do not appear in trip history.

2. **Pages read trip data via pure macro resolvers, never write planning state.**
   Macros embedded in page content (e.g., `[!budget]`, `[!itinerary days:1-3]`)
   resolve at render time by querying the current `TripDetail` snapshot. Macros
   never dispatch commands; they are read-only views. This decoupling preserves
   the planning domain's integrity: changes to page prose cannot corrupt the plan.

3. **Content format is Yjs-ready (ProseMirror-shaped, no CRDT now).**
   ProseMirror JSON is a tree of blocks and marks that natively maps to
   `Y.XmlFragment` under a CRDT migration (planned for M8/M11). By storing
   content in this format now, the M8/M11 transition from OCC to Yjs becomes a
   one-time per-document `Y.Doc` conversion: deserialize the existing ProseMirror
   JSON into a Yjs doc, keeping the schema and resolver logic unchanged. No CRDT
   plumbing, collaboration framing, or sync machinery is added in M7.

## Consequences

- **Pages live outside time-travel.** Reverting to a historical trip state
  rewinds the plan (commands, itinerary, budget) but does not restore previous
  page prose. Hand-written content is only undoable within the editor session
  (local or collaborative undo, once Yjs is live in M8). Macros in a reverted
  page auto-update because they resolve against the reverted trip state in real
  time.

- **Content mutation endpoints (POST/PUT/DELETE `/pages/:id`) are separate from
  `/api/trips/:id/commands/*`.** Page updates do not pass through the batch
  queue, sequencer, or optimistic predictor. Each page mutation is immediately
  reflected to all connected clients via a dedicated sync mechanism (real-time
  transport or polling); rollback on conflict is a local editor concern, handled
  by the page editor UI, not the history system.

- **Schema migration path is clear.** If page content schema changes (e.g., new
  macro syntax, new block types), migrations are data migrations, not
  history-rewriting events. This aligns with the `pages` table being a document
  store, not an append-only log.

## Alternatives rejected

1. **Event-sourcing page edits as domain commands.**
   Prose text does not decompose into a finite set of domain commands; each
   keystroke or paste would generate a low-level text command, flooding history
   and making the history UI unintelligible. Snapshot-on-save events would turn
   every page edit into a bulk replace, making the M2 history UI meaningless
   (no insight into intent, only before/after prose dumps). Concurrent text
   edits on an OCC stream degenerate to last-writer-wins, losing concurrent
   contributions — exactly the problem Yjs will solve, but not yet in M7.

2. **Storing page content as a separate event stream.**
   A dedicated page-history log (separate from trip history) adds operational
   complexity and querying surface without gaining semantics: pages still would
   not be undoable from the trip history UI, and the two logs would diverge in
   sync guarantees and replication. Simpler to model pages as a pure CRUD
   resource and unify undo via Yjs in M8.

3. **Macros resolve by reading historical snapshots of trip state.**
   Resolving macros against the reverted state (not a historical snapshot)
   preserves interactivity: changing the plan instantly updates embedded
   summaries without requiring a full page re-render or manual refresh. If
   macros resolved to historical snapshots, reverting the plan would leave
   outdated macro values frozen in the page, breaking the illusion of a
   live-updating dashboard.
