# Stream D — Infra, development, DB management, Vercel, and the review loop

Question: **Are the dev / DB / deploy decisions right, and are we using the
tools we already have well?** Mitchell: *"Look for opportunities to better use
the tools we have available to us, better get reviews on PRs and feedback."*
Tools in play: Vercel (previews, flags, analytics, speed insights), GitHub
(Actions on a Free plan — 2,000 min/month, Dependabot, GHAS), CodeRabbit,
Sentry, Postgres (where is prod — Neon? Vercel Postgres? check env docs),
Playwright, Drizzle, pnpm workspaces, the `.claude/` automation.

Read first:
- `.github/workflows/{ci,migrate-production}.yml`, `.github/dependabot.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.coderabbit.yaml`
- `docs/guidelines/{environments-and-deploys,ci-cost-and-capacity,quality-enforcement,building-the-parts,connecting-the-parts,observability-and-telemetry,working-a-review}.md`
- ADR-002, 004, 019, 023, 024, 032, 034
- `apps/web/next.config.*`, `apps/web/sentry.*.ts`, `instrumentation*.ts`, `apps/web/src/app/.well-known/vercel/flags/**`, `apps/web/src/lib/flags*`
- `apps/web/scripts/{with-test-db,vercel-build-migrate,db-reset,db-seed,walk-preview,preload-dotenv}.mjs`, `scripts/*.mjs`, `scripts/hooks/*`, `.claude/hooks/session-start.sh`, `.claude/settings.json`
- `docker-compose.yml`, `apps/web/.env.example` (or setup-env.mjs), `vercel.json` if present
- `docs/known-issues/open/` entries tagged infra: KI-2026-09-01 (CodeRabbit), KI-2026-09-02 (Node 26), KI-20260830-c/d, KI-20260902-c (packages have no eslint)
- `package.json` scripts at root and `apps/web`; `pnpm-workspace.yaml` (why is `ai@7.0.34` excluded from `minimumReleaseAge`?)

Concretely:
1. **Migrations to production** are manual (`migrate-production.yml`). Assess:
   is a forgotten dispatch detectable? Is there a preview-branch DB story
   (per-preview database, or previews share prod schema)? If prod is Neon,
   are branches used? Recommend the smallest change that makes "merged but
   not migrated" impossible or loud.
2. **CI shape.** Two jobs, draft-gated, `paths-ignore`. Is `pnpm test` in CI
   running the unit lane on Node 22 while devs are on Node 26 (KI)? Is
   `packages/*` linted at all (KI-2026-09-02-c)? Is Playwright's browser
   cached? Is there a build-only smoke on `main` push (the comment says
   Vercel builds main — does a Vercel build failure notify anyone)?
   Estimate minutes/month at current PR rate from the workflow shape and
   say whether the 2,000-minute plan is the right constraint to design
   around versus paying $4/mo for more.
3. **The review loop.** CodeRabbit auto-review is off (KI-2026-09-01); the
   flow is manual. Options: GitHub's Copilot code review (`request_copilot_review`
   exists in this environment's tooling), CodeRabbit's `path_filters` tune,
   the `code-review` skill in Claude Code, a required-status. What
   would give the highest-signal review per PR for the least wall clock, and
   what config change gets it? Check whether branch protection / required
   checks exist on `main` (read `docs/guidelines/*` for what is recorded;
   you cannot query GitHub).
4. **Vercel usage.** Previews with Deployment Protection (ADR-034, the
   `_vercel_share` 429 story) — is the bypass secret in CI so e2e could run
   against a preview instead of a local `next start`? Flags SDK — how many
   flags, are stale ones removed? Analytics/Speed Insights — read by anyone?
   `vercel-build-migrate.mjs` — what does it do now that migrations are
   manual? Is `next build` type-checking twice (CI + Vercel)?
5. **Local dev.** `with-test-db.mjs` provisions per-run databases; `docker-compose`
   for laptops vs native Postgres on 5433 in cloud sessions — is the port
   difference a recurring footgun (grep KIs and retros for `5432`/`5433`)?
   `setup-env.mjs` — does a fresh clone reach a running app in one command?
6. **Observability.** Sentry: is `askAnalytics` (540 lines) duplicating what
   Sentry/Vercel logs give for free? Are PII (emails, invite tokens) scrubbed
   in `beforeSend`? Is there a health route that checks DB + migration state?
7. **Agent tooling.** `.claude/hooks`, `scripts/hooks`, the protocol. Anything
   that fails closed and blocks work, or fails open and pretends to check?
   Is `skills-lock.json` doing anything?
8. **Dependencies.** `next-auth@5 beta`, `next@16`, `drizzle-kit@0.28` vs
   `drizzle-orm@0.45` (major skew?), `eslint-config-next@15` under Next 16,
   `@types/node@22`. Which of these is a real risk vs noise?

Report a **### Recommendations** section ranked by (value ÷ effort), each with
the exact file/setting to change.
