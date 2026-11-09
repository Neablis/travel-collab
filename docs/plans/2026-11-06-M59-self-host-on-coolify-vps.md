# M59 plan — self-host Caesura on a Coolify VPS

Milestone: `docs/milestones/M59-self-host-on-coolify-vps.md` (decisions 1–11, answered 2026-11-08).
ADR: none planned; Part 1 mints one only if the deployment-env module needs a recorded decision.
Part 0 is the prose-only tracking PR on `claude/next-milestone-setup-3ccab6`; it merges last and
supersedes the proposal PR 695. Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/`, `scripts/`,
`.github/`, `.claude/` or `docs/`. Line numbers are from `main` at `ddcb4027`, so treat them as a
starting point, not as fact. **New** marks a file that does not exist yet.

The guide this follows: Saqib Shah, Medium, Feb 2026, "Stop Paying the Vercel Tax: Self-Host
Next.js with Coolify & VPS" (Ubuntu 24.04, Coolify's install script, GitHub app, build, env
vars, Let's Encrypt). Its prices are the guide's, not our bill.

## Two tracks

This milestone has a **code track** (Parts 1–4, one stack of draft PRs, built by subagents with
no one in the room) and an **ops track** (O1–O6, accounts and servers). Ops steps marked
**Mitchell** need his sign-up, payment or a click GitHub will not let an agent make; the rest
an agent runs once it holds the token named.

**Invariant for Parts 1–3: Vercel keeps working.** Every part reads the new env vars first and
falls back to the `VERCEL_*` ones, so `main` still deploys to Vercel until the cutover. Only
Part 4 removes Vercel-only files, and the top PR (Part 4) merges at the cutover (O6), not before.

## Order

| Part | Branch | Base | Depends on |
|---|---|---|---|
| 1 One deployment-env module | `claude/m59-part1-deploy-env` | `main` | — |
| 2 Drop the Vercel packages: cache, flags, analytics, headers | `claude/m59-part2-no-vercel-imports` | part 1 | 1 |
| 3 Docker build, build-time migrate, Coolify previews | `claude/m59-part3-docker-previews` | part 2 | 2 |
| 4 Docs, agents, workflows; Vercel files removed | `claude/m59-part4-off-vercel` | part 3 | 3, and O1–O5 for its walk |

One stack: each part's draft PR targets the part below; Part 4's PR is retargeted to `main` and
is the one CI run and the one merge (`docs/guidelines/stacked-prs.md`).

## Facts the parts share (the survey, 2026-11-08, at `ddcb4027`)

- **`VERCEL_*` reads in src:** `server/config.ts:138`, `server/cache/keys.ts:16,39`,
  `server/cache/redis.ts:150`, `server/libraryCache.ts:52` (deploy id / git sha as cache version),
  `app/api/health/ai-mode/route.ts:62`, `lib/devLogin.ts:29`, `lib/demoDataReset.ts:20`,
  `lib/siteMetadata.ts:52`, `lib/authConfig.ts:127`, `lib/deploymentOrigin.ts:44-52`,
  `apps/web/next.config.ts:22`. Comments only: `server/admission.ts:47`, `server/users.ts:446`,
  `app/api/dev/saved-days/route.ts`, `app/api/dev/content/playbooks/route.ts`.
- **Scripts:** `apps/web/scripts/lib/vercel-build-steps.mjs:10` (`VERCEL_ENV`),
  `apps/web/scripts/vercel-ignore-build.mjs:19`; `VERCEL_AUTOMATION_BYPASS_SECRET` in
  `apps/web/scripts/assistant-live-set.mjs:106`, `apps/web/scripts/walk-preview.mjs:106`,
  `scripts/check-auth-proxy.mjs:96`, `scripts/check-preview-links.mjs:67`,
  `.github/workflows/preview-link-check.yml:47`. `.github/workflows/vercel-preview.yml` asks
  Vercel's API for an on-demand preview.
- **Vercel imports:** `@vercel/analytics` and `@vercel/speed-insights` in `app/layout.tsx:2-3,182-183`;
  `@vercel/functions` (`waitUntil`, `dangerouslyDeleteByTag`) in `server/libraryCache.ts:2`, mocked in
  `libraryCache.test.ts:9` and `entitlements/consoleCache.test.ts:7`; `@flags-sdk/vercel` in
  `server/flags.ts:12`. Declared in `apps/web/package.json:49,68-70`.
- **Cache:** `server/cache/redis.ts` is the Upstash REST client (`@upstash/redis`), reading
  `KV_REST_API_URL` / `KV_REST_API_TOKEN` (:124) and `CACHE_DRIVER` (upstash|memory|off).
  Decision 4 keeps the client and points it at serverless-redis-http on the box, so the only code
  change is the `onVercel` auto-detect.
- **Flags:** `ai-live` (`server/flags.ts:48`) and `admin-console` (:95), both on `vercelAdapter()`.
  Callers: `server/quota.ts`, `server/entitlements/admin.ts`, `server/ai/modelSelection.ts`,
  `server/flagEntities.ts`. Flags Explorer discovery: `app/.well-known/vercel/flags/route.ts`.
- **`next.config.ts`:** no `output`; Toolbar CSP origins at :14-23, :61, :72, :84, :88, :101, :110;
  HSTS deliberately absent (:130 says Vercel serves it); Sentry `automaticVercelMonitors: true` :304.
- **`apps/web/vercel.json`:** deploys `main` only, `ignoreCommand` the ignore script, crons
  `/api/cron/embed-days` 04:00 UTC and `/api/cron/tier-rollup` 04:30 UTC (both Bearer `CRON_SECRET`).
- **Preview database:** every preview uses one disposable Neon branch, never production's, with
  `PREVIEW_DB_IS_DISPOSABLE=true` (`docs/guidelines/environments-and-deploys.md:60`). Coolify
  previews keep that rule: one shared preview branch, migrated at build by the same gate.
- **No Dockerfile, `.dockerignore` or `nixpacks.toml` exists.** Root `docker-compose.yml` is local
  Postgres only.

## Part 1 — one deployment-env module (~25 files)

**Theme.** Decisions 7 and 9's groundwork. One module answers *which environment am I*
(`production` | `preview` | `development`) and *what is my public origin*, from new
`APP_ENV` and `PUBLIC_ORIGIN` env vars, falling back to `VERCEL_ENV` / `VERCEL_*_URL`. Every
`VERCEL_*` read in `apps/web/src` moves behind it. No behavior change on Vercel.

| File | Entry point | Change | Test |
|---|---|---|---|
| **New** `server/deployment/env.ts` | `deployEnv()`, `publicOrigin()`, `deploymentVersion()` | the one reader of `APP_ENV`, `PUBLIC_ORIGIN`, `APP_VERSION`, with `VERCEL_*` fallbacks | **New** `server/deployment/env.test.ts` |
| `lib/deploymentOrigin.ts` | :44-52 | delegate to `publicOrigin()` (or delete and move callers) | `lib/deploymentOrigin.test.ts` |
| `lib/authConfig.ts` | :127 | `deployEnv()` | `lib/authConfig.test.ts` |
| `lib/siteMetadata.ts` | :52 | `deployEnv()` (NOINDEX unless production) | `lib/siteMetadata.test.ts` |
| `lib/devLogin.ts`, `lib/demoDataReset.ts` | :29, :20 | `deployEnv()` | `lib/demoDataReset.test.ts` |
| `server/config.ts`, `server/cache/keys.ts`, `server/cache/redis.ts` | :138; :16,39; :150 | `deployEnv()`; `redis.ts`'s auto picks `upstash` whenever `KV_REST_API_URL` is set, not only on Vercel | `server/cache/keys.test.ts`, `server/cache/redis.test.ts` |
| `server/libraryCache.ts` | :52 | `deploymentVersion()` | `server/libraryCache.test.ts` |
| `app/api/health/ai-mode/route.ts` | :62 | `deployEnv()` | — (add a case to `env.test.ts`) |
| `apps/web/next.config.ts` | :22 `isPreview` | read `APP_ENV` first | `next.config.test.ts` |
| `apps/web/.env.example` | — | document `APP_ENV`, `PUBLIC_ORIGIN`, `APP_VERSION` | — |

Comment-only mentions (`server/admission.ts`, `server/users.ts`, the two dev routes) are reworded.
The other tests in the survey's list (`tripCovers.int`, `savedDayCovers.int`, `coverProxy`,
`oauth/metadata`, `oauth/wellKnown`, `public-api/playbookCover.int`, the dev route int tests) set
`VERCEL_*` in their setup; they keep passing through the fallback, and switch to `APP_ENV` where
they are touched anyway. **Red test:** `env.test.ts` asserts `APP_ENV=preview` with no `VERCEL_ENV`
reads as preview; seen red before the module exists.

**Preview walk:** nothing on screen changes. On the part's preview, sign in with Google, open a
trip, and confirm `/api/health/ai-mode` reports the preview environment.

## Part 2 — drop the Vercel packages: cache, flags, analytics, headers (~20 files)

**Theme.** Decisions 4, 5, 6, 10. After this part no `@vercel/` or `@flags-sdk/vercel` import is
left in `apps/web/src`.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/libraryCache.ts` | :2 `waitUntil`, `dangerouslyDeleteByTag` | Next's `after()` and `revalidateTag()`; same semantics | `server/libraryCache.test.ts`, `server/entitlements/consoleCache.test.ts` |
| `server/flags.ts` | `vercelAdapter()` :12, :57, :104 | flags read `FLAG_AI_LIVE` / `FLAG_ADMIN_CONSOLE` (decision 6); `defaultValue: false` fail-closed stays | `server/flags.test.ts`, `server/entitlements/adminFlag.int.test.ts` |
| `app/.well-known/vercel/flags/route.ts` | — | deleted (no Flags Explorer) | `server/flags.test.ts` |
| `app/layout.tsx` | :2-3, :182-183 | remove `Analytics` and `SpeedInsights`; add a Plausible `next/script` only when `NEXT_PUBLIC_PLAUSIBLE_SRC` and `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` are set | `app/layout.test.ts` |
| `apps/web/next.config.ts` | :14-23, :61-110 CSP; :130; :304 | drop the Toolbar and `va.vercel-scripts.com` origins; allow the Plausible origin from env; add HSTS (`max-age=63072000; includeSubDomains; preload`) in production only; `automaticVercelMonitors: false` | `next.config.test.ts` |
| `apps/web/package.json` | :49, :68-70 | remove the four Vercel packages | — |
| `server/quota.ts`, `server/ai/modelSelection.ts`, `server/flagEntities.ts`, `server/entitlements/admin.ts` | flag callers | only if the flag API changes shape | `server/quota.test.ts`, `server/ai/modelSelection.test.ts` |

