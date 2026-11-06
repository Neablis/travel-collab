# M59 plan - self-host Caesura on a Coolify VPS

Milestone: `docs/milestones/M59-self-host-on-coolify-vps.md` (decisions D1–D9, all open
with recommendations, none answered). ADR: none yet; if Part 1 finds the
deployment-origin module needs a recorded decision, it mints one then.
Part 0 is this prose-only tracking PR on `claude/m59-self-host-coolify-vps`; it merges last.
Deleted at gate close (`docs/plans/README.md`).

The guide this follows: Saqib Shah, Medium, Feb 2026, "Stop Paying the Vercel Tax:
Self-Host Next.js with Coolify & VPS". Hostinger KVM 2 VPS (2 vCPU, 8GB RAM, NVMe,
about $6/mo in the guide), Ubuntu 24.04, `ssh root@ip`, `apt update && apt upgrade`,
Coolify via `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash` (installs
Docker, dashboard on :8000, firewall), connect GitHub, create the resource, Nixpacks
builder auto-detects Next.js, paste env vars, deploy, SSL via Let's Encrypt on the
domain pointed at the VPS IP. The guide's $6/mo VPS claim and its $20/user/mo Vercel
Pro framing are the guide's numbers, not verified against our bill; see the cost
fact below.

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `6e384a7a`, the survey base, so treat them as a starting
point, not as fact. The Vercel-coupling facts were re-checked against latest main
(`aac72462`) at plan time and still hold, with one addition: a second cron, tier-rollup.
**New** marks a file that does not exist yet.

## Order

| Part | Branch | Depends on | Can run beside |
|---|---|---|---|
| 1 Decouple from Vercel runtime APIs | `claude/m59-part1-decouple` | - | - |
| 2 Provision the VPS and the deploy pipeline | `claude/m59-part2-provision` | 1 merged | 3 |
| 3 Cron, migrations and backups on the new host | `claude/m59-part3-cron-migrations` | 1 merged | 2 |
| 4 Cutover | `claude/m59-part4-cutover` | 2 and 3 merged | - |

Every part targets `main`. A part that depends on another branches from `main` after that part
has merged. Parts 2 and 3 both touch `.github/workflows/`; the second to merge takes
`main` first.

## Facts the parts share (the survey, 2026-11-06)

- **The cost baseline is unverified.** Current Vercel Pro + Neon spend is not
  a measured number anywhere in the repo. The plan asks Mitchell for the actual
  monthly bill as the baseline input; it does not assert a saving. Context from
  the Oct 25 pricing research (`~/workspace/pricing-research-caesura-2026-10-25.md`):
  Cloudflare Workers + Neon about $11-22/mo (medium effort); stay-and-tune on
  Vercel+Neon about $26-40/mo, Vercel portion unverified; a VPS about $6-12/mo
  plus Neon Launch scale-to-zero about $6-17/mo if the database stays, so about
  $12-29/mo in total. Hetzner one-box was the cheapest raw option in that
  research (secondary prices only, unverified on the official fetch).
- **Bill drivers that vanish on a VPS** (no function-duration billing): the 2s
  board poll, 300s AI/cron durations, per-hit quota writes. But long requests
  then need proxy/Coolify timeout config instead of a `maxDuration` export.
- **Two crons.** `apps/web/vercel.json`: `/api/cron/embed-days` daily 04:00 UTC
  and `/api/cron/tier-rollup` daily 04:30 UTC; `git.deploymentEnabled` is main
  only, `"**": false`. Both routes check Bearer `CRON_SECRET` first and are
  `force-dynamic`. `embed-days` (`app/api/cron/embed-days/route.ts`) runs the
  plan-retrieval embed sweep with `maxDuration = 300`; its own comment says
  daily cadence is the Vercel Hobby limit and sub-daily needs Pro, so on
  self-host the cadence is free, a small win. `tier-rollup`
  (`app/api/cron/tier-rollup/route.ts`) rewrites the week's tier counts and
  imports nothing from `server/ai/` (KI-2026-10-17-a).
