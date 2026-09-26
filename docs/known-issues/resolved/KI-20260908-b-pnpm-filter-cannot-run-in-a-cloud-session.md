### KI-2026-09-08-b — `pnpm --filter` aborts in a cloud session: the installed `node_modules` was written by a different pnpm major than the one on PATH — RESOLVED

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
- **Confirmed again 2026-09-08, with two details the first sighting missed:**
  - The **env form does not work.** `npm_config_verify_deps_before_run=false` is ignored; only the CLI flag `pnpm --config.verifyDepsBeforeRun=false` takes effect. So this cannot be fixed for a whole session by exporting a variable.
  - **`scripts/check-lint-wall.mjs` cannot run at all here**, because it hardcodes `pnpm --filter web exec` internally and so has no way to receive the flag. Without a `pnpm` shim on PATH that injects it, the script prints thirteen `LINT WALL CANNOT RUN` lines and **exits 1** — which reads exactly like thirteen wall failures and is not. Anyone triaging that output will start by hunting a lint-wall regression that does not exist. A shim makes it pass (13 walls OK), which is also the cheapest confirmation that the walls themselves are fine.
- **THE `check-lint-wall.mjs` HALF IS FIXED, 2026-09-23 — and not for this
  entry's reason.** It was chasing a 243-second test file, and the pnpm
  dependency turned out to be most of the cost as well as the blocker.

  The script no longer shells out through `pnpm --filter web exec eslint`. It
  runs `apps/web/node_modules/.bin/eslint` directly, which is the shim `pnpm
  exec` was arranging anyway, minus pnpm's own startup. With no pnpm in the
  path there is no `--config.verifyDepsBeforeRun=false` to be unable to pass,
  so the thirteen `LINT WALL CANNOT RUN` lines this entry describes cannot
  happen: measured in this container, **exit 0, 29 `lint wall OK` lines, 0
  `CANNOT RUN`**, with no shim on PATH.

  **Resolving the package instead of using the shim does NOT work**, recorded
  so the next person does not spend the attempt: `node <eslint>/bin/eslint.js`
  cannot see the plugins under pnpm's strict layout and dies with *"couldn't
  find the plugin eslint-plugin-react-hooks"*, exit 2, no report — which this
  wall correctly reports as CANNOT RUN rather than as a clean sheet.

  **The speed, which is why it was touched at all:** one fixture lints in
  1600ms through the shim against 2889ms through `pnpm --filter web exec`.
  `scripts/__tests__/check-lint-wall.test.mjs` went **243s → 126s**, and
  `pnpm test` as a whole **392s → 270s**.

  **The rest of this entry stands.** Every other documented command is still
  written as bare `pnpm --filter`, the `--config.verifyDepsBeforeRun=false`
  workaround is still what they need, and the image-level fix (install with the
  pnpm major that is on PATH, or an `.npmrc` line) is still unmade.

- **2026-09-23: the repo carried the second pnpm version, and it reached
  production.** `apps/web/package.json` declared `packageManager: pnpm@10.28.0`
  beside the root's `pnpm@11.25.0`. It is the same 10.28 this entry's
  `.modules.yaml` records. Vercel's project root is `apps/web`, and its build
  log for `cbb7c7f` shows both halves of the skew in one run:
  *"Detected ENABLE_EXPERIMENTAL_COREPACK=1 and "pnpm@11.25.0+sha512…" in
  package.json"*, then *"Done in 7.4s using pnpm v10.28.0"*. Production
  installed and built with pnpm 10 while CI (`pnpm/action-setup` reads the
  root field) and every checkout ran 11. Locally the nested field was inert,
  because pnpm 11 resolves from the workspace root, and that is why nothing
  noticed.

  **Fixed at the source:** the field is gone from `apps/web`, so the root
  `package.json` is the only declaration and Corepack finds it walking up from
  `apps/web`. `scripts/__tests__/toolchain-pins.test.mjs` fails `pnpm test` if
  any workspace package declares `packageManager` again, if a workflow gives
  `pnpm/action-setup` its own `version:`, or if a Node pin disagrees with
  `.nvmrc`. Each rule was seen red.

  **That fix did not reach `main` until 2026-09-26.** It was committed on
  2026-09-23 after its PR (#206) had already merged, so it sat on the branch
  with no PR while this entry was resolved on 2026-09-24 for the install-side
  reason below. The orphan-branch cleanup on 2026-09-26 found it and brought it
  over. Production built with pnpm 10 for those three days.

- **Resolved 2026-09-24 (KI pass) — the session's own install closed it, and a probe watches it.** `.claude/hooks/session-start.sh`'s `CLAUDE_CODE_REMOTE` branch runs `pnpm install` with the pnpm on PATH before anything else, so `node_modules/.modules.yaml` is rewritten by the same major that later runs `pnpm --filter`, and `scripts/lane-probe.mjs` (probe 2) compares the two at every session start. Proof, in a cloud session on 2026-09-24: `.modules.yaml` records `"packageManager": "pnpm@11.25.0"`, `pnpm --version` prints `11.25.0`, the lane probe prints `OK  pnpm --filter  pnpm 11.x wrote node_modules`, and the bare, flag-less commands this entry said abort now run — `pnpm --filter web exec node -e "console.log('web filter ok')"` → `web filter ok`, `pnpm --filter @tc/contracts exec node -e …` → `filter ok`. **What this does not cover:** an agent worktree that never runs `SessionStart` (KI-2026-09-12-b, still open) has no `node_modules` at all — a different failure, owned by that entry; a sweep's fixers run `pnpm install` in their worktree first. No check subset applies — nothing but this file changed.
- **Cross-reference:** `docs/guidelines/cloud-agent-sessions.md` (the natural home for the workaround once confirmed on a second session); KI-2026-09-02 (Node 26 breaking the local unit lane while CI stays green — the same shape: a toolchain skew that only bites outside CI); `.claude/skills/minimal-check-subset/`.
- **First noted:** 2026-09-08, in a Claude Code cloud session, while running the Tier 2 subset for the shared-day → new-trip branch.
