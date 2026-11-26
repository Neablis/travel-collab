# Running Caesura on the box (M59, M64)

How Caesura runs on its one box: the server, Coolify, Postgres and its backups,
the SSH tunnel, Umami, the two applications (production and the one preview),
the crons, the costs and how to roll back. M59 built the first box
(`docs/plans/2026-11-06-M59-self-host-on-coolify-vps.md`); M64 moved the
database onto it, off Neon, and replaced the box
(`docs/plans/2026-11-24-M64-one-cheap-box-own-postgres.md`, ADR-093).
**Names only. A value never goes in this file**, a PR or a log; values move from
tool to tool. Tokens and passwords live in Coolify and the operator's password
manager, not here.

## The box

- **Provider: pending (2026-11-26).** M64 picked an OVHcloud VPS-2 in Vint Hill,
  VA, but it was out of stock when ordering; Netcup or Hetzner are the candidates.
  This is the one place a provider is named: every other doc says "the box".
  Whichever it is, it needs 4 vCPU, 8 GB, about 75 GB of disk, `linux/amd64`,
  Ubuntu 24.04, and a US east region (nothing decides the region now that the
  database is on the box). Read the checkout total before paying; the figure
  below is a tracker's estimate until the first invoice. Update this bullet when
  the box exists. The address is in Coolify, not here.
- **Coolify** answers on `http://<the box>:8000` (the dashboard, `coolify.caesura.today`
  once its DNS record is up). Concurrent builds are set to 1. Nothing builds on
  the box once production is on images (*Images built in Actions*), so the old
  4 GB `next build` spike (KI-2026-11-14-d) is gone.
- **Firewall (`ufw`):** 22, 80, 443, 8000. Postgres has no public port.
- **Swap:** a 2 GB swap file, a cushion and not a plan: memory is sized for
  production, one preview, Postgres, Redis and Umami together.
- **What runs on it**, as Coolify resources on one private network:
  `caesura-web` (production), `caesura-preview` (the one preview), Postgres 17
  with pgvector (*Postgres*), Redis with serverless-redis-http (the cache) and
  Umami (*Umami*). Redis and Umami's database are not published to the internet:
  `caesura-redis-http` has no domain (Coolify generates an sslip.io one on
  create; remove it). It must have *consistent container name* on, because
  `KV_REST_API_URL` names it by its bare resource ID; with it off the container gets a
  timestamp suffix, the name does not resolve, and the cache fails open silently
  (KI-2026-11-15-a).
- **DNS** is a Cloudflare zone since 2026-11-09 (Vercel DNS stopped taking writes when the
  account was blocked). The domain is a Vercel-resold registration, so its nameservers are
  set in Vercel's domain dashboard. The apex, `www`, `staging.`, `coolify.`, `umami.`
  and `preview.` are A records to the box, all **DNS-only (grey cloud)**: Cloudflare proxies
  nothing, so Let's Encrypt and HSTS are the box's. The email records (SPF, DKIM, DMARC, MX)
  and a CAA for `letsencrypt.org` sit in the same zone. A Cloudflare API token with DNS edit
  on the zone lives with the operator, not here.

## Costs

The target was a bill under about $20 a month for everything. Measured, not
asserted (M64 decision 14): the gate records the monthly bill before and after.

| Line | Before M64 | After |
|---|---|---|
| The box | Hetzner `cpx31`, Ashburn: 73.49/mo | about 8.50 to 10/mo (pending the provider, above) |
| Database | Neon: its last invoice (the gate records it) | none: Postgres is on the box |
| Backups | none beyond Neon's history window | Cloudflare R2, a 14-day nightly dump: cents |
| Analytics | Plausible, on the old box | Umami, on the new one: none |
| Builds | on the box | GitHub Actions minutes (`docs/guidelines/ci-cost-and-capacity.md`) |

The old box (Hetzner `caesura-1`, with its IPs and firewall) is deleted after a
day with no rollback. Neon is suspended or dropped to its free plan, not deleted,
for two weeks after the cutover. Deleting the Neon project is a follow-up on
Mitchell's OK. `docs/ops/cheap-operations.md` is the 2026-10-25 analysis and its
Neon and Vercel prices are history.

## The image

