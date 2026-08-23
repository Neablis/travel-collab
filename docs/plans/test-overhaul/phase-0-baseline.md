# Phase 0 — Baseline and inventory

**Why this is a phase and not a preamble.** Every later phase is judged against
a number. KI-13 is proof that a single run of this suite lies: the same tree has
produced 0, 2, 6 and 9 failures on consecutive runs. If the baseline is one run
on a loaded machine, Phase 5 will "prove" a speedup that is noise, and Phase 4
will "fix" a flake that was an external CPU hog. Measure properly once, commit
the numbers, and no later session has to re-derive them.

**Deliverable:** `docs/testing-baseline.md` (a real doc, not a scratch file) —
deleted at the end of Phase 7 once its durable half is in the guidelines.

---

## Task 0.1 — Measure the suites honestly

Run each of these **three times**, on an otherwise-idle machine, and record all
three. Per KI-13, check `ps aux | sort -rk3 | head` first and note anything
above ~20% CPU in the record.

```bash
ps aux --sort=-%cpu | head -5                      # record the machine's state
pnpm --filter web exec vitest run -c vitest.unit.config.ts --reporter=dot
pnpm --filter @tc/domain test
pnpm --filter @tc/contracts test
pnpm --filter @tc/pages test
pnpm --filter web test:int                          # needs Postgres up
pnpm --filter web test:e2e:ci-like                  # the trustworthy one (KI-27)
```

For each, record the **footer breakdown**, not just wall time:

```
Duration  43.08s (transform 2.86s, setup 10.18s, collect 10.83s,
                  tests 22.51s, environment 58.72s, prepare 5.48s)
```

`environment` vs `tests` is the whole argument for Phase 1 and Phase 5. A run
recorded without it is not useful.

**Known values from 2026-08-23 (4-core sandbox, single runs) to compare
against** — if your numbers differ wildly, your machine differs, not the code:

| Suite | Files | Tests | Wall | `environment` | `tests` |
|---|---|---|---|---|---|
| web unit | 95 | 569 | 43.1s | 58.7s | 22.5s |
| domain | 22 | 129 | 2.6s | 4ms | 0.55s |

## Task 0.2 — Classify every unit test file by the environment it actually needs

The web unit config sets `environment: "jsdom"` for **all** of
`src/**/*.test.{ts,tsx}`. Most `.ts` files there need no DOM at all and pay
~600ms of jsdom construction for nothing.

Write `scripts/classify-test-envs.mjs` (dependency-free ESM, same style as
`scripts/db-reset.mjs`) that prints each web unit test file as `node` or
`jsdom`. A file needs jsdom if it matches any of:

- `*.test.tsx` (renders React)
- imports `@testing-library/*`
- references `document.`, `window.`, `navigator.`, `localStorage`
- imports a module that transitively does any of the above

Then **verify the classification empirically** rather than trusting the
heuristic — run the `node` set with `--environment=node` and check it is green:

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts \
  --environment=node $(node scripts/classify-test-envs.mjs --node-only)
```

**Measured answer as of 2026-08-23 — 35 of 95 files are node-safe.** The four
`.ts` files that look node-safe but are *not*, with the reason (do not
re-discover these):

| File | Why it needs jsdom |
|---|---|
| `src/components/board/resolveDrop.test.ts` | touches DOM APIs directly |
| `src/lib/apiClient.test.ts` | MSW handlers resolve against `window.location` |
| `src/lib/pagesClient.test.ts` | same |
| `src/components/pages/editor/MacroNodeExtension.test.ts` | TipTap/ProseMirror needs a document |

## Task 0.3 — Build the keep/cut inventory

This is the input to Phase 5, and it is the task that actually takes thought.
Produce a table in `docs/testing-baseline.md` with **one row per test file**:

| column | what goes in it |
|---|---|
| file | path |
| tests | count of `it(`/`test(` |
| LOC | line count |
| layer | domain / contracts / pages / web-unit / web-int / e2e |
| **what it protects** | one sentence: the regression it would catch |
| **also covered by** | any other test that would also catch that regression |
| verdict | `keep` / `merge into X` / `cut` / `rewrite` |

Rules for filling `verdict` — apply mechanically, argue later:

- **`cut`** if `also covered by` names a test at a *lower* layer. A conflict
  rule proven in `packages/domain` does not need a rendered-component proof.
- **`cut`** if `what it protects` is a framework's behavior, not ours
  ("Radix opens the dialog", "the heading renders an h2").
- **`cut`** if the only assertions are on `className` — the color wall lint
  already enforces that contract, and better.
- **`merge`** if two files drive the same component through overlapping
  sequences. One test that walks a real flow beats two that each render once.
- **`rewrite`** if it protects something real but does it via prose copy,
  sleeps, or hand-built literals.
- **`keep`** otherwise.

**Do not delete anything in this phase.** The inventory is a proposal; Phase 5
executes it with the safety protocol. Splitting proposal from execution is what
lets a human skim 150 verdicts in one sitting instead of reviewing 150 diffs.

## Task 0.4 — Record the coverage floor for `packages/domain`

Phases 5–6 must not lose domain coverage, and "must not" needs a number.

```bash
pnpm --filter @tc/domain exec vitest run --coverage
```

Add `@vitest/coverage-v8` to `packages/domain` if absent. Record line and
branch percentages for `src/trip/*.ts`. This is the only coverage number this
plan cares about — it is the layer where a lost test means a lost invariant.
Component coverage percentages are deliberately **not** tracked; chasing them
is how the suite got to 85% test-LOC-to-source-LOC in the first place.

---

## Exit checklist

- [ ] Three recorded runs per suite, with `environment`/`tests` breakdowns and
      the machine's CPU state at each.
- [ ] `scripts/classify-test-envs.mjs` exists and its `node` set runs green
      under `--environment=node`.
- [ ] `docs/testing-baseline.md` holds the full per-file inventory with a
      verdict on every row.
- [ ] `packages/domain` coverage numbers recorded.
- [ ] Committed. Nothing deleted, no test content changed.
