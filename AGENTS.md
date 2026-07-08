# AGENTS.md — Operating Manual for travel-collab

This file is the contract between every agent (and human) working in this repo.
Read it fully before making changes. When instructions here conflict with an
ad-hoc request, surface the conflict instead of silently picking one.

## What we are building

A collaborative travel-planning platform: users plan vacations (an "Epic")
composed of days and activities, with an immutable change history (undo, revert,
fork-with-lineage), soft-conflict validation, and — in later phases —
multi-user collaboration, community sharing, rich trip pages, cost rollups, and
AI generation.

Think: Jira's planning + git's history + Notion's editing, for vacations.

**Current phase: 1 (full single-player product), current milestone: M0.**
Design record: `docs/specs/2026-07-07-foundation-design.md` · Decisions:
`docs/architecture/` · Roadmap: `TODO.md` + `docs/milestones/README.md` ·
How-to guides: `docs/guidelines/`

## Working agreement with Mitchell

Discuss before building. Design decisions, new structure, and scope changes are
presented with trade-offs and get explicit approval before files or code are
created. Challenge weak ideas directly; record decisions in ADRs after they are
made, not before.

## The module map (structural law)

Modules own their data and commands; they reference other modules by ID only.

| Module | Owns | Storage model | Explicitly does NOT know about |
|---|---|---|---|
| **Identity** | accounts, OAuth, sessions, profiles | CRUD + audit fields | trips, invites, anything travel |
| **Trip Planning** | trips, days, activities, itinerary structure | **event-sourced** | who's invited, sharing, votes |
| **Access & Membership** | invites, roles, revocation, share grants | CRUD + audit fields | what a trip contains |
| **History** | event log, replay, undo/revert, fork lineage | the substrate itself | domain semantics (stores/replays, never interprets) |
| **Conflict Engine** | validation rules, Conflict objects | pure functions | UI, storage |
| **Community** (Phase 3) | gallery, votes, reports | CRUD + audit fields | planning internals (consumes published snapshots) |

**The AccessPolicy seam:** Planning never contains invite/permission logic. It
asks an `AccessPolicy` interface "may this actor do this?". In Phase 1 the only
implementation is "actor is the owner." Phase 2 swaps the implementation, never
the callers.

## The Invariants (violating these is never a valid shortcut)

1. **The event log is the sole source of truth for the planning domain.**
   Every trip change is `command → validate → append event(s) → update
   projections`. No code path ever writes a planning projection table directly.
   This is deliberately **scoped** (ADR-003): Identity/Access/Community are
   ordinary CRUD. If a feature seems to need half its state evented and half
   not, that is a boundary smell — stop and escalate to Mitchell.
2. **Projections are disposable.** Every planning read model must be rebuildable
   from the log; a golden "rebuild equals stored" test guards this.
3. **Conflicts are data, not errors.** Scheduling overlaps, date-anchored events
   broken by a reschedule, and (later) concurrent-edit collisions are `Conflict`
   objects with severity and suggested resolutions. No blocking modal errors for
   plan-consistency problems.
4. **The domain core is pure.** `packages/domain` performs no I/O — no database,
   no HTTP, no wall-clock reads (time is passed in). Depends only on
   `packages/contracts`.
5. **Contracts change by protocol, not by drift.** Cross-boundary types live in
   `packages/contracts` (Zod schemas; types inferred, never hand-written twice).
   Contract changes require a `docs/contracts/CHANGELOG.md` entry and all
   consumers updated in the same PR.
6. **Single-player now, multi-persona always.** Three day-one rules keep Phase 2
   additive: (a) every event carries `actor_id`; (b) no "the user" singletons —
   a trip has a members list (of one), never an owner baked into queries;
   (c) all permission checks go through the AccessPolicy seam.

## Architecture map and dependency rules

```
packages/contracts   Zod schemas: commands, events, DTOs, Conflict. Depends on nothing.
packages/domain      Pure core: aggregates, command handlers, reducers, conflict
                     engine, projection functions. Depends on contracts only.
apps/web             Next.js all-in-one (UI + route handlers/server actions).
  src/server/**      The ONLY code that may import packages/domain. Owns the
                     event store (Postgres), auth, CRUD modules, command pipeline.
  everything else    UI. May import packages/contracts and the typed API client.
                     MUST NOT import packages/domain or src/server internals.
```

The UI/server lint wall is CI-enforced and is our escape hatch: if serverless
stops fitting (likely at Phase 2 realtime), `src/server` extracts into a
standalone service without touching domain or contracts (ADR-002).

## Workstreams (how agents divide the work)

Agents work per-boundary and meet at `packages/contracts`:

- **Domain agent** — aggregates, reducers, conflict engine. Pure, exhaustively
  unit-tested functions.
- **Server agent** — event store, command pipeline, auth, CRUD modules,
  projections in `apps/web/src/server`. Integration-tested against real Postgres.
- **UI agent** — pages/components against the typed client with MSW mocks
  generated from contracts; features work against mocks before the server exists.

Rule: a contract change (schema + changelog + all consumers) is its own reviewed
step before dependent feature work continues.

## Definition of Done (every change)

- Typecheck, lint, and all tests pass locally (`pnpm check` once M0 lands).
- New domain logic has unit tests; new endpoints have contract + integration
  tests; new user flows extend the milestone e2e script.
- The projection-rebuild golden test still passes if events or reducers changed.
- No invariant weakened. If one blocked you, that is a finding to report to
  Mitchell, not a rule to bend.
- Docs updated when behavior or interfaces changed (ADR for irreversible
  decisions, changelog for contracts).

## Milestone discipline and drift detection

Work proceeds through the gates in `docs/milestones/README.md`. Do not build
ahead of the current milestone. Signals of drift — call these out immediately:

- A feature "needs" direct writes bypassing the command pipeline.
- Projection rebuild diverges from stored state.
- Hand-written types duplicating contract schemas.
- UI importing domain, or server logic leaking into components.
- Invite/permission logic appearing inside Trip Planning (AccessPolicy bypass).
- Event-sourcing creeping into CRUD modules, or CRUD shortcuts creeping into
  the planning domain (the ADR-003 boundary smell).
- Scope creep past the current milestone's gate definition.

## Testing model

- **Unit** (`packages/domain`): fast, exhaustive; property-based tests
  (fast-check) for reducers and the conflict engine.
- **Contract**: every endpoint validated against its Zod schema; UI developed
  against MSW mocks from the same schemas.
- **Integration** (`apps/web/src/server`): real Postgres via docker-compose;
  event-store guarantees (ordering, optimistic concurrency, rebuild) have a
  dedicated suite.
- **E2E** (Playwright): one happy-path script per milestone, kept green forever
  after its gate.

## Conventions

- TypeScript strict everywhere; pnpm workspaces monorepo.
- Package imports via workspace aliases (`@tc/contracts`, `@tc/domain`).
- Never commit secrets; local config in `.env.local` (gitignored).
- Commits: conventional style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`),
  scoped to one logical change.
