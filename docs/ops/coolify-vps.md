# Running Caesura on the Coolify VPS (M59)

How Caesura runs on its own box (M59): the server, the Coolify application, its
services, its crons and how to roll back. The steps that built it were O1 to O6
in `docs/plans/2026-11-06-M59-self-host-on-coolify-vps.md`.
**Names only. A value never goes in this file**, a PR or a log; values move from
tool to tool. Tokens and passwords live in Coolify and the operator's password
manager, not here.

## The box

- Provider and size: Hetzner `cpx31` in Ashburn (4 vCPU, 8 GB), `linux/amd64`, Ubuntu 24.04,
  **73.49/mo**. That's about 3.5x the same box in Hetzner's EU regions, and over the ~$20 target. A
  move to OVHcloud Hillsboro, near Neon's `aws-us-west-2`, is planned in
  `docs/plans/2026-11-09-move-vps-to-ovhcloud.md`. The address is in Coolify, not here.
- Coolify answers on `http://<the box>:8000` (the dashboard, `coolify.caesura.today`
  once its DNS record is up). Concurrent builds are set to 1: a `next build` of this
  app needs about 4 GB, and a stack of PRs builds one after another.
- Firewall: 22, 80, 443, 8000.
- The application is `caesura-web`, built from the repo's `Dockerfile`. Its
  private neighbours, as Coolify services on the same network: Redis with
  serverless-redis-http (the cache) and Plausible (analytics). Neither is
  published to the internet: `caesura-redis-http` has no domain (Coolify generates an sslip.io
  one on create; remove it). It must have *consistent container name* on, because
  `KV_REST_API_URL` names it by its bare resource ID; with it off the container gets a
  timestamp suffix, the name does not resolve, and the cache fails open silently
  (KI-2026-11-15-a).
- DNS is a Cloudflare zone since 2026-11-09 (Vercel DNS stopped taking writes when the
  account was blocked). The domain is a Vercel-resold registration, so its nameservers are
  set in Vercel's domain dashboard. The apex, `www`, `staging.`, `coolify.`, `plausible.` and
  `*.preview.` are A records to the box, all **DNS-only (grey cloud)**: Cloudflare proxies
  nothing, so Let's Encrypt and HSTS are the box's. The email records (SPF, DKIM, DMARC, MX)
  and a CAA for `letsencrypt.org` sit in the same zone. A Cloudflare API token with DNS edit
  on the zone lives with the operator, not here.

## The image

The root `Dockerfile`, built from the repo root with Coolify's Dockerfile build pack.
It installs with pnpm (the version in the root `package.json`), runs
`pnpm --filter web build:container` (build-time migrate step, the map worker
copy, `next build`) and ships only the standalone server, as a non-root user on
port 3000. Locally: `docker build --platform linux/amd64 .` (the placeholder
`DATABASE_URL` is enough for a build that does not migrate). A preview-style
build passes the real one as a secret, never as a build argument:
`DATABASE_URL=<url> docker build --secret id=DATABASE_URL,env=DATABASE_URL .`

The image has a `HEALTHCHECK` that runs `node` against `GET /api/health`, which
answers `{"ok":true}` without a session and without the database, so Docker's
container health reads "healthy" only once the server is serving. **Coolify's own
healthcheck is off** for the application: the Dockerfile's governs. (Two checkers
disagreeing about the same container is how a healthy deploy gets rolled back.)

The application's build pack is *Dockerfile*, with **"Use Docker Build Secrets" on**,
which needs Dockerfile syntax 1.10 or newer (the `# syntax=` pin is 1.12). The
image's port is 3000.

## Environment variables, by name

Set in Coolify per environment. "Build" means a variable the Dockerfile's build
stage reads, because Next inlines it into the browser bundle or the migrate step
reads it while building; the rest are runtime. Every build variable, and
`DATABASE_URL`, reaches the build as a BuildKit **secret**
(`--mount=type=secret,id=<NAME>,required=false`), never a build argument, so
none is in a layer, an `ENV`, `docker history` or a build log. Keep Coolify's
"Use Docker Build Secrets" on for the application. Verified against Coolify
4.6.0 (`ApplicationDeploymentJob.php`, lines 5440-5441): with it on, Coolify
calls `generate_build_secrets` and sets `build_args` to empty, so each variable
arrives only as `--secret id=<NAME>,env=<NAME>` and no `ARG` has a value. It
also rewrites **every** `RUN` in the Dockerfile (even `RUN corepack enable`) to
prepend `--mount=type=secret,id=<NAME>,env=<NAME>` for each variable, and `env=`
on a secret mount needs Dockerfile frontend 1.10 or newer, so the `# syntax=`
pin is `1.12` (the first real build failed on 1.7 with `unexpected key 'env'`).
The Dockerfile's own `--mount=type=secret,id=<NAME>,required=false` lines on the
build `RUN` repeat those ids; BuildKit accepts that (tested), and the own mount
is what supplies the `/run/secrets/<NAME>` file the loop reads, and what a
laptop `--secret` build needs. The build log
prints one `[docker] <NAME>: from build secret | from build arg | unset` line per
name (never a value), so a first build shows which path each took. A new
build-time variable needs a `--mount` line and a name in the loop in the
Dockerfile, or it is silently absent. The `ARG`s there are only the fallback for
a laptop `docker build --build-arg`. If Coolify's toggle is ever off, the only
way to get `DATABASE_URL` in is an `ARG DATABASE_URL` (a comment in the
Dockerfile marks where), which leaves the URL in that stage's history and the
build log on the box (never in the shipped image): do that knowingly, and for a
Neon branch whose password you can rotate.