`ai-live` on a preview is now an env var on that preview. `apps/web/scripts/assistant-live-set.mjs`
changes in Part 4 with the other scripts. **Red test:** `flags.test.ts` asserts `FLAG_AI_LIVE=true`
turns `ai-live` on with no adapter. **Gate check:** `grep -rn "@vercel/\|@flags-sdk/vercel" apps/web/src`
prints nothing.

**Preview walk:** open the landing page and confirm the CSP has no `vercel.live`, the response has
no HSTS on a preview, and an AI turn still works with `FLAG_AI_LIVE` set on the preview.

## Part 3 — Docker build, build-time migrate, Coolify previews (~12 files)

**Theme.** Decisions 3, 7, 8. The app builds as a container Coolify runs, and a Coolify preview
migrates the shared disposable preview branch at build time, behind the same gate as today.

| File | Entry point | Change | Test |
|---|---|---|---|
| `apps/web/next.config.ts` | — | `output: "standalone"` (monorepo `outputFileTracingRoot` at the repo root) | `next.config.test.ts` |
| **New** `Dockerfile` (repo root) | — | pnpm 11, Node 24, multi-stage; build runs the migrate step, `copy-maplibre-worker.mjs`, `next build`; runtime is the standalone server on :3000 | `docker build` in the part's run (see below) |
| **New** `.dockerignore` | — | node_modules, `.next`, `.git`, worktrees, e2e artefacts | — |
| `apps/web/scripts/lib/vercel-build-steps.mjs` → **new** `apps/web/scripts/lib/build-steps.mjs` | :10 | gate on `APP_ENV=preview` (falling back to `VERCEL_ENV`) AND `PREVIEW_DB_IS_DISPOSABLE=true`; production never migrates at build (ADR-004) | `apps/web/scripts/vercel-build-migrate.test.ts` (renamed `build-migrate.test.ts`) |
| `apps/web/scripts/vercel-build-migrate.mjs` | — | renamed `build-migrate.mjs`; `vercel-build` keeps calling it until Part 4 | same test |
| `apps/web/package.json` | :12 | add a `build:container` script; `vercel-build` unchanged | — |
| **New** `docs/ops/coolify-vps.md` | — | the runbook skeleton: box, Coolify version, every env var by name (never value) per environment, deploy, previews, crons, backups, rollback | — |