- **Migrations.** `apps/web/scripts/vercel-build-migrate.mjs` runs migrations
  (and, since M51 part 7, a content import) during the Vercel build, preview
  only, gated on `VERCEL_ENV=preview` AND `PREVIEW_DB_IS_DISPOSABLE=true`.
  Production migrates only via dispatched `.github/workflows/migrate-production.yml`
  (ADR-004). History: KI-2026-09-06-h, Neon once injected one `DATABASE_URL`
  for Production+Preview so previews migrated production. Preview and Production
  `DATABASE_URL` are never the same value
  (`docs/guidelines/environments-and-deploys.md`).
- **The build.** `apps/web/package.json`: Node 24.x, Next `^16.4.3`,
  `vercel-build` runs the migrate script then `next build`. There is no
  Dockerfile anywhere in the repo.
- **The config.** `apps/web/next.config.ts`: no `output: "standalone"` (a
  Docker deploy needs this decided); the CSP gates Vercel Toolbar origins on
  `VERCEL_ENV=preview`, and the Toolbar is how the Flags Explorer flips
  `ai-live` per reviewer session (`docs/guidelines/environments-and-deploys.md`,
  *Feature flags*); HSTS is deliberately absent because Vercel serves it, so
  self-host must add it (or serve it via Cloudflare); Sentry
  `automaticVercelMonitors: true` (Vercel Cron monitors).
- **The Vercel couplings.** `VERCEL_ENV` / `VERCEL_URL` appear in
  `lib/authConfig.ts` (env detection), `lib/deploymentOrigin.ts`
  (`VERCEL_URL` / `VERCEL_BRANCH_URL` / `VERCEL_PROJECT_PRODUCTION_URL`),
  `lib/devLogin.ts`, `lib/demoDataReset.ts`, `lib/siteMetadata.ts` (NOINDEX
  unless production), `server/cache/keys.ts` (`VERCEL_ENV` in the cache-key
  prefix), `server/cache/redis.ts` (Upstash Redis only when on Vercel, see
  below), `server/libraryCache.ts` (`VERCEL_DEPLOYMENT_ID` /
  `VERCEL_GIT_COMMIT_SHA` as the cache version), `server/admission.ts`,
  `server/users.ts`.
- **The cache fallback, exactly.** `server/cache/redis.ts`: `onVercel` is
  `VERCEL_ENV` set. Off Vercel, auto with no credentials resolves to the
  `memory` driver, an in-process Map; the file's own comment says `memory` is
  for one process only and a revoke on one instance would not clear another,
  so on a multi-replica deploy the cache needs a shared store or `off`. The
  cache fails open in every case (a miss reads as "not cached"), so this is a
  correctness question about revokes, not an outage risk.
- **Vercel-only imports.** `server/libraryCache.ts:2` imports `waitUntil` and
  `dangerouslyDeleteByTag` from `@vercel/functions`. `server/flags.ts:12`
  imports `vercelAdapter` from `@flags-sdk/vercel` (see also
  `server/entitlements/admin.ts`, checked 2026-09-23). `app/layout.tsx:2-3`
  renders `@vercel/analytics` and `@vercel/speed-insights`, served from
  `/_vercel/*` on our origin; they stop working off Vercel.
- **Env vars in use** (from grep): `DATABASE_URL` (Neon), `CRON_SECRET`,
  `AUTH_SECRET`, `GOOGLE_ID`/`GOOGLE_SECRET`, `STRIPE_*` (secret, webhook
  secret, mode, API version), `RESEND_API_KEY`/`RESEND_EMAIL_DOMAIN`/
  `RESEND_ENDPOINT`, `UNSPLASH_ACCESS_KEY` plus rate limits, `SENTRY_DSN` /
  `NEXT_PUBLIC_SENTRY_DSN`. All move to Coolify env vars; secrets are never
  committed. `AUTH_REDIRECT_PROXY_URL` (Google OAuth callback proxy,
  ADR-034) points at production's callback and must be re-checked on the new
  host: a preview that has the proxy pointing at a production that has not
  been redeployed fails with an invalid-state error.
