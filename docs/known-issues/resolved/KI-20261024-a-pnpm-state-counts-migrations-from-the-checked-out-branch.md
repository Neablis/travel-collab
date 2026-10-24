### KI-2026-10-24-a — `pnpm state` and the PR digest count production migrations from the checked-out branch, not `main` — RESOLVED

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
- **Resolved, 2026-10-24 (KI sweep):** `readProductionMigrations` reads the journal with
  `git show origin/main:apps/web/drizzle/meta/_journal.json` and looks up each migration's adding
  commit on `origin/main`. It falls back to the working tree only where there is no
  `origin/main`. Every PROD MIGRATIONS line now ends `[journal at origin/main]` (or `[journal at
  the working tree]`). Tags in the branch's journal that are not on main get their own line,
  `this branch adds N migration(s) not on origin/main (…); production does not count it until it
  merges`. The digest still does not fetch (no network on the session-start path), so the count
  is main as of the last fetch, and the line says which ref it read. The "PR digest" is the same
  script, printed by `.claude/hooks/session-start.sh`; no second producer of the line exists.
  **Proof:** a new test in `scripts/__tests__/state-digest.test.mjs` (*"counts the journal on
  origin/main, not the checked-out branch's"*) checks out a branch cut before main added 0001 and
  0002, which carries its own `0001_branch_own`. The run head is main's tip. Before the fix:
  `PROD MIGRATIONS: 1 NOT applied (0001_branch_own) — last run a2bbb0c 2026-10-24`. After it:
  `all 3 applied … contains 0002_third  [journal at origin/main]` plus the branch-adds line.
  `node --test scripts/__tests__/state-digest.test.mjs`: 17/17. Live `pnpm state` on this
  worktree's branch: `PROD MIGRATIONS: all 67 applied — last migrate-production run 3389c58
  2026-10-23 contains 0066_ai_usage_plan_examples  [journal at origin/main]`.
