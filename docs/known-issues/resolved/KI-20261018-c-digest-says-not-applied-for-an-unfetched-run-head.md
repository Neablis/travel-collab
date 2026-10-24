### KI-2026-10-18-c — `pnpm state` says production migrations are NOT applied when the last run's head is not fetched — RESOLVED

- **Severity:** misleading. Nothing is wrong in production. But the line is exactly the kind the
  digest exists to get right, and a session could pass it to Mitchell as an operator task.
- **Area:** `scripts/state-digest.mjs`, `readProductionMigrations` (`contains`, around line 304).
- **Symptom:** a session start on 2026-10-18 printed `PROD MIGRATIONS: 5+ NOT applied
  (0055_mode_keyed_billing, …, 0059_drop_users_stripe_customer_id) — last run f179043`. The run on
  `f179043` (15:10Z) had succeeded and contains every migration through 0059. After
  `git fetch origin main` the same command said `all 60 applied`.
- **Cause:** `contains(sha)` runs `git merge-base --is-ancestor <added> <lastRun.sha>`. When
  `lastRun.sha` (from `gh run list`) is not in the local clone, that fails. The failure reads as
  "not an ancestor", so every migration counts as pending.
- **Fix direction:** before the walk, check the head is present (`git cat-file -e <sha>^{commit}`).
  If it is missing, fetch it, or return `unverified: "last run's head <sha> is not fetched"`, which
  the digest already knows how to print. A script test can pin it: a run head absent from the repo
  must never produce a "NOT applied" line.
- **First noted:** 2026-10-18, in the session that merged PRs 481–483.
- **Resolved, 2026-10-24 (KI sweep):** `readProductionMigrations` now checks the last run's head
  with `git cat-file -e <sha>^{commit}` before the ancestry walk. When the clone lacks it, the
  digest returns `unverified: "last run's head <sha7> is not fetched — git fetch origin main"`
  instead of counting every migration as pending. It does not fetch: that would put the network on
  the session-start path. **Proof:** a new test in `scripts/__tests__/state-digest.test.mjs`
  (*"says unverified, never NOT applied, when the last run's head is not fetched"*) has a fixture
  whose 2 migrations are both in a run head the repo does not have. Before the fix it printed
  `PROD MIGRATIONS: 2 NOT applied (0000_first, 0001_second) — last run f179043 2026-09-25`, the
  2026-10-18 symptom. After it: `PROD MIGRATIONS: unverified (last run's head f179043 is not
  fetched — git fetch origin main)`. `node --test scripts/__tests__/state-digest.test.mjs`: 16/16.
