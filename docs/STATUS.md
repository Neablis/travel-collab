# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-07-27**

## Where we are

**M0–M7 are all complete and merged.** M7 (Solo delight) landed on `main` via
PR #15 on 2026-07-26 (merge commit `4093b59`).

**Phase 1's gate has NOT been met.** Every milestone is ticked, but the gate is
"Mitchell plans a real trip end-to-end and needs no other tool," and he can't
yet. That is the gate working, not a bookkeeping slip. The next roadmap item is
the Phase 1 gate review, not M8.

## In flight

Nothing is mid-implementation. No open branches carrying unmerged code.

## Blocking / broken right now

**Nothing.** `main` went fully green for the first time on 2026-07-28 — all four
CI jobs including `migrate-production`, which applied migration `0003` (the
`pages` table) to production after the `PRODUCTION_DATABASE_URL` secret was set.
The M7 Notebook should now work on the deployed app; it had been failing there
since M7 merged.

Cleared on 2026-07-27/28: the production migration blocker (open since
2026-07-13); **KI-1**, `diffTripStates` silently dropping day order — a real
correctness bug, not the flake it had been filed as for two weeks; the
`evolveTrip` replay-totality hole; **KI-14**, dismissed conflicts suppressing a
re-created problem forever; and M7's stranded post-gate retro plus KI-11/12/13,
which existed only on a branch.

## Next action

**Phase 1 gate review with Mitchell** — plan a real trip end-to-end and see
whether the product needs no other tool. Nothing blocks it now. The known gaps
most likely to bite during that exercise are **KI-12** (no `SetTripName`
command exists at all, so an AI-planned trip stays "New TRip" with null dates)
and the general first-run/usability weaknesses recorded in the 2026-07-27 audit.

## Local dev recipe (the bits that get re-derived every time)

Each checkout has its own docker-compose Postgres — **run `docker ps` before
concluding a database is unavailable; it almost certainly already exists.**

```bash
docker compose up -d                  # travel-collab-postgres-1 → localhost:5433
CI=true pnpm install                  # plain `pnpm install` aborts in a non-TTY shell
pnpm --filter web db:migrate
```

`apps/web/.env.local` is gitignored and per-checkout; it needs
`DATABASE_URL=postgres://postgres:postgres@localhost:5433/travel`.

Integration tests: **`vitest` does not read `.env.local`** (unlike `db:migrate`,
which uses `node --env-file-if-exists`). Note the two configs are asymmetric —
the *default* `vitest.config.ts` is the integration suite (`test:int` is plain
`vitest run`); unit tests need `-c vitest.unit.config.ts`. From `apps/web`:

```bash
set -a && . ./.env.local && set +a && pnpm exec vitest run
```

**`pnpm check` is not reliably green on a loaded machine** (KI-13) — the jsdom
component tests time out under CPU contention and a different set fails each
run. Re-run a suspect file alone before believing a failure, and prefer running
`pnpm typecheck`, `pnpm lint`, and the test suites separately over trusting one
`pnpm check` exit code.