The root `Dockerfile`, built from the repo root, **in GitHub Actions** (*Images
built in Actions*). It installs with pnpm (the version in the root
`package.json`), runs the public-origin check, copies the map worker, runs
`next build`, and ships only the standalone server, as a non-root user on port
3000. It migrates nothing: `next build` has no database to migrate. Locally:
`docker build --platform linux/amd64 .` (the placeholder `DATABASE_URL` is
enough).

The image has a `HEALTHCHECK` that runs `node` against `GET /api/health`, which
answers `{"ok":true}` without a session and without the database, so Docker's
container health reads "healthy" only once the server is serving. **Coolify's own
healthcheck is off** for the application: the Dockerfile's governs. (Two checkers
disagreeing about the same container is how a healthy deploy gets rolled back.)

Both applications are Coolify "Docker image" applications (*Images built in
Actions*); the image's port is 3000. The Dockerfile still reads its build
variables as BuildKit secrets (`--mount=type=secret,id=<NAME>,required=false`,
`# syntax=` pin 1.12), which is how the workflow passes them.

## Environment variables, by name

Runtime variables are set in Coolify on each application. The **build**
variables (the public ones Next inlines into the browser bundle: `PUBLIC_ORIGIN`,
`APP_ENV`, `NEXT_PUBLIC_*`) are **not** set in Coolify any more: they are Actions
variables with a `PRODUCTION_` or `PREVIEW_` prefix, passed to the image build as
BuildKit **secrets** (`--mount=type=secret,id=<NAME>,required=false`), never as
build arguments, so none is in a layer, an `ENV`, `docker history` or a build
log. The image build holds no `DATABASE_URL`: `next build` only needs one to
exist, and the Dockerfile stands in a placeholder. The build log prints one
`[docker] <NAME>: from build secret | from build arg | unset` line per name
(never a value). A new build-time variable needs a `--mount` line and a name in
the loop in the Dockerfile, or it is silently absent, and an Actions variable
for each image. The Dockerfile's `ARG`s are only the fallback for a laptop
`docker build --build-arg`.

