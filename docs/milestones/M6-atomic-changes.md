# M6 — Atomic changes (+ optimistic updates)

**Status:** In progress
Design spec: `docs/superpowers/specs/2026-07-19-m6-atomic-changes-optimistic-updates-design.md`

## Scope

- Client/generator-declared command groups: a series of commands submitted as
  one all-or-nothing batch → one history entry, so undo/redo/revert treat it as
  a single change. Opt-in.
- Optimistic updates: a dispatched unit (single command or batch) applies to
  local trip state + history immediately, sends in the background via a
  sequential queue, and reconciles or rolls back on the server's response.
- Shared predictor via the curated `@tc/domain/predict` entrypoint (one decider,
  no drift). Server `seq` remains the sole ordering authority.
- ADR-013 records the decisions (amends ADR-012 invariant 1).

## Exit gate

- [ ] A batch of ≥2 commands appends exactly one history entry; undo/redo/revert
      treat it as a single change (integration test).
- [ ] A partially-invalid batch appends nothing (all-or-nothing; integration test).
- [ ] An optimistic edit renders before the network settles; a forced server
      failure rolls the edit (and anything queued behind it) back and surfaces an
      error (component + e2e tests).
- [ ] Predictor parity: for each command type, `predictCommand` yields the same
      `TripDetail` the server produces after real execution.
- [ ] `hydrate`/`project` round-trip property test green.
- [ ] Projection rebuild-equals-stored golden test still green.
- [ ] Lint wall: UI may import `@tc/domain/predict` only; bare `@tc/domain` still
      rejected.
- [ ] `pnpm check`, `pnpm --filter web test:int`, and the M0–M6 e2e scripts green.
- [ ] ADR-013 committed; contracts CHANGELOG updated.

## Retro

_(appended at gate close)_
