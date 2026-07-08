# Quality enforcement

## The testing pyramid (what every layer owes)

| Layer | Test kind | Bar |
|---|---|---|
| `packages/domain` | Vitest unit + fast-check property tests | Every `decide`/`evolve` branch; every conflict rule gets property tests; upcasters proven against old-version fixtures |
| `packages/contracts` | Schema round-trip tests | Parse/serialize fixtures; breaking-change detection by reviewing changelog |
| `apps/web/src/server` | Integration against real Postgres (docker-compose) | Every endpoint: happy path + rejection + authz denial; event-store suite (ordering, optimistic concurrency, rebuild) |
| `apps/web` UI | Component tests against MSW mocks | Critical interactions (drag, conflict surfaces, undo) |
| Whole system | Playwright e2e | One happy-path script per milestone, green forever after its gate |

## Golden tests (never allowed to fail, never allowed to be skipped)

1. **Projection rebuild:** drop read models, replay the full log, result must
   equal stored state. Runs in CI on every PR.
2. **Optimistic concurrency:** two appends at the same `(stream_id, seq)` —
   one wins, one returns a typed conflict.
3. **Replay totality:** a fixture log containing every event type at every
   historical version folds without error.
4. **Lint wall:** fixtures importing `@tc/domain` from UI code must fail CI.

## CI pipeline (every PR)

typecheck → lint (including boundary rules) → unit → integration (Postgres
service container) → e2e smoke → golden tests. All green or it doesn't merge.
`pnpm check` runs the same set locally — run it before claiming done.

## Definition of done (restated from AGENTS.md — the checklist)

- [ ] `pnpm check` green locally; CI green.
- [ ] New logic has tests at its layer per the pyramid above.
- [ ] Milestone e2e extended if a user flow changed.
- [ ] Contracts changelog entry if any schema changed; consumers updated in
      the same PR.
- [ ] No invariant weakened; blockers reported, not bent.
- [ ] Docs updated (ADR / milestone file / guidelines) if behavior or
      interfaces changed.
- [ ] Conventional commit(s), one logical change each.

## Code review expectations (agent-to-agent or self-review before Mitchell)

- Verify claims by running commands, not by reading code sympathetically.
- Check the diff against the drift signals in `validating-direction.md`.
- Prefer deleting code to adding it; match surrounding style; comments only
  for constraints code can't express.
- Reject "temporary" duplication of contract types on sight.
