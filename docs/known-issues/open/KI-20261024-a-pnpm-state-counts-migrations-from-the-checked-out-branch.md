### KI-2026-10-24-a — `pnpm state` and the PR digest count production migrations from the checked-out branch, not `main`

- **Severity:** misleading. Nothing is wrong in production, but the PROD MIGRATIONS line is the
  one a session repeats to Mitchell as an operator task, and its total changes with the branch.
- **Area:** `scripts/state-digest.mjs`, `readProductionMigrations` (it reads
  `apps/web/drizzle/meta/_journal.json` from the working tree, `MIGRATIONS_DIR`); the PR digest
  that prints the same line.
- **Symptom / What happens:** during M52 the line said `all 62 applied` on one branch and
  `all 67 applied` on another, at the same moment. A branch cut before the newest migrations
  merged lists only the journal it carries, so it neither counts nor checks the migrations `main`
  added since.
- **Why not fixed here:** found during M52's close on a prose-only part 0. The intended fix: read
  the journal from `origin/main` (`git show origin/main:apps/web/drizzle/meta/_journal.json`,
  after a fetch) for the production line, and say which ref was read. A branch's own new
  migrations belong to a separate "this branch adds" line.
- **Cross-reference:** KI-2026-10-18-c (same function: an unfetched run head reads as "NOT
  applied"). A different cause, so a separate entry.
- **First noted:** 2026-10-24, M52, across the part branches and part 0.
