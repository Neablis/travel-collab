# F-D04 — README's fresh-clone recipe fails twice: `db:reseed` does not migrate, and `db:seed` needs the dev server the recipe starts afterwards

- **Stream:** D Infra · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `README.md:81-85` (`db:reseed  # migrate + seed`, then `dev`); `apps/web/package.json:24` (`"db:reseed": "pnpm db:reset --yes && pnpm db:seed"`); `apps/web/scripts/db-reset.mjs:70` (`TRUNCATE … RESTART IDENTITY CASCADE` only); `apps/web/scripts/db-seed.ts:1-3` (POSTs through the command API of a **running** server); `.claude/hooks/session-start.sh:36-41,116-118` states both requirements; `docs/guidelines/environments-and-deploys.md:80-83` repeats the omission.
- **What is wrong:** a fresh laptop following the README dies first on `relation "events" does not exist`, then on connection refused. A fresh clone is ~5 commands across two terminals, not the one the README implies.
- **Suggested fix:** `"db:reseed": "pnpm db:migrate && pnpm db:reset --yes && pnpm db:seed"` (idempotent; the session hook already migrates); reorder README to start `dev` in one terminal before `db:reseed` in another, or teach `db-seed.ts` to boot `next start` itself when no server answers.
- **Scope of the fix:** `apps/web/package.json`, `README.md`, one guideline. Tier 2 (a script line). Check subset: run the recipe once on a fresh database.
- **Cross-reference:** `docs/reviews/2026-09-02-session-tooling-review.md` R2.