| Name | Production | Preview | Note |
|---|---|---|---|
| `DATABASE_URL` | runtime | runtime | Runtime only: the image build has no database. Production: the `caesura` database on the box's private network (`sslmode=disable`, no pooler). `caesura-preview`: `caesura_preview`, never production's (see *Previews*) |
| `APP_ENV` | `production` | `preview` | Runtime on the application, and an Actions variable for the build (`PRODUCTION_APP_ENV` and `PREVIEW_APP_ENV`) |
| `PREVIEW_DB_IS_DISPOSABLE` | never set | set by `coolify-preview.yml` | Not a Coolify variable: the workflow sets it for the migrate step, which also refuses any database not named `caesura_preview` |
| `PUBLIC_ORIGIN` | `https://caesura.today`, build and runtime | build and runtime | `lib/deployment/env.ts`. **Build too**: prerendered pages bake `metadataBase` from it, and without it they name `http://localhost:3001` as their canonical (found 2026-11-09). `scripts/check-public-origin.mjs` fails a production build that lacks it |
| `APP_VERSION` | runtime | runtime | `lib/deployment/env.ts` |
| `NEXT_PUBLIC_UMAMI_SRC`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | build | build | Umami. The script is absent when either is unset |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | build | build | Sentry, browser side |
| `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILE_SESSION_SAMPLE_RATE` | runtime | runtime | Sentry, server side |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | runtime | runtime | Google sign-in |
| `AUTH_SECRET`, `AUTH_URL` | runtime | runtime | Auth.js. Off Vercel, Auth.js trusts no host unless `AUTH_URL` (the public origin) or `AUTH_TRUST_HOST=true` is set, and every visitor then reads as signed out. **`AUTH_URL` must equal the public origin** (`https://caesura.today` in production, the same as `PUBLIC_ORIGIN`): without it Auth.js builds its origin from the container's bind address and sends `https://0.0.0.0:3000/api/auth/callback/google` as the OAuth callback, which Google refuses (found at the cutover). With `AUTH_URL` set, `proxy.ts` must build its rewrites from the request's own URL, not Auth.js's copy of it (fixed 2026-11-09) |
| `API_TOKEN_PEPPER`, `API_TOKEN_PEPPER_PREVIOUS`, `COVER_PROXY_SECRET`, `INVITE_SUPER_CODE`, `CRON_SECRET` | runtime | runtime | Secrets the app signs or checks with |
| `ADMIN_USER_IDS` | runtime | runtime | |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_LIVE`, `AI_MODEL`, `AI_MODEL_CHEAP`, `AI_MODEL_MID`, `AI_MODEL_STRONG`, `AI_CLASSIFIER_MODEL`, `AI_EMBEDDING_MODEL` | runtime | runtime | The assistant |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET` | runtime | test keys only | |
| `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN` | runtime | runtime | Sign-in email |
| `LOCATIONIQ_API_KEY`, `UNSPLASH_ACCESS_KEY` | runtime | runtime | Geocoding, cover photos |
| `CACHE_DRIVER`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` | runtime | runtime | Cache through serverless-redis-http on the box. The URL is the private service address, never public |
| `FLAG_AI_LIVE` | runtime | runtime | The `ai-live` flag; `true` is the only value that turns it on. See `environments-and-deploys.md`, *Feature flags* |
| `RAG_PLAN_RETRIEVAL` | `0` | `0` | **Plan retrieval is paused** until `OPENAI_API_KEY` exists (Anthropic has no embedding model). To restore: add the key, set this back to `1`, run `/api/cron/embed-days` once by hand |

There is no `VERCEL_AUTOMATION_BYPASS_SECRET`: previews are public and NOINDEX, so
there is nothing to bypass. A `VERCEL_*` variable left on the application does
nothing after the cutover except feed the fallbacks in `lib/deployment/env.ts`;
delete them.

`NEXT_PUBLIC_VERCEL_ENV`, `LOCATION_API_KEY` and `UNSPLASHED_ACCESS_KEY` are still set on
`caesura-web` from the copy out of Vercel and nothing reads them (the app reads
`LOCATIONIQ_API_KEY` and `UNSPLASH_ACCESS_KEY`); they are to be deleted (`KI-20261109-b`).

**Embeddings live in the app's own Postgres.** `day_embeddings` is a pgvector table in it
(the `vector` extension, migration `0054`). There is no Upstash Vector, and no index to move.

## Deploy

`main` deploys to production through `.github/workflows/deploy-production.yml`,
on every push (ADR-091): it applies pending migrations, checks production has
them all, builds the image in Actions and deploys it to `caesura-web` through
Coolify's API, and waits for the deployment to finish. A failed migration deploys
nothing. No build migrates: the image build has no database (*Images built in
Actions*).

**`caesura-web` is an image application, with no Git source,** so no GitHub
webhook can deploy a push ahead of the workflow's migration (the way PR 752's
code served for 20 hours without migration 0078, KI-2026-11-15-b). If it is ever
recreated from a Git repository, turn Auto Deploy OFF (Configuration → Advanced)
before the first push.

What the workflow needs: the `COOLIFY_API_TOKEN` repository secret, the one token
for production and previews, with `read` (to follow a deployment to finished),
`write` (to set the image tag) and `deploy` (to queue it), never `root`; the
`COOLIFY_APP_UUID` variable; `PRODUCTION_DATABASE_URL`.
The call is `POST /api/v1/deploy?uuid=<app>&force=false` (`GET` answers "use
POST" on v4.7.5), then `GET /api/v1/deployments/<deployment uuid>` until its
`status` is `finished`, `failed` or `cancelled-by-user`
(`scripts/coolify-deploy.mjs`).

Once the new container answers its health check it reads every page in its own
sitemap, signed out, to fill the library's cache before crawlers ask (ADR-063, amendment
2026-11-19), again once a day, and again a minute after a publish, unpublish, rename or rank
change clears the library's lists (amendment 2026-11-21, logged as `[warm-up] the library's
lists were cleared; reading them again in 60 s`). Its log shows `[warm-up] read <ok> of <n> public pages`
a few minutes after the deploy, or `[warm-up] skipped: <why>`. After that, each
library read that still reaches Postgres logs `[library] cache miss: <what was read>`
(2026-11-20): a steady run of them is a steady load of reads, and the key names the
page kind, filter or page number a crawler asked for. Since 2026-11-22 a stranger's lists come
from one entry, `snapshot`, so its misses should be one after each deploy or clear; a
`library snapshot too large to cache` line means the library outgrew one entry and the lists
are back to one read per URL (ADR-063, amendment 2026-11-22).

By hand: Actions → *deploy-production* → Run workflow on `main` (migrates, then
deploys the head). The dashboard's Redeploy and redeploying an older deployment
(*Rollback*, below) still work and skip the migration step, which is fine: the
schema only moves forward, and every migration works with the code deployed before it (ADR-091).

### Traefik labels are hand-edited (2026-11-09)

Next's standalone server copies a rewrite's target into the response as
`x-middleware-rewrite` (`resolve-routes.js`, after `proxy.ts` has returned), so
every library page told its visitor `x-middleware-rewrite: /playbooks/cached`.
`proxy.ts` cannot drop it: it is the header the rewrite itself travels on. The
App Router client reads `x-nextjs-rewritten-path`, so Traefik strips it:

```
traefik.http.middlewares.strip-next-internal.headers.customresponseheaders.X-Middleware-Rewrite=
```

with `strip-next-internal` appended to the `middlewares=` of each `https-*`
router. To keep those labels, **Readonly labels is off** on `caesura-web`
(Advanced), and Coolify no longer regenerates them. So after adding or changing
a domain: switch Readonly labels on, save, copy the regenerated labels, switch
it off, and put the middleware back. Check: `curl -sI https://caesura.today/playbooks`
shows no `x-middleware-rewrite`.

