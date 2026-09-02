### KI-2026-08-30-b — `apps/web`'s lint script is `eslint src`, so twelve root-level TypeScript files are never linted — RESOLVED
- **Severity:** cleanup (no known defect today — every one of these files is currently clean when linted by hand; what is missing is that anything would *tell* you if it stopped being)
- **Area:** `apps/web/package.json` (the `lint` script), the twelve `*.ts` files at `apps/web/`'s root.
- **What is wrong:** `"lint": "eslint src"`. Everything above `src/` is outside the lane. That is not only config — `sentry.shared.ts` is shipped code imported by `sentry.server.config.ts` and `sentry.edge.config.ts`, and `next.config.ts` decides the CSP that KI-66 tracks. The full set: `drizzle.config.ts`, `next-env.d.ts`, `next.config.ts`, `next.config.test.ts`, `playwright.config.ts`, `sentry.edge.config.ts`, `sentry.server.config.ts`, `sentry.shared.ts`, `sentry.shared.test.ts`, `vitest.config.ts`, `vitest.setup.ts`, `vitest.unit.config.ts`.
- **The test lane already solved this problem and the lint lane did not.** `vitest.unit.config.ts` names the root-level test files explicitly, precisely because a `src`-relative glob would miss them. So the repo has already met this exact gap once, in one lane, and fixed it there only. There is no eslint equivalent, and nothing flags the asymmetry.
- **Nothing is wrong today, and that is the whole point.** `npx eslint sentry.shared.test.ts` run by hand is clean. The defect is that `pnpm check` cannot notice when that stops being true — the lint wall, the colour wall and the rest of `pnpm lint`'s guards simply do not see these files. A rule violation introduced in `sentry.shared.ts` would ship green.
- **Fix path:** widen the script (`eslint src *.ts` or an explicit list, matching what `vitest.unit.config.ts` already does), then run it once and fix whatever the twelve files turn out to be carrying — the count is unknown until the lane covers them, which is the reason this is filed rather than fixed in passing. Worth checking at the same time whether `scripts/check-lint-wall.mjs` and `scripts/check-color-wall.mjs` share the same `src`-relative assumption; if they do, they have the same blind spot and it is one fix, not two.
- **Why not fixed here:** found by the KI-96 unit while fixing an unrelated fixture in one of these files, and outside that entry's declared Area. It was recorded inside KI-96's resolved entry, where it would have become invisible the moment that entry moved to `resolved/` — this entry exists so the finding outlives the fix it was noticed during.
- **Cross-reference:** KI-96 (resolved — the fixture whose file exposed this), KI-51 (resolved — the colour wall being blind to untracked files, the same species of guard-with-a-gap), KI-66 (`next.config.ts`'s CSP, one of the unlinted files), `docs/guidelines/quality-enforcement.md`.
- **First noted:** 2026-08-30, during the KI sweep.

- **RESOLVED 2026-09-02, by widening the script exactly as the fix path said, and pinning the width with a test so it cannot narrow again silently.**

  **Reproduced first.** A deliberate error-level violation appended to
  `sentry.shared.ts` — `export const kiRepro: any = 1;`, hitting
  `@typescript-eslint/no-explicit-any`, which resolves to `error` for that
  file — was invisible to the lane and visible by hand:

  ```
  $ pnpm --filter web lint
  > eslint src
  .../src/components/ui/dialog.tsx
    30:11  warning  Unused eslint-disable directive ...
  ✖ 1 problem (0 errors, 1 warning)
  EXIT=0

  $ npx eslint sentry.shared.ts
  .../apps/web/sentry.shared.ts
    164:23  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  ✖ 1 problem (1 error, 0 warnings)
  EXIT=1
  ```

  Green lane, red file: the gap as filed, in one pair of commands.

  **Cause.** Not a rule and not an exemption — a file list. `"lint": "eslint
  src"` hands ESLint one directory, and the flat config's `files` globs never
  get the chance to disagree, because the twelve root files are never
  enumerated in the first place.

  **Fix, one word: `"lint": "eslint src '*.ts'"`** (`apps/web/package.json`).
  The pattern is quoted so it reaches ESLint rather than being expanded by the
  shell npm runs the script in. Measured before the regression test below was
  added, `eslint '*.ts' -f json` reported **12 files linted, 0 errors, 0
  warnings** — exactly the twelve the entry names, all clean, so the widening
  is the no-op the entry predicted. Nothing needed fixing and no disable was
  added. (The root set is thirteen now, and still clean: the new
  `lint-scope.test.ts` is itself covered by the widened script.)

  **The config walls did not leak onto config files, and that was checked
  rather than assumed.** Every wall block in `eslint.config.mjs` (the
  domain/server wall, the gateway chokepoint, the auth-config wall, the
  element wall) is scoped `files: ["src/**/*.{ts,tsx}"]`, so none of them can
  match a root file. Confirmed per file with `eslint --print-config`: for all
  twelve, `no-restricted-imports`, `import/no-restricted-paths` and
  `no-restricted-syntax` are all `undefined`. The root files get the shared
  `next/core-web-vitals` + `next/typescript` baseline and nothing else —
  `eslint.config.mjs` needed no change.

  **Regression test added,** `apps/web/lint-scope.test.ts` (registered in
  `vitest.unit.config.ts`'s node-project include list, alongside the
  root-level test files whose presence there is what made this asymmetry
  visible). It reads the `lint` script out of `package.json` and asserts every
  root-level `*.ts` file is matched by one of the arguments, rather than
  pinning the script's text — `eslint src '*.ts'`, an explicit file list and
  `eslint .` are all correct answers; only a shape that leaves a root file
  unread is wrong. Reverting the script to `eslint src` fails it with the
  whole set named:

  ```
  AssertionError: not linted by `eslint src`: expected [ 'drizzle.config.ts', …(12) ] to deeply equal []
  ```

  **Proof.** Same reproduction, after the change:

  ```
  $ pnpm --filter web lint
  > eslint src '*.ts'
  .../apps/web/sentry.shared.ts
    164:23  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  .../src/components/ui/dialog.tsx
    30:11  warning  Unused eslint-disable directive ...
  ✖ 2 problems (1 error, 1 warning)
  EXIT=1
  ```

  The deliberate violation was removed afterwards; `git status` shows
  `sentry.shared.ts` unmodified. Per `minimal-check-subset` (changed files
  `apps/web/package.json`, `apps/web/vitest.unit.config.ts`,
  `apps/web/lint-scope.test.ts` → `web`; nothing under
  `packages/contracts/src`): `pnpm --filter web lint` clean (same single
  pre-existing `dialog.tsx` warning as before the change, plus 13 more files
  read and nothing new found), `pnpm --filter web typecheck` clean, `pnpm
  --filter web exec vitest run -c vitest.unit.config.ts lint-scope.test.ts`
  2/2. `vitest list -c vitest.unit.config.ts --filesOnly` confirms the include
  edit added `[node] lint-scope.test.ts` and disturbed no other collection.
  Not run, deliberately: `test:int` (claims the `postgres` lease), e2e, and
  the full `pnpm check` — no product code changed, and a full run under
  concurrent agents is the load condition KI-13 documents.

  **The entry's sibling question, answered and left alone.**
  `scripts/check-lint-wall.mjs` does *not* share the blind spot: it writes a
  fixture and invokes `pnpm --filter web exec eslint <relative-path>`
  directly, never the `lint` script, so its coverage does not depend on that
  script's arguments. It fixtures only under `src/`, which is correct — the
  walls it tests are `src`-scoped by design. `scripts/check-color-wall.mjs`
  was not audited here; it is outside this entry's Area.

  **Noticed and left alone:** `src/components/ui/dialog.tsx:30` carries an
  unused `eslint-disable` for `no-restricted-syntax`, which `pnpm --filter web
  lint` has been reporting as a warning both before and after this change.
  Pre-existing, outside this entry's Area, and warning-level so it does not
  fail the lane.
