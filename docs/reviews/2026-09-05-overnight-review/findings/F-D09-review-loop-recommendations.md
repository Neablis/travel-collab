# F-D09 — Review-loop and CI recommendations (not defects; ranked by value ÷ effort)

- **Stream:** D Infra · **Severity:** n/a (opportunities) · **Confidence:** each item cites where it lands; platform settings are marked as unverifiable from the repo
- **Context:** CodeRabbit auto-review is off and manual (~21 min, KI-2026-09-01); GHAS agentic code scanning runs on every PR; Copilot review threads have appeared (#141, `docs/guidelines/working-a-review.md:14-33`) but whether it is auto-requested is a ruleset this review could not read; branch protection on `main` was none as of 2026-08-31 (`ci-cost-and-capacity.md:37-41`). The repo is public, so the 2,000-minute cap is gone; wall clock and signal are the constraints.
- **Recommendations, in order:**
  1. **PR template migration line** — `.github/PULL_REQUEST_TEMPLATE.md`, under *Verification*: `Migration: <none | 00NN_tag> — dispatched via migrate-production? [ ]` (F-C03).
  2. **`db:reseed` migrates first** — `apps/web/package.json:24`; reorder `README.md:84-85` (F-D04).
  3. **Journal wall** — `scripts/check-migration-journal.mjs` in root `lint`, asserting against `origin/main` (F-D03, F-C07).
  4. **Sentry URL scrub** — `apps/web/sentry.shared.ts` (F-A07).
  5. **Pending-migration check on `main`** — new workflow on `push` to `main`, `paths: apps/web/drizzle/**`, read-only `psql` (F-C03).
  6. **Automatic Copilot code review + `/code-review` at Tier 3** — GitHub ruleset "Automatically request Copilot code review" (live setting); `AGENTS.md:277-283` and the template's line 50 gain "ran `/code-review`" so the diff is reviewed before `gh pr ready`, while CodeRabbit stays Mitchell's pre-merge step. Cheapest automated review now that CodeRabbit is manual.
  7. **Skip-job conversion, then branch protection** — `ci.yml:29-44` `paths-ignore` → a `changes` job feeding each job's `if:`; then require `static-and-unit`/`integration-e2e` on `main`. Already `TODO.md:869-875`; the sequencing is the point (protection first would block prose PRs whose checks never run).
  8. **`minimumReleaseAge: 1440`, drop the excludes** — `pnpm-workspace.yaml:9-12` (F-D05).
  9. **Node pin** — `.nvmrc` + narrower `engines.node` once Mitchell picks 22 vs 24 (KI-20260902).
  10. **drizzle-kit `^0.31` with a no-diff proof; pin `next-auth` exactly; triage Dependabot** (F-D06).
  11. **PreToolUse test-lane guard** — `scripts/hooks/check-test-lane.mjs` in `.claude/settings.json`, matching `test:e2e(?!:ci-like)` and `test -- --run` — the 2026-08-28 review's Tooling §1, still open; the prose was fixed, the mechanical gate was not.
  12. **Housekeeping** — delete `skills-lock.json` (F-D07); fix `ci.yml:3-10` and `.coderabbit.yaml:6` (F-D08); update `M5-design-foundations.md:163` ("automatic" migrations).
  13. **`tsc` three times per PR** — `ci.yml:110` + `next build` at `:173` + Vercel; env-gated `typescript.ignoreBuildErrors` on CI's build only. Wall clock only; last.
- **Verified sound (do not "fix"):** `migrate-production.yml` guards (ref + typed confirm, `cancel-in-progress: false`, unpooled URL); `with-test-db.mjs` loopback-only per-run databases; draft-gated CI with `ready_for_review`, `!cancelled()`, concurrency cancel, cached `.next`; `session-start.sh`'s cluster-ownership check; the single `ai-live` flag failing closed; Dependabot config matching its recorded reasoning; the 5433/5432 split is not a footgun (every non-CI surface agrees on 5433).
- **Leads needing a human with platform access:** were 0012–0015 dispatched (`gh run list -w migrate-production.yml`); does a failed Vercel production build notify anyone; Vercel build-minute burn from per-push previews on `claude/*` branches (no `vercel.json` `ignoreCommand`); is Copilot review auto-requested; does Sentry project-level scrubbing already mask path tokens.