- **Rollback.** The Vercel project and Neon stay in place through the whole
  milestone; cutover goes via Cloudflare DNS; dual-run, then Vercel is
  decommissioned only after a soak period. The Vercel project is never deleted
  in this milestone.

## Part 1 - decouple from Vercel runtime APIs

**Theme.** D1's groundwork, D3, D4, D5's survey. No behavior change on Vercel;
every change lands behind the existing test lanes. No new route, so nothing in
`server/public-api/exposure.ts`.

| File | Entry point | Change | Test |
|---|---|---|---|
| new `server/deployment/origin.ts` | - | the deployment-agnostic origin/env module: one place that answers "which host am I, which environment, what is my public origin", replacing `lib/deploymentOrigin.ts` and the `VERCEL_ENV` gates in `lib/authConfig.ts`, `lib/devLogin.ts`, `lib/demoDataReset.ts`, `lib/siteMetadata.ts`, `server/cache/keys.ts`, `server/libraryCache.ts`, `server/admission.ts`, `server/users.ts` | new `server/deployment/origin.test.ts` |
| `lib/deploymentOrigin.ts` | - | deleted once its callers move | existing callers' tests |
| `server/libraryCache.ts` | `waitUntil`, `dangerouslyDeleteByTag` :2 | replace the `@vercel/functions` pair with the Next-native equivalents (to verify in the part: `after()` and cache revalidation); no behavior change | existing library cache tests |
| `server/flags.ts` | `vercelAdapter()` :12, :57, :104 | replace the `@flags-sdk/vercel` adapter with the D5 replacement, surveyed in this part and proposed, not assumed; `defaultValue: false` stays the fail-closed fallback | `server/flags.test.ts` |
| `app/layout.tsx` | `Analytics`, `SpeedInsights` :2-3 | remove both (D4: drop by default; Plausible self-hosted only if Mitchell wants the numbers) | existing layout tests |
| `apps/web/next.config.ts` | - | add `output: "standalone"` and a Dockerfile, or justify Nixpacks-only and record the decision; add HSTS, or record that Cloudflare serves it; turn off `automaticVercelMonitors`; the Toolbar CSP origins become conditional on the preview host, not on Vercel | `next.config.test.ts` |
| `server/cache/redis.ts` | `resolveCacheDriver`, `getCache` | the `onVercel` detection becomes the new deployment-env module's answer; confirm the off-Vercel fallback for production (D3: self-hosted Redis in Coolify, or `off` with the revoke caveat recorded) | existing cache tests |
| `apps/web/package.json` | `vercel-build` | no change in this part; Vercel still builds until cutover, and Part 2 adds the Coolify build path | - |

**Preview walk:** nothing on screen changes. On a Vercel preview, the app behaves
exactly as before: sign in with Google, open a trip, and confirm no `@vercel/`
or `@flags-sdk/vercel` import remains in `apps/web/src` (grep).

## Part 2 - provision the VPS and the deploy pipeline

**Theme.** D1, D2's host half, D6. The app does not change in this part; the
place it runs does.

