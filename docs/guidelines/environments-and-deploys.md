# Environments and deploys

## New worktree / first run

`pnpm setup` copies `.env.example` to `apps/web/.env.local` (never
overwrites an existing one — safe to run any time). Fill in
`LOCATIONIQ_API_KEY` if you need geocoding locally; the rest already default
to docker-compose's Postgres. Every command below that touches a database or
starts the app reads this file — `pnpm dev` and `pnpm test:e2e` load it
automatically, `db:*` and drizzle-kit scripts do via
`--env-file-if-exists=.env.local`. You should not need to `export` env vars
by hand for any of them.

Running more than one worktree's dev server at once: each needs its own
port. `WEB_PORT=3010 pnpm --filter web dev` (or set `WEB_PORT` in that
worktree's `.env.local`) — see `.env.example`'s port-override section.

| Environment | App | Database | DATABASE_URL source |
|---|---|---|---|
| Local | `pnpm dev` (port 3001) | Docker Postgres (port 5433) | `apps/web/src/server/config.ts` default / `.env.local` |
| CI | GitHub Actions | PG service container | `ci.yml` workflow env |
| Preview | Vercel preview deploys | **Neon branch `preview`** (pooled) | Vercel env, Preview scope |
| Production | Vercel production | Neon `main` (pooled) | Vercel env, Production scope |

Rules (ADR-004 + M1 retro):
- Preview and Production `DATABASE_URL` are **never** the same value.
- Migrations are applied by automation only (see below), never `drizzle-kit migrate`
  run by hand against a remote database.
- Production migrations: the `migrate-production` job in `.github/workflows/ci.yml`
  runs on `push: main` after the `checks` job passes, using the
  `PRODUCTION_DATABASE_URL` repo secret (the UNPOOLED/direct connection string —
  DDL should not run through PgBouncer).
- Preview migrations: `apps/web/scripts/vercel-build-migrate.mjs` runs
  `drizzle-kit migrate` during the Vercel build only when `VERCEL_ENV=preview`,
  against the preview branch. Safe because previews are disposable (Task 0c).
- Resetting the preview branch (or local db):
  `DATABASE_URL=<preview pooled url> pnpm --filter web db:reset`
  — see the header of `apps/web/scripts/db-reset.mjs`. For local dev, `pnpm
  --filter web db:reseed` wipes and refills with realistic data in one shot
  (`db:reset --yes` + `db:seed`, `.env.local`'s `DATABASE_URL` picked up
  automatically) — see `apps/web/scripts/db-seed.mjs`.