`ClientHost` `10.0.1.1` in `/data/coolify/proxy/access.log` is the app calling
its own public URL from inside the container (Docker's bridge gateway), not a
visitor whose address was lost: visitors log their own address.

## Previews

**On demand only, and one at a time.** There is one preview application,
`caesura-preview`, at `https://preview.caesura.today` (M64 decisions 6 and 8;
*Images built in Actions* has its setup). A PR gets the preview only through
`.github/workflows/coolify-preview.yml`, when it carries the `preview` label
(`docs/guidelines/environments-and-deploys.md`, *Which pushes build a preview*,
has the why: KI-2026-11-14-d). Labelling a PR builds its image, migrates and seeds
the preview database, then deploys `web:pr-<n>` to that one application,
replacing the previous PR's, and takes the label off any other PR. Unlabelling or
closing the PR stops the app. Coolify's own git previews are not used, and no
per-PR URL exists.

- **The preview's database** is `caesura_preview`, one database in the box's
  Postgres shared by every PR in turn, never production's. The workflow migrates
  it and imports `content/` into it, without `--prune`, over the tunnel, before the
  new image is deployed (`apps/web/scripts/lib/build-steps.mjs`). The step refuses
  any database not named `caesura_preview`, and refuses to run without
  `PREVIEW_DB_IS_DISPOSABLE=true`, which the workflow sets. The role in
  `PREVIEW_DATABASE_URL` owns that database only.
- **A preview cannot inherit production's `DATABASE_URL`**, because it is a
  separate application with its own variables (the KI-2026-09-06-h failure came
  from Coolify filling a preview scope from production's). Still check, when
  creating `caesura-preview`: its `DATABASE_URL` names `caesura_preview`.
  The same goes for every other variable whose production value must not reach a
  preview: `STRIPE_*` (test keys only), `FLAG_AI_LIVE`, `CRON_SECRET` if a preview
  should not run the sweeps.
- **`version` in `GET /api/health`** is the commit baked into the image as
  `SOURCE_COMMIT`. `phase-verifier` and `preview-link-check` wait for it to equal
  the PR head sha.
- **The preview is public** and carries `X-Robots-Tag: noindex, nofollow` on every
  response. The app sends it itself (`next.config.ts`) when `APP_ENV` is
  `preview`, read at build time, so `PREVIEW_APP_ENV=preview` is an Actions
  variable; no Traefik label is needed. It has no password and holds nothing
  secret.
- **The workflow needs**, on the GitHub repository: `COOLIFY_API_TOKEN` (an
  Actions secret, permissions as under *Deploys*), `COOLIFY_PREVIEW_APP_UUID`
  (an Actions variable) and the tunnel and database secrets listed under *Images
  built in Actions*. Without them it warns and passes, and no preview is built.

## Maintenance

`MAINTENANCE_MODE=true` on the application, then a restart (seconds), puts the
site behind one static notice (M64 decision 9). Unset it and restart to end it.
Pages answer 503 with the notice, `Retry-After: 600` and `noindex`; `/.well-known` and `/oauth` answer
`503 {"error":"maintenance"}`. `/api` is outside the proxy (it would buffer
every request body), so maintenance does not stop API writes: at the cutover those
stop by making the old database's application role read-only
(`ALTER ROLE <app role> SET default_transaction_read_only = on`, then end its open
sessions; set it back to `off` first on rollback; cutover runbook step 2). Until
then, and after, API, MCP, cron and sign-in requests still run and fail on the
read-only database, so clients see a server error (likely 500, no `Retry-After`),
not a 503. `/api/health`
stays 200 and adds `"maintenance":true`, so Coolify's rollout and the
container healthcheck keep passing. The notice reads no database. Used for the cutover to the new box;
`COMPARE_DB_A=<url> COMPARE_DB_B=<url> node scripts/compare-databases.mjs` compares the two databases
before and after (read-only, one snapshot per side; exits 1 on any
difference, 2 if it could not compare). It checks table row counts, migrations,
the `vector` extension and the HNSW index, not row contents or sequences. Expect equality only with maintenance
on: a live source keeps taking writes after the dump.

## Postgres

Postgres 17 with pgvector (`pgvector/pgvector:pg17`, the image CI and
`docker-compose.yml` use), a Coolify database resource on the box (M64 decision 1,
ADR-093). The only extension is `vector` (migration `0054`).

- **No public port.** The applications reach it on Coolify's private network, by
  the resource's internal name, with `sslmode=disable` (the traffic never leaves
  the box). Its host port is bound to `127.0.0.1` only, which is what the tunnel
  forwards to. Check after any change to the resource: `nc -vz <public ip> 5432`
  from outside must fail.
- **Databases and roles**, one role each, none a superuser: `caesura` (production),
  `caesura_preview` (the preview, a role that owns that database only) and
  `umami`. No application role can read another's database.
- **One pool per server.** `server/db/client.ts` sets `max: 10`, an idle timeout
  and a connect timeout. There is no pooler (no PgBouncer), so a connection string
  is the same for the app, a migration and a dump: DDL is safe from any of them.
- **Connection budget**, against Postgres's `max_connections` (default 100), worst
  case about 70: 10 per app process, two apps (`caesura-web`, `caesura-preview`)
  doubled during a rolling deploy (40), Umami's pool (about 5 by Prisma's default,
  not measured), the preview import (up to 11) and Actions sessions through the
  tunnel (migrate, state, compare; a few). Re-add this before raising a pool's `max`.