| Name | Production | Preview | Note |
|---|---|---|---|
| `DATABASE_URL` | build and runtime | build and runtime | Needed by **every** build: `next build` throws without it. Build secret, see above. Preview: set it explicitly on the **Preview scope** to the shared preview Neon branch, never production's (see Previews) |
| `APP_ENV` | `production` | `preview` | Build and runtime. Gates the build-time migrate |
| `PREVIEW_DB_IS_DISPOSABLE` | never set | `true` | Build. Preview scope only, after checking the database is a throwaway branch |
| `PUBLIC_ORIGIN` | `https://caesura.today`, build and runtime | build and runtime | `lib/deployment/env.ts`. **Build too**: prerendered pages bake `metadataBase` from it, and without it they name `http://localhost:3001` as their canonical (found 2026-11-09). `scripts/check-public-origin.mjs` fails a production build that lacks it |
| `APP_VERSION` | runtime | runtime | `lib/deployment/env.ts` |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, `NEXT_PUBLIC_PLAUSIBLE_SRC` | build | build | Plausible |
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

**Embeddings live in Neon.** `day_embeddings` is a pgvector table in the app's own
database. There is no Upstash Vector, and no index to move.

## Deploy

`main` deploys to production through `.github/workflows/deploy-production.yml`,
on every push (ADR-091): it applies pending migrations, checks production has
them all, then deploys `caesura-web` through Coolify's API and waits for the
deployment to finish. A failed migration deploys nothing. Production's build
never migrates: `build-migrate.mjs` prints `skipped (APP_ENV=production)`.

**Required setting: Auto Deploy is OFF on `caesura-web`** (Configuration →
Advanced). With it on, Coolify's GitHub webhook deploys the push before the
workflow has migrated it, which is how PR 752's code served for 20 hours
without migration 0078 (KI-2026-11-15-b). Check it after any change to the
application's Git source.

What the workflow needs: the `COOLIFY_API_TOKEN` repository secret with `deploy`
(to queue it) and `read` (to follow it to finished), alongside the `write` and
`delete` previews use; the `COOLIFY_APP_UUID` variable; `PRODUCTION_DATABASE_URL`.
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
(2026-11-20): a steady run of them is what keeps Neon awake, and the key names the
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

**On demand only, since 2026-11-14.** On `caesura-web` → Configuration →
*Preview Deployments*, the switch is **off**, so the GitHub App builds no
preview on its own (it still tears one down when its PR closes). A PR gets a
preview only through `.github/workflows/coolify-preview.yml`, when it carries
the `preview` label (`docs/guidelines/environments-and-deploys.md`, *Which pushes
build a preview*, has the why: KI-2026-11-14-d). Only one PR has a preview at a
time: labelling a PR removes the preview, and the label, of any other. The
workflow calls Coolify's
API (`POST`/`DELETE /api/v1/applications/{uuid}/previews`, Coolify 4.4.0 or
later) and needs, on the GitHub repository:

- **`COOLIFY_API_TOKEN`**, an Actions secret: a Coolify API token (Keys &
  Tokens → API tokens) with `write`, `deploy` and `delete`. Not `root`.
- **`COOLIFY_APP_UUID`**, an Actions variable: the `caesura-web` application's
  uuid (in its URL in the dashboard).

Without either, the workflow warns and passes and no preview is built.

The labelled pull request's preview is built by Coolify. Its build, with `APP_ENV=preview`
and `PREVIEW_DB_IS_DISPOSABLE=true`, migrates and imports `content/` into the
one shared preview Neon branch, without `--prune`
(`apps/web/scripts/lib/build-steps.mjs`). With the second variable missing the
build refuses and goes red, by design.

The app reports the build's commit as `version` in `GET /api/health`, read from
`SOURCE_COMMIT`, which Coolify sets in the container's runtime environment (no
Dockerfile change: it is read per request). If `version` reads `unknown`, that
variable is missing; switch on **Include Source Commit in Build** on the
application (Advanced) and redeploy. `phase-verifier` and `preview-link-check`
wait for `version` to equal the PR head sha.

A preview is public at `https://<pr number>.preview.caesura.today` and carries
`X-Robots-Tag: noindex, nofollow` on every response. The app sends it itself
(`next.config.ts`) when `APP_ENV` is `preview`, read at build time, so `APP_ENV=preview`
must be a build variable in the Preview scope; no Traefik label is needed. It has no password and holds nothing secret.

