# Adapter — travel-collab

The repo-specific half of the protocol. Porting the protocol elsewhere means
rewriting this file and `adapter.json`, and nothing else.

## Binding law

`AGENTS.md` is binding and outranks this file. Read, in particular: the
Invariants, the module map, the architecture dependency rules, and the
Definition of Done. If an invariant blocks your unit, that is a finding to
report — never a rule to bend.

## Exclusive resources

The hook-enforced ones are declared machine-readably in `adapter.json`, which
the lease hook reads. A row marked otherwise below is yours to observe.

| Resource | Why exclusive |
|---|---|
| `postgres` | One docker-compose instance. `pnpm --filter web test:int` runs the whole suite and cannot be scoped file-by-file, so two units running it concurrently corrupt each other's results — the symptom is a *different random subset* failing each run, which reads as flakiness and burns hours. |
| `dev-server` | Fixed ports. A second `pnpm dev` either fails to bind or silently serves the wrong worktree. |
| `ci-minutes` | **Human-observed policy, not a hook-enforced lease** — `adapter.json` declares no pattern for it, so no hook will stop a second unit; you have to hold this one yourself. This repo is private on a GitHub Free plan; a measured 30-day sample burned 1,956 of 2,000 minutes, 71% on pull-request runs. Open PRs as drafts and mark ready only when you believe they are green. See `docs/guidelines/ci-cost-and-capacity.md`. |

## Acceptance-check catalogue

- **Narrowest sufficient subset:** use the `minimal-check-subset` skill.
- **Contracts exception:** if any changed file is under
  `packages/contracts/src`, do not narrow — run the full `pnpm check`.
  A contracts change silently breaks domain and web even though their own
  files did not change (AGENTS.md invariant 5).
- **E2E:** a result counts only from `pnpm --filter web test:e2e:ci-like`.
  Plain `test:e2e` serves `pnpm dev`, which compiles routes on first hit and
  produces timeouts CI does not have. The dev lane is for iterating on a
  spec you are writing — never for a verdict or a PR checkbox.
- **Integration:** `pnpm --filter web test:int` claims the `postgres`
  resource. It is whole-suite by design.

## Environment probe

Run these before concluding that anything is environmental, flaky, or
infrastructural — and **grep `docs/known-issues/` for the symptom first.**
Both times the dev-lane trap was hit here, the entry describing it (KI-27)
already existed and went unread; the second time cost a day and still
reached the wrong answer.

```bash
grep -rin "<your symptom>" docs/known-issues/
docker ps
ps aux | grep -E 'node|vitest|playwright' | grep -v grep
pg_isready -h localhost -p 5433
```

Useful discriminator: **a failure whose location moves between runs is a
timeout; a real defect fails in the same place every time.**

## Promotion destinations

At teardown, every board entry is promoted or explicitly discarded:

| Kind of fact | Goes to |
|---|---|
| Known-broken behaviour, with a reproduction | a new file in `docs/known-issues/open/` |
| An irreversible decision and its rationale | `docs/architecture/` (a new ADR) |
| A durable tooling or repo fact | this file, or `adapter.json` |
| True only for this run | discarded, with a one-line reason |

## Cleanup targets

Worktrees under `.claude/worktrees/`; `.claude/launch.json` entries
(`scripts/sync-launch-config.mjs` regenerates it); local and remote
`claude/*` branches; stray containers and held ports. `/cleanup-orphans`
already covers the first three and reports before deleting anything —
prefer it to hand-rolling teardown.
