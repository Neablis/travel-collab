### KI-2026-10-18-c — `pnpm state` says production migrations are NOT applied when the last run's head is not fetched

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
