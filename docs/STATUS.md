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

1. **`main` is red.** The `migrate-production` CI job fails — the
   `PRODUCTION_DATABASE_URL` repo secret is unset (first flagged 2026-07-13).
   Code lanes (static, unit, integration+e2e) are green.
2. **Production is missing migration `0003_worried_lightspeed.sql`** (the
   `pages` table), because of (1). The M7 Notebook feature is expected to fail
   in production until it is applied. Manual unblock:
   `DATABASE_URL='<neon-direct-url>' pnpm --filter web db:migrate` — use the
   unpooled `neon.tech` host, not `-pooler`.
Recently resolved, no longer blocking: **KI-1** (`diffTripStates` dropped day
order — a real correctness bug, not the flake it was filed as), the
`evolveTrip` replay-totality hole, the stranded M7 post-gate retro plus
KI-11/12/13, and **KI-14** (dismissed conflicts are now occurrence-scoped and
lapse when the conflict stops being detected).

## Next action

Phase 1 gate review with Mitchell. Before it is worth running, at minimum items
1–3 above should be cleared.

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
