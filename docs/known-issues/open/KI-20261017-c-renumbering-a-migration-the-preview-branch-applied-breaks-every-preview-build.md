### KI-2026-10-17-c — Renumbering a migration that the shared preview Neon branch already applied breaks every preview build

- **Severity:** reliability. Every preview build fails until the preview database is repaired by
  hand; production is not touched (its migrations are dispatched, ADR-004).
- **Area:** `apps/web/scripts/vercel-build-migrate.mjs` (runs `pnpm drizzle-kit migrate` on every
  preview build), the one shared Neon branch `preview` (`br-holy-hill-arelg6wy`),
  `drizzle.__drizzle_migrations` on that branch, `apps/web/drizzle/meta/_journal.json`.
- **Symptom:** every preview deployment fails in the build's migrate step, on every branch, not
  only the one that renumbered. The log shows no Postgres error: `drizzle-kit migrate`'s spinner
  overwrites it, so the build reads as a bare failure.
- **Why it happens:** every preview migrates the same branch. `drizzle-kit migrate` applies each
  journal entry whose `when` is newer than the newest applied row's `created_at`; it does **not**
  match by name or tag (`drizzle-orm/pg-core/dialect.cjs`, see resolved KI-2026-09-05-k). When a
  part branch's migration has already been applied by its own preview, and is then deleted and
  regenerated under a new number (the plan's rule for the part that merges second), the
  regenerated file carries a newer `when`. The next preview build applies it again, and its DDL
  fails on objects that already exist.
- **The instance (M47, 2026-10-17):** part 4 (PR 475) generated `0056_tier_weekly`, and its
  preview applied it to `preview` (row 59). Part 3 (PR 477) merged first and took `0056`, so part 4
  regenerated as `0057_tier_weekly`. The next preview build re-ran `CREATE TABLE tier_weekly` and
  failed.
- **How to recognise it:** preview builds fail in the migrate step on unrelated branches at once;
  a migration was renumbered or regenerated on some branch since the last green preview; on the
  preview branch, `select id, hash, created_at from drizzle.__drizzle_migrations order by id desc
  limit 5` shows a row whose `created_at` matches no `when` in `main`'s journal (the old file's).
  Run the failing migration's SQL by hand on a throwaway branch, or re-run the migrate without the
  spinner, to see the real error (`relation "…" already exists`).
- **Recovery (needs Mitchell's approval: the branch is shared by every open PR's preview):**
  1. On the `preview` branch, drop what the stale migration created (here `DROP TABLE
     tier_weekly`).
  2. Delete its row from `drizzle.__drizzle_migrations` (here row 59).
  3. Redeploy one failing preview and confirm it reaches READY; the regenerated migration then
     applies once, cleanly.

  Done 2026-10-17 with Mitchell's approval; the redeploy `dpl_EdknDNvmQD5p7zfDw3anh9ooBqLe` went
  READY.
- **Recurred (M50, 2026-10-19):** part 7 (PR 499) generated its migration before part 2
  (PR 496) merged with `0060_users_signup_ref`, and its preview applied it to `preview` (Neon
  project `sweet-firefly-79114130`, branch `br-holy-hill-arelg6wy`) as row 65. Decision 18
  renumbered it to `0061_users_dismissed_publish_offers` after 496 merged, with a newer `when`,
  so the next preview build would re-run its `ADD COLUMN` on a column that already existed. Repaired with
  Mitchell's approval, same recovery:

  ```sql
  ALTER TABLE users DROP COLUMN dismissed_publish_offers;
  DELETE FROM drizzle.__drizzle_migrations WHERE id = 65;
  ```

  PR 499's next preview build then applied `0061` once, as row 66, and the preview went READY.
  Two milestones in a row: the plan's "the part that merges second regenerates" rule produces
  this every time that part's preview has already run, so until a fix below lands, the recovery
  is a standing step of any renumber.
- **Why not fixed here:** found during M47's close, which is prose-only. Each fix below is a build
  script or infrastructure change.
- **Fix direction:** any one of these would do. (a) Make `vercel-build-migrate.mjs` print the
  underlying error (no spinner, or catch and print the Postgres message) so the cause is on the
  page. (b) Before migrating, compare the applied rows' `created_at` with the journal's `when`
  values and fail with a named message when an applied row has no journal entry. (c) Give each
  preview its own Neon branch, so a renumbered migration can only break its own preview. Until
  then: when a part regenerates a migration its preview already applied, do the recovery above
  before the next preview build.
- **First noted:** 2026-10-17, M47 part 4 (PR 475). Recurred 2026-10-19, M50 part 7 (PR 499).