**A preview must not inherit production's `DATABASE_URL`.** Coolify keeps a preview
copy of **every** environment variable and fills it from the production value
unless the Preview scope overrides it, and the gate trusts the operator's flag alone: a preview that
inherited production's URL with `PREVIEW_DB_IS_DISPOSABLE=true` would migrate
and import into production (the KI-2026-09-06-h failure). So, in this order:

1. Set `DATABASE_URL` on the **Preview scope** to the disposable Neon preview
   branch's connection string.
2. Check it: open the preview's variables and confirm the host and database
   name are the preview branch's, not production's.
3. Only then set `PREVIEW_DB_IS_DISPOSABLE=true`, on the Preview scope.

All of this is done **before PR previews are switched on** for the application.
Do the same for every other variable whose production value must not reach a
preview: `STRIPE_*` (test keys only), `FLAG_AI_LIVE`, `CRON_SECRET` if a preview
should not run the sweeps.

## Maintenance

`MAINTENANCE_MODE=true` on the application, then a restart (seconds), puts the
site behind one static notice (M64 decision 9). Unset it and restart to end it.
Pages answer 503 with the notice, `Retry-After: 600` and `noindex`; `/.well-known` and `/oauth` answer
`503 {"error":"maintenance"}`. `/api` is outside the proxy (it would buffer
every request body), so maintenance does not stop API writes: at the cutover those
stop by making Neon's application role read-only
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

## Tunnel

Production's Postgres listens on the box's loopback only (ADR-093). Actions
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
  and `StrictHostKeyChecking` stays on.
- **The order at cutover.** The tunnel step runs unconditionally on every
  deploy, so (1) set the three secrets, (2) merge, (3) re-point
  `PRODUCTION_DATABASE_URL`. Merging first fails every push-to-main deploy at
  the tunnel step; re-pointing first fails it at connect time.
- **sslmode.** The re-pointed URL must name it. `client.ts` applies
  `withExplicitSslMode`, and the old Neon URL said `sslmode=require`; if the
  box's Postgres has no TLS, use `sslmode=disable`.
- **Not killed explicitly.** A composite action has no post step; the runner is
  discarded when the job ends.

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
  **`COOLIFY_PREVIEW_APP_UUID`** is `caesura-preview`'s.
- **Secrets**: `COOLIFY_API_TOKEN` needs `write` and `deploy`.
  **`PREVIEW_DATABASE_URL`** is `caesura_preview` on `127.0.0.1:15432` (the
  tunnel), with a role that owns that database only. `build-steps.mjs` refuses to
  migrate any other database name, and `PREVIEW_DB_IS_DISPOSABLE=true` is set by
  the workflow, never by Coolify.
- **The preview app's runtime variables** (set on `caesura-preview` in Coolify,
  not in Actions): `DATABASE_URL` for `caesura_preview` on the box's private
  network, `APP_ENV=preview`, and test keys only for `STRIPE_*`. The image build
  holds no database URL.
- **Not yet proven**, until the box is up (O6): that GHCR can be pulled from the
  box, that Coolify accepts the `docker_registry_image_tag` PATCH and the
  `/stop` call with the token's permissions, and that the preview's runtime
  `DATABASE_URL` names `caesura_preview` (the server refuses to start a preview
  that names another database).

## Plausible

Plausible is a **raw Docker Compose service** in Coolify, not a one-click service:
Coolify 4.6's API has no `plausible` service type, so it was created from a compose
file. It answers at `https://plausible.caesura.today`, with Mitchell's account and the
`caesura.today` site; the app loads its script from `NEXT_PUBLIC_PLAUSIBLE_SRC`.

In that compose file `BASE_URL` must be `$SERVICE_URL_PLAUSIBLE` (the full
`https://` URL), **not** `$SERVICE_FQDN_PLAUSIBLE`, which is the bare host name
without a scheme. Plausible needs a full URL in `BASE_URL`.

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

The database is Neon's, so its backups and point-in-time restore are Neon's
(the project's history window). The box holds no data worth restoring: the Redis
cache rebuilds itself, Plausible's database is the one thing on it that is not
reproducible, and its Coolify service has scheduled backups turned on.

## Rollback

Production is DNS. Before the cutover, `caesura.today` and `www` pointed at Vercel;
the Vercel project is kept (to be **paused, not deleted**), so it can serve again.
**While the Vercel account is blocked (since 2026-11-08), it cannot serve**, and the
only rollback is the first one below.

- **The new deploy is bad, the box is fine:** Coolify → `caesura-web` → Deployments
  → redeploy the previous one. Minutes. The schema stays where it is: migrations
  are forward-only, and expand/contract (ADR-091) is what keeps older code working
  against it. The next push to `main` deploys its head again through
  `deploy-production`.
- **The box is bad:** un-pause the Vercel project, then repoint the apex and
  `www` A records in the Cloudflare zone back to Vercel (`76.76.21.21`, or the
  values Vercel's domain page gives). The preview and staging hosts can stay
  where they are. DNS is the whole switch, so the time to rollback is the record's TTL.
- Vercel's project settings and environment still hold the old variables, so
  nothing needs rebuilding. Delete the project only after the gate has been
  closed for a while with no rollback.
