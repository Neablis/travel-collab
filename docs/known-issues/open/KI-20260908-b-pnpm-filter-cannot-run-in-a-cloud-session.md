### KI-2026-09-08-b — `pnpm --filter` aborts in a cloud session: the installed `node_modules` was written by a different pnpm major than the one on PATH

- **Severity:** friction (blocks every documented per-package command in a cloud container until a workaround is found; no product impact)
- **Area:** the container image / `node_modules/.modules.yaml` vs the repo's pinned `packageManager`; affects every command in `docs/guidelines/` and in the `minimal-check-subset` skill that is written as `pnpm --filter <pkg> <script>`
- **Symptom / What happens:** the documented Tier 2 command dies before running anything:

  ```
  $ pnpm --filter web typecheck
  ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
  ```

  pnpm's pre-run deps-status check finds `node_modules/.modules.yaml` recording `packageManager: pnpm@10.28.0` with `storeDir: …/store/v10`, while the pnpm actually on PATH is **11.25.0** (`pnpm store path` → `…/store/v11`). It therefore wants to purge and reinstall `node_modules`, cannot prompt for confirmation without a TTY, and aborts.
- **Workaround (used for a whole task, works):** `pnpm --config.verifyDepsBeforeRun=false --filter <pkg> <script>` — skips the deps-status check. The installed tree is in fact usable; only the version-provenance check objects.
- **How to confirm you are hitting it:** `grep packageManager node_modules/.modules.yaml; pnpm store path` — if the majors disagree, this is it.
- **Why this matters more than it looks:** `AGENTS.md`'s Definition of Done makes Tier 2 the normal path for scoped work, and every Tier 2 command in the guidelines and in the `minimal-check-subset` skill is written in the bare `pnpm --filter` form. A session that meets this without knowing the workaround has three bad options in front of it — reinstall (slow, and it is not obviously safe to purge a prepared image's `node_modules`), run the full suite instead (the cost Tier 2 exists to avoid), or skip verification and say so. It cost one task real time on 2026-09-08.
- **Why not fixed here:** the fix is in the container image or in a `.npmrc`, not in the product, and it is not this branch's scope. Two candidate fixes, whichever is right for the image: install `node_modules` with the same pnpm major the image puts on PATH, or set `verify-deps-before-run=false` in the repo's `.npmrc` so the documented commands work as written everywhere.
- **Also observed in the same session, and probably the same class:** `node scripts/check-lint-wall.mjs` cannot run in this sandbox — it emits ten `LINT WALL CANNOT RUN: eslint produced no JSON report for …` lines against its own fixtures. `pnpm --filter web lint` does enforce the boundary rules directly, so the wall's rules are still checked; its self-verification is not.
- **Cross-reference:** `docs/guidelines/cloud-agent-sessions.md` (the natural home for the workaround once confirmed on a second session); KI-2026-09-02 (Node 26 breaking the local unit lane while CI stays green — the same shape: a toolchain skew that only bites outside CI); `.claude/skills/minimal-check-subset/`.
- **First noted:** 2026-09-08, in a Claude Code cloud session, while running the Tier 2 subset for the shared-day → new-trip branch.
