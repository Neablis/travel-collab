# travel-collab

Collaborative travel planning: plan vacations ("Epics") made of days and
activities, with an immutable change history (undo, revert, fork-with-lineage),
soft-conflict validation, and — in later phases — multi-user collaboration,
community sharing, rich trip pages, cost rollups, and AI generation.

**Status:** pre-M0, Phase 1 (full single-player product). Design and decision
records written; no application code yet.

## Layout

```
AGENTS.md              Operating manual — read first (module map, invariants, DoD)
TODO.md                High-level roadmap checklist — what to work on next
docs/specs/            Design specifications (foundation decision record)
docs/architecture/     ADRs (decision records)
docs/milestones/       Phase/milestone gates M0–M9 and exit checklists
docs/guidelines/       Agent how-to: build, connect, validate, quality, constraints
docs/contracts/        Contract change log
packages/contracts/    (M0) Zod schemas — the shared language between all layers
packages/domain/       (M0) Pure domain core: event-sourced planning, conflict engine
apps/web/              (M0) Next.js all-in-one app (UI + server behind a lint wall)
```

## Architecture in one paragraph

A modular monolith in a TypeScript monorepo, deployed as one Next.js app. The
**planning domain is event-sourced**: every trip change flows
`command → validate → append event → update projections`, projections are
disposable and rebuildable, and history/undo/fork fall out of the log.
Identity, access, and community metadata are ordinary CRUD — the substrate is
deliberately scoped (ADR-003). Conflicts (scheduling overlaps, broken date
anchors, concurrent edits) are first-class data the user resolves, never
blocking errors. See ADR-001/002/003.

## Roadmap

Phase 1: M0 walking skeleton → M1 planning core → M2 time travel → M3 place &
time → M4 money & lenses → M5 solo delight — gated by dogfooding a real trip.
Phase 2: M6 collaboration. Phase 3: M7 fork & lineage → M8 community → M9 rich
layer. Details: `docs/milestones/README.md`.

<!-- verifying vercel preview deployments -->
