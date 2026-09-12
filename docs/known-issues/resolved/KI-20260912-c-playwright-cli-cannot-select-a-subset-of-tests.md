### KI-2026-09-12-c — the Playwright CLI cannot select a subset of tests in a cloud container: any filter yields "No tests found" — WITHDRAWN, the claim is false; the real cause is a duplicate `@playwright/test` install in agent worktrees (KI-2026-09-12-b)

- **Severity:** cost and iteration speed on the e2e lane (no product impact). It forces the full ~106-test suite for a change that needs one spec, which is the opposite of what `AGENTS.md`'s Tier 2 "narrowest sufficient subset" rule asks for, and it removes the cheap way to watch a single new spec fail before trusting it.
- **Area:** `@playwright/test`'s CLI as invoked in this container, against `apps/web/playwright.config.ts`. Not the specs themselves — reproduced on unmodified files.
- **Symptom:** any test-selection filter — `-g <pattern>`, a `file:line` target, or a lone `test.only` — makes the run print `Playwright Test did not expect test() to be called here` followed by `No tests found`. A filter-free invocation runs the whole suite normally.
- **How it is known to be real:** observed 2026-09-12 while closing **KI-2026-09-05-b**, and reproduced identically against **completely unmodified spec files** (for example `m1-board.spec.ts`), which rules out the spec being edited as the cause.
- **What it cost, concretely:** KI-2026-09-05-b's fix ships an e2e regression test (`m14-notebook-widgets.spec.ts`, *"the mode toggle stays reachable after scrolling to the bottom of a long page"*) that **has never been executed**, because executing just that spec is exactly what this defect prevents. The fix itself was proven instead by driving `chromium` directly and measuring the toggle's bounding box before (`y: -1270`, out of viewport) and after (`y: 68`, in viewport) — a real proof of the *fix*, but not of the *test*. Per CLAUDE.md rule 3 a test never seen fail is a claim rather than a control, so that spec is owed a red-first run on the full `pnpm --filter web test:e2e:ci-like` lane.
- **Scope:** find why `test()` is being seen "in the wrong place" under filtering — a likely suspect is the config's `laneReporter`/project wiring interacting with how the filtered run loads files, given `playwright.config.ts:11` already registers that reporter only when `CI` is unset (see KI-2026-09-07-d). Establish whether this reproduces outside a cloud container.
- **Why not fixed here:** found during the 2026-09-12 sweep while closing a different entry, and the sweep's rule is to fix exactly one issue per unit and report the rest. It is also plausibly environmental rather than repo code, which `docs/guidelines/cloud-agent-sessions.md` is the place to confirm or deny.
- **First noted:** 2026-09-12, during the overnight KI sweep, while closing KI-2026-09-05-b.


- **WITHDRAWN 2026-09-12, same day, on Mitchell's challenge — and the entry should not have been filed in this shape.** It was written from a sweep agent's report without the filing session reproducing it. Reproduced properly on the main checkout, every documented filter form works. Verbatim:

  ```
  $ NODE_OPTIONS=--import=./scripts/preload-dotenv.mjs pnpm exec playwright test --list e2e/m1-board.spec.ts
  Listing tests:
    [setup] › auth.setup.ts:17:1 › authenticate as alice
    [desktop] › m1-board.spec.ts:5:1 › board: days, activities, drag, conflicts as data
    [desktop] › m1-board.spec.ts:82:1 › board: scrolling to either end selects the first and the last day
  Total: 3 tests in 2 files

  $ ... playwright test --list e2e/m1-board.spec.ts:82
  Total: 2 tests in 2 files

  $ ... playwright test --list -g "drag"
  Total: 4 tests in 3 files
  ```

  The same three forms also work through the full workspace path, `pnpm --filter web test:e2e --list <filter>` — `scripts/with-test-db.mjs` forwards them correctly (`const [command, ...args] = withPort ? argv.slice(1) : argv`, then `spawn(command, args)`), so neither pnpm nor the wrapper eats them.

- **What the agent actually hit.** `"Playwright Test did not expect test() to be called here"` is the error Playwright raises when **two different instances of `@playwright/test` are loaded at once** — the runner resolving one copy while a spec file imports another. That is exactly the state an agent worktree is in: it carries its own `node_modules`, so `@playwright/test` resolves to `.claude/worktrees/agent-<id>/node_modules/.pnpm/@playwright+test@1.62.1/...` while the main checkout has its own copy of the identical version at `/home/user/travel-collab/node_modules/.pnpm/@playwright+test@1.62.1/...`. Same version, two physical paths, two module identities.
- **So this is `KI-2026-09-12-b`, not a CLI or config defect** — it is another consequence of agent worktrees being provisioned outside the `SessionStart` hook and hand-installing their own dependencies. Fixing the provisioning fixes this with it. Nothing in `playwright.config.ts` or `apps/web/package.json` needs to change.
- **The correct way to run one spec, from the installed CLI's own `--help` (1.62.1)** — `Usage: playwright test [options] [test-filter...]`:
  - one file — `pnpm --filter web test:e2e e2e/m14-notebook-widgets.spec.ts`
  - one test — `... test:e2e e2e/m14-notebook-widgets.spec.ts:42` (file:line)
  - by title — `... test:e2e -g "the mode toggle stays reachable"`
  - collect without running — add `--list`
  - and for a real verdict, the `ci-like` lane still applies (CLAUDE.md rule 1): `pnpm --filter web build` once, then `CI=true pnpm --filter web test:e2e <filter>`.
  Also worth knowing: `--last-failed` re-runs only the previous run's failures, and `--only-changed [ref]` runs only specs changed against a git ref.
- **Cost of the error:** KI-2026-09-05-b's e2e regression test was recorded as unrunnable and shipped unexecuted on that basis. It is runnable by file. That debt is real but cheap to discharge, and this entry was the reason nobody tried.


- **CORRECTION, later the same day — the withdrawal's verdict was right, its explanation was wrong.** Above, this was attributed to two copies of the *same* version (1.62.1) in an agent worktree. Traced properly, it is simpler and worse: **this container image ships a global Playwright `1.56.1` at `/opt/node22/bin/playwright`**, while the repo pins `1.62.1` at `apps/web/node_modules/.bin/playwright`. Playwright's own error text names this exactly — *"You have two different versions of @playwright/test"* — and it is literally two different versions, not two paths to one.
- **When each wins.** `pnpm run` puts `node_modules/.bin` on PATH, so anything reached through `pnpm --filter web test:e2e …` gets 1.62.1 and works — which is why the reproduction above passed. `apps/web/scripts/with-test-db.mjs` then `spawn`ed the bare name `playwright`, so invoking the wrapper one step lower (`node scripts/with-test-db.mjs --with-port playwright test …`) resolved 1.56.1 off the ambient PATH and produced the original error. Correct PATH was a property of *how the script was invoked*, not of the script.
- **Fixed, not just documented.** `with-test-db.mjs`'s `runChild` now prepends the workspace `.bin` directories to the child's PATH. Proven: the exact direct invocation that failed with `Error: No tests found` now lists `Total: 3 tests in 2 files`, with no PATH help from the caller.
- **What this means for anyone re-reading the entry:** the headline claim stays false — the CLI filters files, `file:line` and `-g` perfectly well. But "it worked when I ran it through pnpm and failed when the agent ran it" now has a precise cause, and an agent worktree is not required to hit it.