**Red test:** `build-migrate.test.ts` asserts `APP_ENV=preview` + disposable migrates and
`APP_ENV=production` never does; seen red before the gate reads `APP_ENV`. **Verify:**
`docker build .` succeeds locally and the container answers `/api/health` with a test
`DATABASE_URL`; say so in the PR's "Not run, and why" line if Docker is not available.

**Preview walk:** the part's Coolify preview (once O4 exists; until then the Vercel preview, which
must still work) shows the app, signed in, on the preview Neon branch.

## Part 4 — docs, agents, workflows; Vercel files removed (~30 files, mostly prose)

**Theme.** Decisions 7, 8, 9. Everything that tells a person or an agent "Vercel" now says
Coolify, and the Vercel-only files go. Lands at the cutover (O6).

| File | Entry point | Change | Test |
|---|---|---|---|
| `apps/web/vercel.json`, `apps/web/scripts/vercel-ignore-build.mjs` | — | deleted (crons move to Coolify, O5) | `apps/web/scripts/vercel-ignore-build.test.ts` deleted |
| `apps/web/package.json` | `vercel-build` | removed; `build:container` is the build | — |
| `.github/workflows/vercel-preview.yml` | — | deleted (Coolify builds previews from PRs) | — |
| `.github/workflows/preview-link-check.yml`, `scripts/check-preview-links.mjs`, `scripts/check-auth-proxy.mjs`, `apps/web/scripts/walk-preview.mjs`, `apps/web/scripts/assistant-live-set.mjs` | bypass secret reads | Coolify preview URLs; drop `VERCEL_AUTOMATION_BYPASS_SECRET` (previews are public, NOINDEX) or replace it with Coolify basic auth if Mitchell wants previews private | `apps/web/scripts/assistant-live-set.test.ts` |
| `.claude/agents/phase-verifier.md`, `.claude/skills/review-a-part/SKILL.md`, `.claude/skills/ai-usage/SKILL.md` | — | walk a Coolify preview; logs come from Coolify, not Vercel runtime logs | — |
| `AGENTS.md`, `docs/guidelines/environments-and-deploys.md`, `docs/guidelines/working-a-review.md`, `docs/guidelines/third-party-services-on-a-preview.md`, `docs/guidelines/observability-and-telemetry.md`, `docs/guidelines/cloud-agent-sessions.md`, `docs/guidelines/stack-and-constraints.md`, `docs/guidelines/ci-cost-and-capacity.md`, `docs/guidelines/repo-automation.md`, `docs/guidelines/billing-without-spending-money.md`, `docs/guidelines/external-data-manual-check.md`, `docs/guidelines/README.md` | — | Vercel → Coolify where it describes how things run now | — |
| `docs/ops/coolify-vps.md` | — | filled in from O1–O6 | — |

