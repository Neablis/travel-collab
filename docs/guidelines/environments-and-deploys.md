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
is not loopback, so it can never issue `CREATE`/`DROP DATABASE` against a remote
database.

Running more than one worktree's dev server at once: each needs its own
port. `WEB_PORT=3010 pnpm --filter web dev` (or set `WEB_PORT` in that
worktree's `.env.local`) — see `.env.example`'s port-override section. The
e2e lane does this for itself (`--with-port` picks a free one), so it needs no
coordination between worktrees.

| Environment | App | Database | DATABASE_URL source |
|---|---|---|---|
| Local | `pnpm dev` (port 3001) | Docker Postgres (port 5433), or a native cluster on the same port in a web session | `apps/web/src/server/config.ts` default / `.env.local` |
| CI | GitHub Actions | PG service container | `ci.yml` workflow env |
| Preview | One preview app on the box (`preview.caesura.today`), the labelled PR's image | **`caesura_preview`**, a disposable database on the box's Postgres, never production's | The `caesura-preview` application's Coolify env. `coolify-preview.yml` sets `PREVIEW_DB_IS_DISPOSABLE=true` for its migrate step; it is not a Coolify variable |
| Production | Coolify, the same box | The box's Postgres, database the live site reads | The `caesura-web` application's Coolify env |

> **The database's host and name are deliberately not written above.** They
> have been wrong in this file before, when production and preview were two
> managed projects with near-identical connection strings and the branch *named*
> `production` was not production. Identify a database by connecting to it and
> looking, never by the name on it: `KI-2026-09-06-h` has the method. On the box
> the preview database is `caesura_preview` and `build-steps.mjs` refuses to
> migrate any other name.

Rules (ADR-004 + M1 retro):
- Preview and Production `DATABASE_URL` are **never** the same value.
  **This rule was silently violated from 2026-07-21 to 2026-09-06** (fixed since; KI resolved 2026-09-24) — the managed-
  database Vercel integration injected one `DATABASE_URL` scoped "Production and Preview",
  which is one value for both, and nothing checked. The preview is now its own
  application (`caesura-preview`) with its own `DATABASE_URL`, set explicitly
  (`docs/ops/coolify-vps.md`, *Previews*), so it shares no variable with `caesura-web`. Read
  `docs/known-issues/resolved/KI-20260906-h-preview-and-production-shared-one-database.md`
  before changing anything in this section; the rail below is what now enforces
  the half of it that automation can enforce.
- Migrations are applied by automation only (see below), never `drizzle-kit migrate`
  run by hand against a remote database.
- Production migrations: **applied automatically, before every deploy**
  (ADR-091, 2026-11-15). `.github/workflows/deploy-production.yml` runs on
  every push to `main`: journal shape, `db:migrate` against the
  `PRODUCTION_DATABASE_URL` repo secret (through the SSH tunnel, ADR-093: a direct
  connection, nothing pooled in between), `db:state` to confirm production has
  every migration in the tree, and only then a Coolify deploy of `caesura-web`,
  which it waits on. **A failed migration deploys nothing.** Coolify's Auto
  Deploy is off on `caesura-web` (`docs/ops/coolify-vps.md`, *Deploy*), so this
  workflow is the only way `main` reaches production.
  From 2026-08-27 to 2026-11-15 the trigger was a human dispatch while Coolify
  deployed on push; a merged migration sat pending until someone remembered,
  and `0078` sat for about 20 hours behind live code (KI-2026-11-15-b).
  `migrate-production.yml` is still there as a break-glass manual dispatch from
  `main` (`gh workflow run migrate-production.yml -f confirm=migrate`). The
  execution is automation either way, and the connection string never reaches
  a laptop shell.

  **Migrations run before the code that needs them, so every migration must
  work with the code already running.** The old code serves against the new
  schema for the length of a build, and indefinitely if that build fails. So
  migrations are **expand/contract**:

  - **Expand, one PR:** add a table, an index, a nullable column or one with a
    default. The running code ignores what it does not know about.
  - **Contract, two PRs:** to drop or rename a column or table, add `NOT NULL`
    to a column the running code does not write, or narrow a type, first merge
    a PR that stops the code using it, let it deploy, and only then merge the
    migration that removes it. A rename is add, backfill, switch reads and
    writes, then drop.

  Nothing checks this mechanically: whether a `DROP` is safe depends on what
  the running code reads. The PR template's Migrations section asks it.

  **What tells you a migration is pending** (the last three added by KI-2026-09-05-k;
  before them, the PR body was the only control and nothing checked it):

  | | |
  |---|---|
  | `.github/workflows/deploy-production.yml` | Runs the check below after migrating, on every push to `main`, and deploys nothing if production is still behind. A red run is the alarm. |
  | `.github/workflows/migration-pending.yml` | `workflow_dispatch` only: the same read-only check by hand — how you answer "is production actually at 0018?" without applying anything. Its push trigger was removed by ADR-091, because it raced deploy-production's migration. |
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

  So: **the database answers this question, and the rows above ask it.**
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
  `drizzle-kit migrate` in `coolify-preview.yml`, over the SSH tunnel, before the
  preview's image is deployed (M64 part 4; the image build migrates nothing). It
  needs **both** conditions: `APP_ENV=preview` **and**
  `PREVIEW_DB_IS_DISPOSABLE=true`, and it migrates only the database named
  `caesura_preview`. The first says where the build runs; only the second says
  anything about which database it is pointed at, and the workflow sets it, never
  Coolify. Without it the step **fails** rather than skipping — a preview that cannot prove its database
  is disposable must not migrate, and a red build is the cheap failure here.
  `VERCEL_ENV=preview` alone was the only check until 2026-09-06, which is how
  migrations 0015-0018 were applied to production by preview builds.
  After migrating, the workflow also imports `content/` through
  `import-content-production.ts`, never with `--prune`, into the preview
  database that every open PR shares, so the last build to run wins a day's
  content. A bundle or import error fails that build. Two builds importing at
  once wait for each other on the importer's advisory lock.
- Resetting the preview database (or local db):
  `DATABASE_URL=<preview url, through the tunnel> pnpm --filter web db:reset`
  — see the header of `apps/web/scripts/db-reset.mjs`. For local dev, `pnpm
  --filter web db:reseed` wipes and refills with realistic data in one shot
  (`db:reset --yes` + `db:seed` + `content:import`, `.env.local`'s
  `DATABASE_URL` picked up automatically) — see `apps/web/scripts/db-seed.ts`.
  It does **not** migrate (run `pnpm --filter web db:migrate` first on a fresh
  database) and it seeds through the command API, so `pnpm --filter web dev`
  must already be running.

## Which pushes build a preview

**`deploy-production` builds `main` to production on every push, after migrating. A PR gets a preview only
while it carries the `preview` label.** Since M64 (D6 and D8) the preview is one
Coolify application, `caesura-preview`, at `https://preview.caesura.today`, and
Actions builds its image: `.github/workflows/coolify-preview.yml` opens a tunnel
to the box, migrates and seeds the shared `caesura_preview` database, builds and
pushes `ghcr.io/<repo>/web:pr-<n>-<sha>`, and tells Coolify to pull that tag. Nothing
builds on the box. It does this when the label is added and on each push while
the label stays on, and stops the app when the label comes off or the PR closes.
Actions → *coolify-preview* → Run workflow does it for one PR's head and puts the
label on it, and with *remove* ticked it stops the app and takes the label off.
Setup and the variables are in `docs/ops/coolify-vps.md`, *Images built in Actions*.

**One preview at a time, by construction.** There is one app, so labelling a PR
(or dispatching the workflow for one) replaces whichever PR was on it, and takes
the label off that PR. Labels added together are handled one after another, and
the last one wins. `/api/health`'s `version` is the head sha of the PR that is
on it now: the URL is the same for every PR, so that is how a walk knows whose
preview it is looking at. Taking the label off a PR that no longer owns the app
stops nothing.

**Why a label again (2026-11-14).** Before M59 the same label gated Vercel
previews because Vercel billed preview compute. M59 dropped it on the grounds
that the box has a fixed price, and Coolify then built and kept running a
preview of every PR. The box's limit is memory, not money: on 2026-11-14
fifteen open PRs' previews plus ten production builds ran the 8 GB box out of
memory and took caesura.today down for over an hour (KI-2026-11-14-d). So the
label is the only way in. **Label the PR you will walk, not every PR in a
stack, and take the label off when the walk is done.**

**When the label does nothing, run the workflow (2026-11-15).** Two cases start
no `coolify-preview` run, both seen on PR 755:
- **An agent's label change.** A label added or removed through the Claude
  GitHub App starts no workflow run. Agents open and remove previews with Run
  workflow instead (`gh api -X POST
  repos/Neablis/travel-collab/actions/workflows/coolify-preview.yml/dispatches
  -f ref=main -f inputs[pr]=<n>`, adding `-F inputs[remove]=true` to remove).
- **A PR with a merge conflict.** GitHub gives such a PR no `pull_request` runs
  at all, so neither the label nor a push does anything until the conflict is
  resolved. Run workflow works on it either way.

- **The image build runs in Actions** (a runner, not the 8 GB box), so a preview
  no longer queues behind a production build. The one preview app keeps one
  container running, which is why only one is kept.
- Once a preview answers, `.github/workflows/preview-link-check.yml` requests
  every link the landing sea draws on it, and its `sea-links` job fails naming
  each one that does not answer 200. It runs on ready PRs that carry the
  `preview` label, not drafts, and it is not a required check.
- **A preview that failed or went stale**: read the `coolify-preview` run (the
  build and the migrate are its steps) and Coolify's deployment log for the pull;
  a push rebuilds it.

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
| Preview | `FLAG_AI_LIVE` on the `caesura-preview` application. Unset means simulated; set it to `true` on the preview you want to try live AI on. |
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