- **The ops database commands** (`db:migrate`, `db:state`, the compare script) run
  from Actions over the tunnel, never from a laptop shell with production's URL.

## Tunnel

Postgres listens on the box's loopback only (ADR-093). Actions
reaches it through an SSH tunnel that `.github/actions/db-tunnel` opens before
any step that names `PRODUCTION_DATABASE_URL`; `scripts/check-workflow-tunnel.mjs`
fails CI if a workflow names it without that step.

- **The user.** `tunnel` on the box, with no shell privileges beyond forwarding.
  Its `authorized_keys` line is restricted:
  `restrict,port-forwarding,permitopen="127.0.0.1:5432" ssh-ed25519 <deploy key>`,
  so the key can open that one forward and nothing else.
- **The forward.** `ssh -N -L 15432:127.0.0.1:5432 tunnel@<host>`, so on the
  runner the database is `127.0.0.1:15432`. `PRODUCTION_DATABASE_URL` carries
  that host and port, not the box's address.
- **The secrets, by name.** `BOX_SSH_KEY` (the private deploy key),
  `BOX_SSH_KNOWN_HOSTS` (the box's host key line, from `ssh-keyscan` checked
  against the box's own fingerprint) and `BOX_SSH_HOST`. The host key is pinned
  and `StrictHostKeyChecking` stays on. Run `ssh-keyscan` against the exact
  `BOX_SSH_HOST` value (name or IP, as written there): the pinned line is matched
  by that string, and a mismatch fails closed with a bare "Host key verification
  failed". The tunnel connects on port 22.
- **The order at cutover.** The tunnel step runs unconditionally on every
  deploy, so (1) set the three secrets, (2) merge, (3) re-point
  `PRODUCTION_DATABASE_URL`. Merging first fails every push-to-main deploy at
  the tunnel step; re-pointing first fails it at connect time.
- **sslmode.** The re-pointed URL must name it: `sslmode=disable`. `client.ts`
  applies `withExplicitSslMode`, and under pg@8 `require` means `verify-full`,
  which fails against the box's self-signed certificate and against `127.0.0.1`.
- **Not killed explicitly.** A composite action has no post step; the runner is
  discarded when the job ends. The action assumes ephemeral runners: on a
  self-hosted one it would leak the tunnel process. The private key is deleted
  once the forward is up, so later steps cannot read it.

## Images built in Actions

M64 (D6 and D8). `deploy-production.yml` and `coolify-preview.yml` build the
Dockerfile on a runner, push `ghcr.io/<repo>/web:<tag>` (`<sha>` for production,
`pr-<n>-<sha>` for a preview, so each push is a new tag; GHCR keeps them all, prune by hand), and call Coolify, which only pulls and runs the tag
(`scripts/coolify-deploy.mjs` and `scripts/coolify-preview.mjs` set
`docker_registry_image_tag` on the application, then deploy). The plan is
`docs/plans/2026-11-24-M64-one-cheap-box-own-postgres.md`.

- **Two applications**, both "Docker image" applications with no git source:
  `caesura-web` (production) and `caesura-preview` at
  `https://preview.caesura.today`. Each names `ghcr.io/<repo>/web` as its image.
  Coolify must be able to pull from GHCR: a private package needs a registry
  login on the box (a read-only token).
- **`SOURCE_COMMIT`** is baked into the image by the build (a build argument), so
  `/api/health`'s `version` works with no git source and no *Include Source
  Commit in Build*.
- **Actions variables**, per image: the public build variables with a
  `PRODUCTION_` or `PREVIEW_` prefix (`PRODUCTION_PUBLIC_ORIGIN`,
  `PRODUCTION_NEXT_PUBLIC_UMAMI_*`, `PRODUCTION_NEXT_PUBLIC_SENTRY_*`, and the
  same for `PREVIEW_`). `COOLIFY_APP_UUID` stays `caesura-web`'s;
  **`COOLIFY_PREVIEW_APP_UUID`** is `caesura-preview`'s. An unset or empty
  variable is left out of the build (`scripts/build-secrets.mjs` filters the
  list, because build-push-action rejects an empty secret), so the build never
  fails on one. Only `PRODUCTION_PUBLIC_ORIGIN` is required:
  `scripts/check-public-origin.mjs` refuses a production build without it.
- **Secrets**: `COOLIFY_API_TOKEN`, permissions as under *Deploys*.
  **`PREVIEW_DATABASE_URL`** is `caesura_preview` on `127.0.0.1:15432` (the
  tunnel), with a role that owns that database only. `build-steps.mjs` refuses to
  migrate any other database name, and `PREVIEW_DB_IS_DISPOSABLE=true` is set by
  the workflow, never by Coolify.
- **The preview app's runtime variables** (set on `caesura-preview` in Coolify,
  not in Actions): `DATABASE_URL` for `caesura_preview` on the box's private
  network, `APP_ENV=preview`, and test keys only for `STRIPE_*`. The image build
  holds no database URL.
