# Environments and deploys

## New worktree / first run

`pnpm run setup` copies `.env.example` to `apps/web/.env.local` (never
overwrites an existing one — safe to run any time). Fill in
`LOCATIONIQ_API_KEY` if you need geocoding locally, and `EXTERNAL_DATA_CONTACT`
(an ops address, never a user's) if you want the weather widget to show a
forecast — MET Norway's terms require a contact in the User-Agent, and without
it the widget shows "typical" in the forecast's place (ADR-052). Preview and
Production need `EXTERNAL_DATA_CONTACT` set in Coolify for the
same reason. The rest already default
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

**The test lanes do not touch that database.** `test:int` and `test:e2e` both
run under `apps/web/scripts/with-test-db.mjs`, which creates a private
database for the run, points `DATABASE_URL` at it, and drops it at the end.
Your seeded data survives a test run, and two worktrees can run the lanes at
the same time — that is what the wrapper is for (KI-2026-08-30-e).

> This section used to say the opposite, and it was true: `test:int` shared
> `DATABASE_URL` with dev, and `api/dev/reset-demo-data/route.int.test.ts`
> drives the real reset handler, which soft-deletes every trip its caller is a
> member of. `pnpm db:reseed` after `test:int` is no longer something you have
> to remember.

How it works, in case a run leaves something behind: migrations are applied
once into a template named for a hash of `drizzle/` (`tc_tmpl_<fingerprint>`),
each run is a ~90 ms `CREATE DATABASE … TEMPLATE` clone called
`tc_test_<epoch>_<rand>`, and a run that was SIGKILLed is swept by the next
one after two hours. `KEEP_TEST_DB=1 pnpm --filter web test:int` keeps the
database and prints its URL. The wrapper refuses to run against any host that
is not loopback, so it can never issue `CREATE`/`DROP DATABASE` against a Neon
branch.

Running more than one worktree's dev server at once: each needs its own
port. `WEB_PORT=3010 pnpm --filter web dev` (or set `WEB_PORT` in that
worktree's `.env.local`) — see `.env.example`'s port-override section. The
e2e lane does this for itself (`--with-port` picks a free one), so it needs no
coordination between worktrees.

| Environment | App | Database | DATABASE_URL source |
|---|---|---|---|
| Local | `pnpm dev` (port 3001) | Docker Postgres (port 5433), or a native cluster on the same port in a web session | `apps/web/src/server/config.ts` default / `.env.local` |
| CI | GitHub Actions | PG service container | `ci.yml` workflow env |
| Preview | Coolify per-PR previews on the VPS | **A disposable Neon branch** (pooled), never production's | Coolify env, Preview scope — plus `PREVIEW_DB_IS_DISPOSABLE=true` |
| Production | Coolify, the same VPS | The Neon branch the live site reads (pooled) | Coolify env, Production scope |

> **The Neon project and branch names are deliberately not written above.** They
> have been wrong in this file before: it named a `preview` branch that had been
> archived since 2026-08-28 and a `main` branch in a project that was not the one
> the `PRODUCTION_DATABASE_URL` secret pointed at. Two Neon projects existed with
> near-identical connection strings differing only in host, and the branch *named*
> `production` was not production. Identify a database by connecting to it and
> looking, never by the name on it — `KI-2026-09-06-h` has the method.

Rules (ADR-004 + M1 retro):
- Preview and Production `DATABASE_URL` are **never** the same value.
  **This rule was silently violated from 2026-07-21 to 2026-09-06** (fixed since; KI resolved 2026-09-24) — the Neon
  Vercel integration injected one `DATABASE_URL` scoped "Production and Preview",
  which is one value for both, and nothing checked. Coolify has the same trap: it
  keeps a preview copy of every production variable, so the Preview scope's
  `DATABASE_URL` is set explicitly (`docs/ops/coolify-vps.md`, *Previews*). Read
  `docs/known-issues/resolved/KI-20260906-h-preview-and-production-shared-one-database.md`
  before changing anything in this section; the rail below is what now enforces
  the half of it that automation can enforce.
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

  **What tells you a migration is pending** (all three added by KI-2026-09-05-k;
  before them, the PR body was the only control and nothing checked it):

  | | |
  |---|---|
  | `.github/workflows/migration-pending.yml` | Every push to `main` touching `apps/web/drizzle/**` asks production whether it has them, and fails if not. `workflow_dispatch` runs the same read-only check by hand — that is how you answer "is production actually at 0018?" without applying anything. |
  | `pnpm --filter web db:state` | The same check locally against any `DATABASE_URL`. Exit 0 applied, 1 pending, 2 could-not-tell. |
  | `pnpm lint` → `scripts/check-migration-journal.mjs` | Refuses a migration whose `when` is not newer than `origin/main`'s newest, before it can merge. |

  **A note in `TODO.md` or a milestone file is not one of these, and must never
  be read as one.** On 2026-09-16 an agent told Mitchell five times across a
  session to dispatch `0021` and `0022`, and named their absence as the likely
  cause of a production 500 — on the authority of a bullet that said *"not
  dispatched"*. Both had been applied the previous day. The bullet was stale
  because a person dispatched the workflow and nobody edited the file, which is
  the normal way prose about state goes wrong, not an unusual one. The real
  cause of the 500 was unrelated (`lookup_keys` sent as a scalar), and every
  minute spent on the wrong theory was available to be spent on the right one.

  So: **the database answers this question, and the three rows above ask it.**
  `pnpm --filter web db:state` is one command, works against any
  `DATABASE_URL`, and exits 1 when something is genuinely pending. Ask it before
  you tell anyone a migration is outstanding. Prose in this repository records
  *intent*; only the schema records *state*.

  That last one is not tidiness. Drizzle's migrator applies an entry only if it
  is newer than the newest row already in `drizzle.__drizzle_migrations` — not
  the set difference — so a migration generated on a branch cut before someone
  else's is **skipped, permanently, with `drizzle-kit migrate` printing
  "migrations applied successfully!"**. Measured 2026-09-07 against a real
  Postgres: 18 rows applied, one entry pending and older, `migrate` reported
  success, and the count afterwards was still 18. If the wall fires, rebase and
  re-run `pnpm --filter web db:generate` for a fresh `when` — renumbering the
  file does nothing, because the number is not what is compared.

  **Migrations are forward-only.** No migration in this repo has a down script
  and two (`0002`, `0005`) carry irreversible data steps, so the wall also
  refuses deleting one that `main` already has, or rewriting the `when` of one
  already applied.
- Preview migrations: `apps/web/scripts/build-migrate.mjs` runs
  `drizzle-kit migrate` during the image build (`pnpm --filter web build:container`),
  and needs **both** conditions:
  `APP_ENV=preview` **and** `PREVIEW_DB_IS_DISPOSABLE=true`. The first says
  where the build runs; only the second says anything about which database it is
  pointed at, and it is set by hand on the Preview scope alone. Without it the
  build **fails** rather than skipping — a preview that cannot prove its database
  is disposable must not migrate, and a red build is the cheap failure here.
  `VERCEL_ENV=preview` alone was the only check until 2026-09-06, which is how
  migrations 0015-0018 were applied to production by preview builds.
  After migrating, a preview build also imports `content/` through
  `import-content-production.ts`, never with `--prune`, into the preview
  database that every open PR shares, so the last build to run wins a day's
  content. A bundle or import error fails that build. Two builds importing at
  once wait for each other on the importer's advisory lock.
- Resetting the preview branch (or local db):
  `DATABASE_URL=<preview pooled url> pnpm --filter web db:reset`
  — see the header of `apps/web/scripts/db-reset.mjs`. For local dev, `pnpm
  --filter web db:reseed` wipes and refills with realistic data in one shot
  (`db:reset --yes` + `db:seed` + `content:import`, `.env.local`'s
  `DATABASE_URL` picked up automatically) — see `apps/web/scripts/db-seed.ts`.
  It does **not** migrate (run `pnpm --filter web db:migrate` first on a fresh
  database) and it seeds through the command API, so `pnpm --filter web dev`
  must already be running.

## Which pushes build a preview

**Coolify builds `main` to production on every push, and every PR to a preview.**
A PR's preview lives at `https://<pr number>.preview.caesura.today` (a wildcard
A record on the VPS) and a push to the PR rebuilds it. Setup, the Preview-scope
variables and the database rule are in `docs/ops/coolify-vps.md`. Before M59 a
preview was built on request through a `vercel-preview` workflow and a `preview`
label, because Vercel billed preview compute; the box has a fixed price, so that
gate is gone and no label or token is needed.

- **Concurrent builds are set to 1** on the box (a `next build` needs about 4 GB),
  so a stack of part PRs pushed together builds one after another.
- Once a preview answers, `.github/workflows/preview-link-check.yml` requests
  every link the landing sea draws on it, and its `sea-links` job fails naming
  each one that does not answer 200. It runs on ready PRs, not drafts, and it is
  not a required check.
- **A preview that failed or went stale**: read the build log in Coolify; a push
  or Coolify's *Redeploy* rebuilds it.

## Testing against a preview deployment

Previews are **public and NOINDEX** (the app sends `X-Robots-Tag: noindex, nofollow` when `APP_ENV=preview`): no login, no bypass header, no share link.
That was a decision (2026-11-08): the Vercel Authentication wall cost three lost
runs to agents reading its 302 as the app's answer, and a preview holds only a
disposable database and test keys. Nothing on a preview is secret; do not put
anything there that is.

`pnpm --filter web walk:preview <url> [path ...]` drives a real browser through
one — see `apps/web/scripts/walk-preview.mjs`, and `cloud-agent-sessions.md` for
the container-specific obstacle a cloud session hits.

### Signing in with Google on a preview

**Works on any preview, with nothing to register.** Since 2026-09-02
(ADR-034, closing KI-50) `AUTH_REDIRECT_PROXY_URL` is set on both the Preview
and Production environments, so a preview asks Google to call back to
`https://caesura.today/api/auth/callback/google` — the one URI registered in
the Google Cloud console — and production forwards the callback to the preview
that started it. **Do not add branch aliases to the Google OAuth client any
more**; the entries added before this date are dead and can be deleted.

Two operational facts, both of which have a way of being learned the hard way:

- **Changing either variable requires redeploying both environments.** Coolify
  injects env vars when it starts the container, and `NEXT_PUBLIC_*` at build. A preview that has the proxy pointing at a
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
builds, checks it is production's callback **exactly** (host and path — a right
host with a wrong path is a broken proxy, not a working one), then **asks Google
whether it accepts it** — which needs no credentials,
because an unregistered URI is refused before any sign-in begins. It sends no credential, so there is nothing to export.

