### KI-2026-09-05-k — RESOLVED 2026-09-07 — a merged-but-undispatched production migration is undetectable, Drizzle can silently skip an out-of-order one, and nothing checks the journal

- **Severity:** correctness (a production-data path with no detector; the skip case applies to production, not only to the shared preview branch)
- **Area:** `.github/workflows/migrate-production.yml:21-25`; `apps/web/scripts/vercel-build-migrate.mjs:9` (migrates only when `VERCEL_ENV === "preview"`); `.github/workflows/ci.yml` (no job on `push` to `main`, no `drizzle-kit check`); `.github/PULL_REQUEST_TEMPLATE.md` (no migration line); `apps/web/drizzle/meta/_journal.json` (16 entries, last `0015`); `drizzle-orm/pg-core/dialect.cjs:64` (`Number(lastDbMigration.created_at) < migration.folderMillis`)
- **Symptom / What happens:**
  1. **No detector ([F-C03](../../reviews/2026-09-05-overnight-review/findings/F-C03-undispatched-production-migration-undetectable.md)).** Production deploys on merge; migrations apply on a human dispatch (ADR-004, decided 2026-08-27 for cost reasons — deliberate, and not the problem). `AGENTS.md:335-341` makes "say so in the PR body" the sole control, and the template it mandates has no field for it. After merge nothing — not the build, not a health probe, not CI — says the journal is ahead of `drizzle.__drizzle_migrations`. Code reading `deleted_at` (0014) or `distance_unit` (0015) 500s on a database that has not had them applied, and users find out first. `docs/STATUS.md:1007-1010` already calls this "the thing most likely to be missed".
  2. **The migrator applies only entries newer than the last applied row ([F-D03](../../reviews/2026-09-05-overnight-review/findings/F-D03-drizzle-migrator-skips-older-migrations.md)).** *Preview:* PR A's build migrates the one shared Neon branch; PR B, generated earlier and lacking A, builds next — B's migration is skipped and B's preview 500s on exactly the feature under review, reading as a code bug. *Production:* if PR B (later `when`) merges and is dispatched before PR A merges, A's migration is silently skipped and `drizzle-kit migrate` prints success.
  3. **Nothing checks journal shape, and "forward-only" is written down nowhere ([F-C07](../../reviews/2026-09-05-overnight-review/findings/F-C07-migration-journal-unchecked-forward-only-undocumented.md)).** `drizzle-kit check` passes today (run this session, ~2s) but is in no lane. Two agents generating in parallel both produce `0016_*` with `idx: 16`; git usually conflicts on `_journal.json`, but a bad resolution that keeps both is caught only at `drizzle-kit migrate` time. No migration has a down script, and `0002` and `0005` carry irreversible data steps.
- **Why not fixed here:** found by a read-only review; no code was changed by it. The fixes are cheap and stack: a PR-template line; `scripts/check-migration-journal.mjs` in root `lint` **asserting the newest `when` exceeds `origin/main`'s** (that is the check that catches the production case, not internal monotonicity); `drizzle-kit check` in CI; a migration-state health route; a `push`-to-`main` workflow on `apps/web/drizzle/**`.
- **Open question for a human with platform access:** **were migrations 0012–0015 ever dispatched to production?** Nothing in the repo records it (`gh run list -w migrate-production.yml`). The review flags this as the first thing to check.
- **Cross-reference:** [F-C03](../../reviews/2026-09-05-overnight-review/findings/F-C03-undispatched-production-migration-undetectable.md), [F-D03](../../reviews/2026-09-05-overnight-review/findings/F-D03-drizzle-migrator-skips-older-migrations.md), [F-C07](../../reviews/2026-09-05-overnight-review/findings/F-C07-migration-journal-unchecked-forward-only-undocumented.md); ADR-004; `docs/guidelines/environments-and-deploys.md:75-83`; F-D09 items 1, 3 and 5.
- **Resolved 2026-09-07** by building the four stacked fixes this entry named,
  minus the health route (below). Each was reproduced before it was fixed:

  1. **The detector.** `.github/workflows/migration-pending.yml` runs on every
     push to `main` touching `apps/web/drizzle/**` (and on `workflow_dispatch`)
     and asks production, read-only, whether it has this tree's migrations —
     `apps/web/scripts/check-migration-state.mjs`, one SELECT against
     `drizzle.__drizzle_migrations`, exit 0 applied / 1 pending / 2 could-not-tell.
     It reports *unreachable* separately from *pending*: a pending migration
     older than one already applied can never be applied by `drizzle-kit
     migrate` at all. Proven against a real Postgres: on an unmigrated database
     it listed all 19 as pending; after `drizzle-kit migrate`, `19/19 applied`,
     exit 0; with `0018`'s row deleted (the exact symptom — production at 0017,
     the tree at 0018) it named `0018_saved_day_source_bundle` and exited 1.
  2. **The wall.** `scripts/check-migration-journal.mjs`, wired into root
     `lint`, asserts every migration this branch *adds* is newer than
     `origin/main`'s newest — the check this entry singled out. Seen red on the
     real repo against the real `origin/main`: *"0018_my_new_column
     (when=1788679254759) is NOT newer than the baseline's newest migration
     0018_saved_day_source_bundle (when=1788730372541)"*. It also refuses a
     removed or `when`-rewritten migration (forward-only, now written down in
     `docs/guidelines/environments-and-deploys.md`) and the parallel-generation
     shapes. Eight tests in `scripts/__tests__/check-migration-journal.test.mjs`;
     both rules seen red by mutation before being seen green.
  3. **`drizzle-kit check` is in a lane** — `pnpm --filter web db:check`, a
     `!cancelled()` step in ci.yml's `static-and-unit` job (~2s, no database).
     It complements the wall rather than overlapping it: measured 2026-09-07, a
     journal carrying two `idx: 18` entries printed `Everything's fine 🐶🔥` and
     exited 0, because `check` reads the snapshots and never opens
     `_journal.json`. The wall caught the same journal.
  4. **The PR template** has a **Migrations** section, so "say so in the PR
     body" now has a field to say it in, and a Definition-of-done line.

  The migrator's silent skip (symptom 2) was reproduced live, not reasoned
  about: with one entry pending but older than the newest applied row,
  `drizzle-kit migrate` printed `[✓] migrations applied successfully!` while
  `drizzle.__drizzle_migrations` went from 18 rows to 18 rows.

- **Deliberately not built: the migration-state health route.** The push
  workflow above already answers "is production behind?" on the two occasions
  anyone asks — when a migration merges, and on demand — while a route would add
  a public surface exposing schema state, needing its own gating decision and an
  integration test, for the same answer. Left as a finding, not an omission.

- **Still open, and still for a human with platform access:** *were migrations
  0012–0015 ever dispatched to production?* Nothing in the repo records it. The
  new workflow is now the way to find out without applying anything: Actions →
  migration-pending → Run workflow, or `gh workflow run migration-pending.yml`.
  It prints `N/19 migrations applied` and names every pending tag.
- **First noted:** 2026-09-05, overnight review streams C + D.
