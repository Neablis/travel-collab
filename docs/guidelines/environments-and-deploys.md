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
  automatically) — see `apps/web/scripts/db-seed.ts`.

## Feature flags

The project's first flag is `ai-live` (declared in
`apps/web/src/server/flags.ts`), gating whether `/api/trips/:id/ai` calls a
real model or returns a simulated plan. See ADR-019 for the mechanism and
why the kill switch is built as a model swap rather than a branch.

| Environment | Where the value lives |
|---|---|
| Local / CI | `AI_LIVE` in `.env.local` / the CI env — `false` by default, checked by `aiLive()` (`apps/web/src/server/ai/modelSelection.ts`) before the flag is ever consulted. **Never set this in a Vercel environment** (see below). |
| Preview | The `ai-live` flag's value in the Vercel dashboard, optionally overridden per session via the Flags Explorer (below). |
| Production | The `ai-live` flag's value in the Vercel dashboard. Keep this `false` until the app is deliberately shared with live AI enabled. |

**Flipping `ai-live`:**

```
vercel flags set ai-live --environment production --variant true
```

or the equivalent toggle on the project's Flags page in the Vercel
dashboard. Either writes the same value `vercelAdapter()` reads at request
time — no deploy needed.

**Per-session overrides on preview deploys:** the Vercel Toolbar's Flags
Explorer talks to the discovery endpoint at
`apps/web/src/app/.well-known/vercel/flags/route.ts`, authenticated by the
`FLAGS_SECRET` environment variable. With `FLAGS_SECRET` set in a Preview
(and Production) environment, opening the Toolbar on a preview deploy lets a
reviewer flip `ai-live` to "Live" for their own browser session only — the
dashboard's stored value, and every other visitor's requests, are
unaffected. With `FLAGS_SECRET` unset (e.g. local dev), a bare unauthenticated
probe 401s; a request carrying an `Authorization` header with no
`FLAGS_SECRET` configured 500s instead (see the route file's comment) —
either way there's no Toolbar to serve locally, so that's expected, not a bug.

`FLAGS_SECRET` is itself a spend-control credential on this deployment, not
just an auth token for the discovery endpoint: anyone holding it can override
`ai-live` to "Live" for their own session via the Flags Explorer toolbar
cookie, which does spend real tokens. Handle it with the same care as
`AI_GATEWAY_API_KEY`.

**`AI_LIVE` must never be set in a Vercel environment.** It's a local/CI-only
escape hatch inside `aiLive()` that short-circuits the flag entirely before
the adapter is ever asked. On Vercel this variable must stay unset so the
`ai-live` flag remains the sole source of truth — setting it there would
make the dashboard and Toolbar controls silently inert.

## Debug-only routes

`POST /api/dev/reset-demo-data` (`apps/web/src/app/api/dev/reset-demo-data/route.ts`)
wipes the signed-in caller's own trips and reseeds the 14-day/68-stop Japan
demo trip, for reproducing UI bugs against rich data without a terminal.
Gated by `isDemoDataResetEnabled()` (`apps/web/src/lib/demoDataReset.ts`)
requiring **both** `VERCEL_ENV=preview` and `SEED_DEMO_DATA=true` —
`VERCEL_ENV` is set by Vercel itself, never by us, so **production can never
satisfy this regardless of `SEED_DEMO_DATA`**. Either condition failing
404s the route (not 403), so its existence isn't advertised. Set
`SEED_DEMO_DATA=true` in a Preview environment (Vercel dashboard, Preview
scope) to enable it there; leave it unset everywhere else, including local
`.env.local`, since it has no effect outside Preview.
