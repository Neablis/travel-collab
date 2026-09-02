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

**In a Claude Code web session there is no docker daemon, and you do not need
one.** `.claude/hooks/session-start.sh` starts a *native* Postgres 16 cluster
from the remote image's own binaries on the same port 5433 the compose file
publishes, creates the `travel` database, and runs `db:migrate` — about three
seconds, and the app's `DATABASE_URL` reaches it unchanged. `docker ps` will
show nothing; `pg_isready -h 127.0.0.1 -p 5433` is the check that means
anything there. Seeding is still yours to run, because it needs the dev server
up (see the reset/reseed bullet below). If the hook could not start it, it says
so on stderr and leaves `/tmp/postgres.log` and `/tmp/db-migrate.log` behind.

**`pnpm test:int` runs against that same database and will wipe your seeded
data.** `vitest.config.ts` loads `.env.local`, so the integration suite shares
`DATABASE_URL` with dev — and one of its specs
(`api/dev/reset-demo-data/route.int.test.ts`) drives the real reset handler,
which soft-deletes every trip its caller is a member of. Expect to re-run
`db:reseed` after `test:int`. Not a bug in the tests; a shared database is what
"integration test" means here. It only started biting once web sessions could
run the suite at all.

Running more than one worktree's dev server at once: each needs its own
port. `WEB_PORT=3010 pnpm --filter web dev` (or set `WEB_PORT` in that
worktree's `.env.local`) — see `.env.example`'s port-override section.

| Environment | App | Database | DATABASE_URL source |
|---|---|---|---|
| Local | `pnpm dev` (port 3001) | Docker Postgres (port 5433), or a native cluster on the same port in a web session | `apps/web/src/server/config.ts` default / `.env.local` |
| CI | GitHub Actions | PG service container | `ci.yml` workflow env |
| Preview | Vercel preview deploys | **Neon branch `preview`** (pooled) | Vercel env, Preview scope |
| Production | Vercel production | Neon `main` (pooled) | Vercel env, Production scope |

Rules (ADR-004 + M1 retro):
- Preview and Production `DATABASE_URL` are **never** the same value.
- Migrations are applied by automation only (see below), never `drizzle-kit migrate`
  run by hand against a remote database.
- Production migrations: **explicitly dispatched**, never automatic. Run the
  `migrate-production` workflow (`.github/workflows/migrate-production.yml`)
  from `main` — Actions → migrate-production → Run workflow, or
  `gh workflow run migrate-production.yml -f confirm=migrate`. It refuses any
  ref other than `refs/heads/main` and requires `migrate` typed into the confirm
  field. It uses the `PRODUCTION_DATABASE_URL` repo secret (the UNPOOLED/direct
  connection string — DDL should not run through PgBouncer).
  **A merged migration stays pending until someone dispatches this.** It used to
  ride along on a push to `main`; that gating cost 23% of the repo's monthly CI
  minutes, so it was traded for an explicit step (2026-08-27 — see
  `ci-cost-and-capacity.md`). The rule above still holds: the *trigger* is
  manual, the *execution* is still automation, and the connection string never
  reaches a laptop shell.
- Preview migrations: `apps/web/scripts/vercel-build-migrate.mjs` runs
  `drizzle-kit migrate` during the Vercel build only when `VERCEL_ENV=preview`,
  against the preview branch. Safe because previews are disposable (Task 0c).
- Resetting the preview branch (or local db):
  `DATABASE_URL=<preview pooled url> pnpm --filter web db:reset`
  — see the header of `apps/web/scripts/db-reset.mjs`. For local dev, `pnpm
  --filter web db:reseed` wipes and refills with realistic data in one shot
  (`db:reset --yes` + `db:seed`, `.env.local`'s `DATABASE_URL` picked up
  automatically) — see `apps/web/scripts/db-seed.ts`.

## Testing against a preview deployment

Preview and production deployment URLs are behind **Vercel Authentication**
(`ssoProtection`, scoped `all_except_custom_domains`), so an unauthenticated
request 302s to `vercel.com/sso-api`. Three runs have now been lost to agents
treating that 302 as the app's response, or as proof that the preview cannot be
tested at all. It can. Pick by who is doing the testing:

| Who | How | Lifetime |
|---|---|---|
| An agent or a person, interactively | A `?_vercel_share=` URL — the Vercel MCP's `get_access_to_vercel_url` mints one per deployment | 23 hours |
| CI, or anything unattended | `VERCEL_AUTOMATION_BYPASS_SECRET` as the `x-vercel-protection-bypass` header | Until revoked |

**The bypass secret is the durable one, and it now exists** — generated
2026-08-31, injected by Vercel into every Preview and Development deployment as
`VERCEL_AUTOMATION_BYPASS_SECRET` (confirmed in `vercel env ls`, 2026-09-02;
this paragraph said "does not exist yet" for two days after it did). Read the
value with `vercel env pull`, send it as the `x-vercel-protection-bypass`
header, and add `x-vercel-set-bypass-cookie: true` if you want the rest of the
browsing session to carry it. **It is not yet a GitHub Actions repo secret**,
so a workflow keyed on `deployment_status` still cannot use it — copying it
across is the remaining step before unattended preview testing works from CI.
Treat it like `FLAGS_SECRET`: anyone holding it can reach every protected
deployment this project has.

Either way, `pnpm --filter web walk:preview <url> [path ...]` will drive a real
browser through it — see `apps/web/scripts/walk-preview.mjs`, and
`cloud-agent-sessions.md` for the two extra container-specific obstacles a
cloud session hits on top of the auth one.

What a preview shows that a local production build cannot: whatever Vercel's
own edge injects. The Vercel Toolbar is the live example — it loads only on
preview, and our CSP blocked it from the day the CSP landed until 2026-08-29,
because nothing had ever loaded a preview in a renderer.

### Signing in with Google on a preview

**Works on any preview, with nothing to register.** Since 2026-09-02
(ADR-034, closing KI-50) `AUTH_REDIRECT_PROXY_URL` is set on both the Preview
and Production environments, so a preview asks Google to call back to
`https://caesura.today/api/auth/callback/google` — the one URI registered in
the Google Cloud console — and production forwards the callback to the preview
that started it. **Do not add branch aliases to the Google OAuth client any
more**; the entries added before this date are dead and can be deleted.

Two operational facts, both of which have a way of being learned the hard way:

- **Changing either variable requires redeploying both environments.** Vercel
  injects env vars at deploy time. A preview that has the proxy pointing at a
  production that has not been redeployed will fail with an invalid-state
  error, because production will try to consume a callback whose `state`
  cookie it never set.
- **The session JWT carries the environment that minted it**
  (`lib/authConfig.ts`), because the proxy requires Preview and Production to
  share one `AUTH_SECRET`. A token from one environment presented to the other
  is refused and its cookie cleared. So a preview session is a preview session
  — you cannot carry one to production, and you should not try.

To confirm the proxy is live on a deployment without completing a sign-in, ask
it where it would send you:

```
node scripts/check-auth-proxy.mjs <deployment-url>
```

It reads the `redirect_uri` out of the Google authorization URL that deployment
builds and tells you whether it is production's or its own.

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
