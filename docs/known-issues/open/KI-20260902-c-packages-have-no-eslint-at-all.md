### KI-2026-09-02-c — `packages/*` have no ESLint at all, so the test-quality wall covers `apps/web` only

- **Severity:** cleanup (no known defect; found while landing the wall next door).
- **Area:** all six workspace packages — `contracts`, `domain`, `pages`, `factories`, `fixtures`, `predict`. None has an `eslint.config.*`; none has a `lint` script. The root `pnpm lint` is `pnpm --filter web lint` plus the four `scripts/` walls.
- **What is wrong:** the test-quality wall added 2026-09-02 (`eslint-plugin-testing-library`, `eslint-plugin-playwright`, the no-presentation-assertion rule) is configured in `apps/web/eslint.config.mjs` and therefore stops at `apps/web`. **767 tests are outside it** — 229 in `packages/domain`, 354 in `packages/factories`, 152 in `packages/contracts`, 32 in `packages/pages`. A test in `packages/pages` may assert a class name, reach into `container`, or leave a `screen.debug()` in, and nothing says so.
- **How much it actually matters, honestly:** less than the count suggests. Most of those tests are pure-function tests with no DOM to reach into — `no-node-access` cannot fire on `packages/domain`. `packages/pages` is the real exposure: it has `fast-check` and DOM-adjacent tests, and it is where a future component-shaped test would go. The wall's *presentation* half is the one with a live gap.
- **The wider point:** this is the same species as KI-51 (the colour wall blind to untracked files) and KI-2026-08-30-b (`eslint src` blind to `e2e/`) — a guard whose scope is narrower than its name suggests, where nothing reports the difference. Both of those were found by looking, not by failing.
- **Fix path:** a shared flat config at the repo root that every package extends, plus a `lint` script per package and a root `pnpm -r lint`. That is a structural change to six packages and belongs in its own PR; doing it inside the wall's own PR would have hidden it. Check what it turns up before assuming it is clean — `apps/web`'s first pass found 228 findings in a suite everyone believed was tidy.
- **Cross-reference:** KI-2026-09-02-b (the grandfathered backlog inside `apps/web`), KI-2026-08-30-b (resolved), KI-51 (resolved), `docs/plans/test-overhaul/phase-7-guidelines.md` Task 7.1.
- **First noted:** 2026-09-02, while landing the test-quality wall.
- **2026-09-05 overnight review — re-confirmed, and paired with the other half of its class ([F-E06](../../reviews/2026-09-05-overnight-review/findings/F-E06-two-walls-have-no-self-test-packages-unlinted.md)):**
  `ls packages/*/eslint.config.*` still returns nothing. Stream E puts this
  beside the remaining places the same species can recur: `check-lint-wall.mjs`
  and `check-case-collisions.mjs` are both in root `pnpm lint` and neither has
  a test in `scripts/__tests__/`, where five sibling walls do. (The finding's
  first draft also counted `check-auth-proxy.mjs`; the verifier corrected that
  — it is a manual deployment probe, not a wall.) The untested-walls half is
  filed as KI-2026-09-05-s; this entry stays the record for the unlinted
  packages.