- **`APP_ENV=preview` at runtime is the guard's only trigger.** The image's
  build secret is not in the running container, so `assertPreviewDatabase`
  (`apps/web/src/instrumentation.ts`) is a no-op on `caesura-preview` unless
  `APP_ENV=preview` is set there by hand. Check it at O6.
- **Trust.** After the tunnel opens, the PR head's own code runs on the runner
  (`build-migrate.mjs`, the Docker build) with the tunnel key's reach: the whole
  Postgres on the box, production's database included, not only
  `caesura_preview`. Forks are excluded, so the trust is push access, which can
  already edit the workflow; this is an accepted risk. The `remove` job checks
  out the default branch, not the PR, because it holds `COOLIFY_API_TOKEN`.
- **Not yet proven**, until the box is up (O6): that `APP_ENV=preview` is set on the
  preview app, that GHCR can be pulled from the
  box, that Coolify accepts the `docker_registry_image_tag` PATCH and the
  `/stop` call with the token's permissions, and that the preview's runtime
  `DATABASE_URL` names `caesura_preview` (the server refuses to start a preview
  that names another database).

## Umami

Umami replaced Plausible (M64 decision 4). It is a Coolify service on the box with
its own database and role (`umami`) in the box's Postgres, answering at
`https://umami.caesura.today`. The app loads its script from
`NEXT_PUBLIC_UMAMI_SRC` and names the site by `NEXT_PUBLIC_UMAMI_WEBSITE_ID`
(both build variables; the script is absent unless both are set), and the CSP in
`next.config.ts` allows Umami's origin. It counts pageviews only: the app sends
no custom events.

