### KI-2026-08-30-b — `apps/web`'s lint script is `eslint src`, so twelve root-level TypeScript files are never linted
- **Severity:** cleanup (no known defect today — every one of these files is currently clean when linted by hand; what is missing is that anything would *tell* you if it stopped being)
- **Area:** `apps/web/package.json` (the `lint` script), the twelve `*.ts` files at `apps/web/`'s root.
- **What is wrong:** `"lint": "eslint src"`. Everything above `src/` is outside the lane. That is not only config — `sentry.shared.ts` is shipped code imported by `sentry.server.config.ts` and `sentry.edge.config.ts`, and `next.config.ts` decides the CSP that KI-66 tracks. The full set: `drizzle.config.ts`, `next-env.d.ts`, `next.config.ts`, `next.config.test.ts`, `playwright.config.ts`, `sentry.edge.config.ts`, `sentry.server.config.ts`, `sentry.shared.ts`, `sentry.shared.test.ts`, `vitest.config.ts`, `vitest.setup.ts`, `vitest.unit.config.ts`.
- **The test lane already solved this problem and the lint lane did not.** `vitest.unit.config.ts` names the root-level test files explicitly, precisely because a `src`-relative glob would miss them. So the repo has already met this exact gap once, in one lane, and fixed it there only. There is no eslint equivalent, and nothing flags the asymmetry.
- **Nothing is wrong today, and that is the whole point.** `npx eslint sentry.shared.test.ts` run by hand is clean. The defect is that `pnpm check` cannot notice when that stops being true — the lint wall, the colour wall and the rest of `pnpm lint`'s guards simply do not see these files. A rule violation introduced in `sentry.shared.ts` would ship green.
- **Fix path:** widen the script (`eslint src *.ts` or an explicit list, matching what `vitest.unit.config.ts` already does), then run it once and fix whatever the twelve files turn out to be carrying — the count is unknown until the lane covers them, which is the reason this is filed rather than fixed in passing. Worth checking at the same time whether `scripts/check-lint-wall.mjs` and `scripts/check-color-wall.mjs` share the same `src`-relative assumption; if they do, they have the same blind spot and it is one fix, not two.
- **Why not fixed here:** found by the KI-96 unit while fixing an unrelated fixture in one of these files, and outside that entry's declared Area. It was recorded inside KI-96's resolved entry, where it would have become invisible the moment that entry moved to `resolved/` — this entry exists so the finding outlives the fix it was noticed during.
- **Cross-reference:** KI-96 (resolved — the fixture whose file exposed this), KI-51 (resolved — the colour wall being blind to untracked files, the same species of guard-with-a-gap), KI-66 (`next.config.ts`'s CSP, one of the unlinted files), `docs/guidelines/quality-enforcement.md`.
- **First noted:** 2026-08-30, during the KI sweep.

---

- **Resolved 2026-09-02** (the test-quality wall PR). `apps/web`'s lint script
  is now `eslint src e2e *.ts`. The twelve root-level files and all 30 e2e specs
  are in the lane, and — as this entry predicted from a hand-run — **all of them
  were already clean**, so widening the script fixed nothing and started
  guarding everything. That was the entire point of the entry.
- **The e2e half turned out to matter more than the root-file half.** Nothing
  under `e2e/` was linted at all, which is why `scripts/check-sleep-wall.mjs`
  had to be a standalone script rather than an ESLint rule. Widening the lane is
  what let `eslint-plugin-playwright` land at the same time; it found 27 real
  findings in specs no linter had ever read (grandfathered under KI-2026-09-02-b).
- **The companion question this entry asked, answered:**
  `scripts/check-lint-wall.mjs` does **not** share the blind spot — it is a
  fixture-based self-test of the ESLint config, not a tree scanner, so it has no
  glob to widen. `scripts/check-color-wall.mjs` does glob `apps/web/src/**`, and
  that scope is deliberate rather than a gap: it is a design-system wall and
  neither `next.config.ts` nor an e2e spec is product UI. Left as is, knowingly.