What the script cannot prove is that production **forwards** the callback back
to the preview — that needs a completed Google sign-in, so it needs a human.
**It was walked on 2026-09-02** (Mitchell, on PR #120's preview: signed in with
Google, landed back on the preview) and KI-50 is resolved on the strength of
it. The script is the cheap check that the *configuration* is still right on a
given deployment; the sign-in is what proved the mechanism once.

## Feature flags

A flag is an **environment variable** (M59, decision 6): no Flags service, no
per-user targeting, no override cookie. The declarations are in
`apps/web/src/server/flags.ts`; the only value that turns one on is the string
`true`, and a typo, an empty string or an unset variable all mean off. Changing
a flag is a restart of the container in Coolify. See ADR-019 for why the kill
switch is a model swap rather than a branch.

The project's flag is `ai-live`, variable `FLAG_AI_LIVE`: whether
`/api/trips/:id/ask` calls a real model or the simulated one.

| Environment | Where the value lives |
|---|---|
| Local / CI | `AI_LIVE` in `.env.local` / the CI env — `false` by default, checked by `aiLive()` (`apps/web/src/server/ai/modelSelection.ts`) before the flag is ever consulted. **Never set this in a deployment** (see below). |
| Preview | `FLAG_AI_LIVE` on the Coolify Preview scope. Unset means simulated; set it to `true` on the preview you want to try live AI on. |
| Production | `FLAG_AI_LIVE` on the Production scope. **`false` until release; `true` from release onward**, at which point it is the emergency disable — ADR-019's 2026-09-13 amendment. Do not flip it before M20's entitlement gate is live in production: between the flip and the gate there is no spend control at all. |