Plausible's history starts 2026-11-09 and Umami cannot import it. A CSV export of
Plausible's data was put in the backup bucket before Plausible was switched off.

## Crons

Three Coolify **scheduled tasks** on `caesura-web`, each a `curl` to the app's own
route with `Authorization: Bearer $CRON_SECRET` (the app checks it,
`server/cronAuth.ts`). Never an in-app timer (M59 decision 8).

| Route | When (UTC) | Does |
|---|---|---|
| `/api/cron/embed-days` | 04:00 daily | Embeds changed days into pgvector. A no-op while `RAG_PLAN_RETRIEVAL=0` has nothing to read |
| `/api/cron/tier-rollup` | 04:30 daily | Rewrites this week's plan-tier rollup rows (daily, so a missed day heals) |
| `/api/cron/discover-rank` | 04:17 daily (`17 4 * * *`) | Rewrites every public day's Discover rank row (ADR-090: the score decays) and clears the `discover-rank` cache tag only when the order a visitor sees moved; its answer's `cleared` says which. Was hourly until 2026-11-18 (ADR-090's amendment): every run woke Postgres |

Run one by hand to test it: Coolify → the application → Scheduled Tasks → the
task → *Execute now*, then read the task's execution log. A 401 is a wrong or
missing `CRON_SECRET` in the task's environment.

## Backups

A **nightly `pg_dump` to Cloudflare R2**, at 03:30 UTC, kept 14 days, from
Coolify's scheduled S3 backup on the Postgres resource (bucket `caesura-backups`,
with an S3 token scoped to it; the credentials live in Coolify). There is no
point-in-time restore: the worst case is losing up to a day of writes, which
Mitchell accepted (M64 decision 5). Umami's database is in the same Postgres, so
the same backup covers it. The Redis cache rebuilds itself and holds nothing worth
restoring.

**Restore drill** (gate box 3, repeat after any change to the backup): fetch one
dump from R2, restore it into a scratch database on the box, run
`COMPARE_DB_A=<source> COMPARE_DB_B=<scratch> node scripts/compare-databases.mjs`
and expect equality, then drop the scratch database. A backup nobody has restored
is not a backup.

**Restoring over `caesura`** (the cutover, or after losing the box's data):

1. Stop `caesura-web` and pause its scheduled tasks. Otherwise the drop fails with
   `55006 database "caesura" is being accessed by other users`, and a running app
   (or a cron) reconnects mid-restore. `DROP DATABASE caesura WITH (FORCE)` also
   works once they are stopped.
2. `DROP DATABASE caesura;` then `CREATE DATABASE caesura OWNER caesura;`, and
   `CREATE EXTENSION vector;` in it as the superuser.
3. `pg_restore --no-owner --no-privileges --role=caesura -d caesura <dump>`. A dump
   from another provider carries that provider's owner and grants, which do not
   exist on the box; restored as the superuser without these flags, the tables
   stay owned by the superuser and the non-superuser `caesura` role gets
   `permission denied` on every query. (Fix an already-done restore with
   `REASSIGN OWNED BY <superuser> TO caesura` in that database, then the grants.)
4. Compare with the app role's URL, not a superuser's: a superuser's passes even
   when the role cannot read.
5. Start `caesura-web` and its tasks.

The drill's scratch restore takes the same flags.

## Rollback

Production is DNS. The cutover to this box kept the old one, and Neon, untouched:

- **The new deploy is bad, the box is fine:** Coolify → `caesura-web` → Deployments
  → redeploy the previous one (an older image tag). Minutes. The schema stays where
  it is: migrations are forward-only, and expand/contract (ADR-091) is what keeps
  older code working against it. The next push to `main` deploys its head again
  through `deploy-production`.
- **The cutover failed, before any real user wrote:** point the apex and `www`
  A records back at the old box and turn maintenance off there (the runbook in the
  plan, O8). Neon was not written to after step 2, so nothing is lost. **After real
  writes**, the new box's rows have to be copied to Neon by hand first, which is why
  the window was short and walked straight away.
- **The box is bad later:** there is no second box. Order a new one, restore the
  latest R2 dump (*Backups*), point DNS at it, and accept losing up to a day.
  The old box and Neon are gone by then (the old box a day after cutover, Neon two
  weeks), so this is the cost of the single box M64 chose.
- **Vercel** stays paused, not deleted, for the same period; while its account is
  blocked (since 2026-11-08) it cannot serve.
