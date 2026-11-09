# Running Caesura on the Coolify VPS (M59)

A skeleton: Part 3 writes the build and the variable names, Part 4 fills the
rest in from the ops track (O1 to O6 in `docs/plans/2026-11-06-M59-self-host-on-coolify-vps.md`).
**Names only. A value never goes in this file**, a PR or a log; values move from
tool to tool.

## The box

- Provider and size: Hetzner, 8 GB, `linux/amd64`. _(fill in: server name, region, IP held in Coolify, not here)_
- Coolify version: _(fill in)_. Concurrent builds set to 1: a `next build` of this app needs about 4 GB.
- Firewall: 22, 80, 443, 8000.

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
answers `{"ok":true}` without a session and without the database, so Coolify's
container health reads "healthy" only once the server is serving.

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
arrives only as `--secret id=<NAME>` and no `ARG` has a value. The build log
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
| `PUBLIC_ORIGIN`, `APP_VERSION` | runtime | runtime | `lib/deployment/env.ts` |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, `NEXT_PUBLIC_PLAUSIBLE_SRC` | build | build | Plausible |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | build | build | Sentry, browser side |
| `NEXT_PUBLIC_VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` | build | build | Sentry's environment and release in the browser; still read until Part 4 |
| `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILE_SESSION_SAMPLE_RATE` | runtime | runtime | Sentry, server side |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | runtime | runtime | Google sign-in |
| `API_TOKEN_PEPPER`, `API_TOKEN_PEPPER_PREVIOUS`, `COVER_PROXY_SECRET`, `INVITE_SUPER_CODE`, `CRON_SECRET` | runtime | runtime | Secrets the app signs or checks with |
| `ADMIN_USER_IDS` | runtime | runtime | |
| `AI_GATEWAY_API_KEY`, `AI_LIVE`, `AI_MODEL`, `AI_MODEL_CHEAP`, `AI_MODEL_MID`, `AI_MODEL_STRONG`, `AI_CLASSIFIER_MODEL`, `AI_EMBEDDING_MODEL` | runtime | runtime | The assistant |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET` | runtime | test keys only | |
| `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN` | runtime | runtime | Sign-in email |
| `LOCATIONIQ_API_KEY`, `UNSPLASH_ACCESS_KEY` | runtime | runtime | Geocoding, cover photos |
| `CACHE_DRIVER`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` | runtime | runtime | Cache through serverless-redis-http on the box |

_(Part 4: reconcile this list against `.env.example` and the env module once the `VERCEL_*` fallbacks go.)_

## Deploy

`main` deploys to production. Production's build never migrates (ADR-004): the
schema changes by dispatching `migrate-production`, and `build-migrate.mjs`
prints `skipped (APP_ENV=production)`.

## Previews

A pull request gets a preview from Coolify. Its build, with `APP_ENV=preview`
and `PREVIEW_DB_IS_DISPOSABLE=true`, migrates and imports `content/` into the
one shared preview Neon branch, without `--prune`
(`apps/web/scripts/lib/build-steps.mjs`). With the second variable missing the
build refuses and goes red, by design.

**A preview must not inherit production's `DATABASE_URL`.** Coolify copies the
production application's variables into a preview unless the preview scope
overrides them, and the gate trusts the operator's flag alone: a preview that
inherited production's URL with `PREVIEW_DB_IS_DISPOSABLE=true` would migrate
and import into production (the KI-2026-09-06-h failure). So, in this order:

1. Set `DATABASE_URL` on the **Preview scope** to the disposable Neon preview
   branch's connection string.
2. Check it: open the preview's variables and confirm the host and database
   name are the preview branch's, not production's.
3. Only then set `PREVIEW_DB_IS_DISPOSABLE=true`, on the Preview scope.

## Crons

_(fill in, O5)_ `/api/cron/embed-days` at 04:00 UTC and `/api/cron/tier-rollup`
at 04:30 UTC, each a `curl` with `Authorization: Bearer $CRON_SECRET`.

## Backups

_(fill in)_

## Rollback

_(fill in, O6)_ Redeploy the previous image from Coolify; the Vercel project is
paused, not deleted, until the gate closes.