**Flipping `ai-live` for everyone:** set `FLAG_AI_LIVE` on the Production scope
in Coolify and restart the application. The value is global to the process:
there is no per-person rollout any more. Every caller, signed-out visitors
included, gets whatever that one value says.

**From release onward it is `true`, and that is safe only because M20 checks
entitlement before the flag is consulted** (`modelSelection.ts`): an account
without `ai.ask` is `denied` and never reaches `aiLive()`, so *who may spend*
is a database fact about a paid account, not the flag's job. The flag is what its
name says, whether live AI is on at all, and setting it to `false` is the
emergency disable, one action reaching everyone. Order is not negotiable: the
entitlement gate goes live first.

If the session read itself *fails*, the flag is not consulted and `aiLive()`
answers `false`: simulated, never spending. Off is the answer to every question
this flag cannot resolve.

**Checking what a deployment is actually doing:** `GET /api/health/ai-mode`
returns `{ live, source, tiers, environment }`. `source: "env"` means `AI_LIVE`
decided it; `source: "flag"` means `FLAG_AI_LIVE` did. With flags as env vars
both answer the same for every caller; `"env"` marks the local/CI override,
which is why e2e's `global.setup.ts` refuses to run a suite on anything else.

### Who may open the operator console

Not a flag. A global boolean would make every signed-in caller an operator, so
it is per account: `users.is_admin` is the durable fact, and `ADMIN_USER_IDS`
(an env var, so a restart) writes that column on the listed account's next
sign-in (`apps/web/src/server/entitlements/admin.ts`). **Removing admin is
clearing the column.** The Vercel `admin-console` flag that once gave a
no-deploy switch went with the Flags service.

