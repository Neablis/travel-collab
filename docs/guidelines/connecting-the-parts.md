# Connecting the parts

## Dependency rules (lint-enforced; direction never reverses)

```
packages/contracts  ←  packages/domain  ←  apps/web/src/server
packages/contracts  ←  apps/web (UI)  — via the typed API client only
```

- Modules reference each other **by ID only**. Access & Membership knows trip
  IDs, never trip contents. Trip Planning never reads invite tables — it asks
  the `AccessPolicy` interface.
- History is a substrate, not a peer: Planning emits events into it; nothing
  reaches back from History into domain logic.
- Scoped substrate boundary (ADR-003): planning state is event-sourced;
  Identity/Access/Community metadata are CRUD. A feature needing half its
  state on each side is a boundary smell — escalate, don't hack.

## How data flows

- **Writes:** UI → typed client → route handler → command pipeline (see
  building-the-parts) → events + projections + conflicts → typed response.
- **Reads:** UI → typed client → route handler → projection query. Handlers
  never fold events at read time (except history/time-travel endpoints, whose
  whole job is replay).
- **Cross-module composition happens in the server layer** (e.g. "trips this
  user can access" = Access query for trip IDs + Planning query for
  summaries). Modules stay ignorant of each other; the composing handler is
  the only place that knows both exist.

## Changing a contract (the protocol)

1. Change the schema in `packages/contracts`.
2. Add an entry to `docs/contracts/CHANGELOG.md` (what/why/consumers/breaking).
3. Update **all** consumers in the same PR — typecheck must pass repo-wide.
4. If the change touches a persisted **event**: bump the event `version`, keep
   the old schema, add an upcaster, and prove replay with a test that folds a
   fixture of old-version events.
5. Contract changes ship as their own commit/PR *before* the feature that
   needs them. Agents working in parallel sync at contracts — this ordering is
   what prevents collisions.
6. If the change touches a command (new/renamed/retyped field): run
   `pnpm --filter web db:seed` against a local dev server. It POSTs real
   command payloads through the real API, so it fails loudly on exactly this
   kind of drift — cheaper than finding out a command silently stopped
   validating the next time someone tries to seed local data. See
   `apps/web/scripts/db-seed.ts`'s header for what it does and doesn't catch.

## Parallel agent workstreams

- Domain, server, and UI agents may work concurrently **only after** the
  contract change for the feature has landed.
- UI works against MSW mocks generated from the contract; server works against
  contract-driven integration tests; they meet without coordination.
- Never "temporarily" define a type locally to avoid waiting on contracts —
  that is the drift the whole structure exists to prevent.