| File | Entry point | Change | Test |
|---|---|---|---|
| (VPS, not the repo) | - | provision per D1 (Hostinger KVM 2 per the guide, or Hetzner priced at build time), Ubuntu 24.04, SSH, `apt update && apt upgrade` | the provider's console shows the box up |
| (Coolify, not the repo) | - | install via the guide's install script; dashboard on :8000; firewall per the script | dashboard reachable, Docker running |
| (Coolify, not the repo) | - | connect GitHub; create the project and the resource for the repo; Nixpacks builder, or the Dockerfile from Part 1 if that was the decision | a first deploy builds |
| (Coolify, not the repo) | - | move the env vars from the survey (all of them; secrets never committed) into Coolify env vars | the deployed app boots and reads its config |
| (Cloudflare, not the repo) | - | proxy DNS through Cloudflare free tier (the guide's DDoS recommendation, which also hides the VPS IP) and SSL via Let's Encrypt on the domain pointed at the VPS IP | the domain answers over https through Cloudflare |
| `.github/workflows/vercel-preview.yml`, `apps/web/vercel.json` | - | left alone until D6 is answered; Part 2 does not remove the Vercel preview path until its replacement is proven | - |
| new `docs/ops/coolify-vps.md` | - | the runbook: provider, box size, Coolify version, where the env vars live, how to deploy, how to roll back, who holds the keys | - |

**To verify in this part:** what Coolify offers for per-PR preview deployments.
If it cannot do them, the part says what replaces the preview walk the
part-reviewer drives today on a Vercel preview (D6), and does not pretend
otherwise.

**Preview walk:** open a PR's Coolify preview URL and walk the app the way the
part-reviewer walks a Vercel preview today. If Coolify cannot make per-PR
previews, the walk uses the D6 replacement and the plan records what it is.

## Part 3 - cron, migrations and backups on the new host

**Theme.** D2's data half, D3, D7. The two crons, the preview-migrate gate, and
the backup story, all without Vercel.

| File | Entry point | Change | Test |
|---|---|---|---|
| (Coolify or system cron, not the repo) | - | replace Vercel Cron with a Coolify scheduled task or a system cron hitting `/api/cron/embed-days` (04:00 UTC) and `/api/cron/tier-rollup` (04:30 UTC) with `CRON_SECRET`; verify which Coolify supports; never an in-app timer (D7) | trigger both endpoints by hand with `CRON_SECRET` and watch the sweep and the rollup run |
| (Sentry, not the repo) | - | Sentry cron monitors via the Sentry API, replacing `automaticVercelMonitors`; to verify in the part | a missed run pages the way a missed Vercel cron run did |
| `apps/web/scripts/vercel-build-migrate.mjs` | the `VERCEL_ENV=preview` AND `PREVIEW_DB_IS_DISPOSABLE=true` gate | replace the preview-migrate build step with an equivalent disposable-branch gate on the new host; the step now also imports content (M51 part 7), so the replacement covers both the migrate and the import; production stays dispatched via `migrate-production.yml` (ADR-004), unchanged | a preview build against a disposable branch migrates and imports without touching production |
| (Neon, not the repo) | - | the database stays on Neon in this milestone (D2), so Neon backups stand; Coolify/app backups go to S3 per the guide (to verify in the part: what Coolify backs up, and where the credentials live) | a backup exists and a restore was at least listed, not just configured |
| (Coolify, not the repo) | - | the staging/preview database story: a disposable Neon branch per preview, same rule as today (Preview and Production `DATABASE_URL` never the same value); how a Coolify preview gets its branch is part of this part | a preview's database is provably not production's |

**Preview walk:** trigger the cron endpoints by hand with `CRON_SECRET` and watch
the embed sweep and tier rollup run; run a preview build against a disposable
branch and watch it migrate and import content without touching production.

## Part 4 - cutover

**Theme.** D8, D9's execution. The DNS flip, the soak, the rollback, and the
decision about what Vercel becomes.

| File | Entry point | Change | Test |
|---|---|---|---|
| (Cloudflare, not the repo) | - | dual-run: Vercel production keeps serving while the Coolify deployment serves the same code behind Cloudflare; flip DNS when the soak criteria are met | both deployments answer the same commit |
| `docs/ops/coolify-vps.md` (from Part 2) | - | the soak: period length set at cutover time and recorded in the milestone file; what is watched during it (errors, cron runs, migration dispatches) | the soak log |
| (Cloudflare, not the repo) | - | rollback is DNS back to Vercel (D8); rollback is exercised or documented before the flip is called done | a rollback rehearsal, or a written rollback runbook with the exact DNS change |
| `docs/milestones/M59-self-host-on-coolify-vps.md` | - | record whether Vercel stays as a fallback or is decommissioned after the soak (D8); the project is never deleted in this milestone | - |

**Preview walk:** production serving from the VPS, previews working, cron firing,
migrations dispatching, rollback exercised or documented.

## Gate

The milestone's exit gate. The **[walk]** is on the VPS deployment after Part 4,
with the Vercel deployment still standing by as the rollback target.