**Preview walk:** a Coolify preview of the top of the stack: sign in with Google, open a trip,
ask the assistant, watch a pageview arrive in Plausible.

## Ops track

| Step | Who | What | Done when |
|---|---|---|---|
| O1 | **Mitchell** | Hetzner account, payment, a project, a read/write API token handed to the session | token works (`GET /servers`) |
| O2 | agent (Hetzner token) | create the 8GB box (Ubuntu 24.04, nearest region to the audience), firewall 22/80/443/8000, SSH key; install Coolify via the guide's script; set concurrent builds to 1 | Coolify dashboard answers on :8000 |
| O3 | **Mitchell** | create the Coolify admin account; install Coolify's GitHub App on the repo (GitHub requires the owner's click); create a Coolify API token for the session | token works |
| O4 | agent (Coolify + Vercel DNS + Neon) | DNS: `coolify.`, `staging.` and `*.preview.caesura.today` A records to the box on Vercel DNS; the app resource from the Dockerfile with production env vars (copied from Vercel by name, values moved without printing them) on `staging.caesura.today`; PR previews on `*.preview.caesura.today` with the preview env (preview Neon branch, `PREVIEW_DB_IS_DISPOSABLE=true`, `APP_ENV=preview`); Redis + serverless-redis-http and Plausible as Coolify services; `AUTH_REDIRECT_PROXY_URL` and Google OAuth redirect URIs checked (adding a redirect URI in Google Cloud is **Mitchell's**) | staging serves the app from the box; a PR gets a preview URL |
| O5 | agent (Coolify) | Coolify scheduled tasks: `curl` both cron routes with `CRON_SECRET` at 04:00 and 04:30 UTC; Sentry cron monitors for both; Stripe webhook endpoint unchanged (same domain) | both crons fired once by hand and once on schedule |
| O6 | **Mitchell** merges, agent flips | walk on staging passes → Mitchell merges the top PR → Coolify deploys `main` → apex and `www` DNS flipped to the box → walk on `caesura.today` → Vercel project paused (not deleted); rollback runbook in `docs/ops/coolify-vps.md` | production serves from the VPS |

Secrets never enter the repo, a PR, a log or this chat; env values move tool to tool.

## Gate

The milestone file's exit gate. CI reads on the top part's head (Part 4) once retargeted to
`main`. The **[walk]** is Mitchell's on `staging.caesura.today` before the merge and on
`caesura.today` after the flip: sign in with Google, open a trip, ask the assistant, watch a
cron fire, and see the visit in Plausible.