**`AI_LIVE` must never be set in a deployment.** It is a local/CI-only escape
hatch inside `aiLive()` that short-circuits the flag entirely, and it logs a
warning every time it decides a turn in a deployment. In Coolify leave it unset
so `FLAG_AI_LIVE` stays the sole source of truth.

## Which models the assistant runs, and paying for them

Since M59 Part 4 the assistant calls Anthropic directly, on our own
`ANTHROPIC_API_KEY`, and embeddings go straight to OpenAI on `OPENAI_API_KEY`:
no AI Gateway sits between. The models are four environment variables, set per
Coolify scope (Production and Preview): `AI_MODEL_CHEAP`, `AI_MODEL_MID`,
`AI_MODEL_STRONG` and `AI_CLASSIFIER_MODEL` (`apps/web/src/server/config.ts`).
Each holds an id of the form `anthropic/<model>`; `resolveChatModel`
(`apps/web/src/server/ai/modelId.ts`) turns the dotted version
(`claude-sonnet-5.5`) into the hyphenated name Anthropic takes, and refuses any
other provider. Changing one is a restart, not a code change — but **every id
must have a rate in `apps/web/src/server/entitlements/modelRates.ts` first**, or
every turn on it is an unpriced row in the cost console.

**Decided 2026-10-10: the Anthropic tiers.**

| Variable | Model id |
|---|---|
| `AI_CLASSIFIER_MODEL` | `anthropic/claude-haiku-5.5` |
| `AI_MODEL_CHEAP` | `anthropic/claude-haiku-5.5` |
| `AI_MODEL_MID` | `anthropic/claude-sonnet-5.5` |
| `AI_MODEL_STRONG` | `anthropic/claude-opus-5.5` |

The switch, in order:

1. **Anthropic Console** — create an API key in its own workspace, and set that
   workspace's monthly spend limit to the credit it is spending ($100), so
   usage stops at the credit instead of charging a card. With no Gateway in the
   path there is no second bill to fall back to: an exhausted workspace fails the
   turn.
2. **Set `ANTHROPIC_API_KEY`** and the four variables above in Coolify for
   Production and Preview, and restart.
3. **Update `apps/web/src/server/ai/eval/models.json`** to the new ids, then run
   the eval once (`EVAL_CONFIRM=1 pnpm --filter web eval`, M33) to check
   quality and cost on the new models.

Plan retrieval needs an `OPENAI_API_KEY` for embeddings; until one exists
`RAG_PLAN_RETRIEVAL=0` (`docs/ops/coolify-vps.md`).

## Debug-only routes

`POST /api/dev/reset-demo-data` (`apps/web/src/app/api/dev/reset-demo-data/route.ts`)
wipes the signed-in caller's own trips and reseeds the 14-day/68-stop Japan
demo trip, for reproducing UI bugs against rich data without a terminal.
Gated by `isDemoDataResetEnabled()` (`apps/web/src/lib/demoDataReset.ts`)
requiring **both** `APP_ENV=preview` and `SEED_DEMO_DATA=true` —
`APP_ENV` is set per Coolify scope (`production` on Production), so **production
can never satisfy this regardless of `SEED_DEMO_DATA`**. Either condition failing
404s the route (not 403), so its existence isn't advertised. Set
`SEED_DEMO_DATA=true` in a Preview environment (Coolify, Preview
scope) to enable it there; leave it unset everywhere else, including local
`.env.local`, since it has no effect outside Preview.
