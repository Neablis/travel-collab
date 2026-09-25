### KI-2026-09-22-a — JSDoc is the convention as of today, and most of the repo does not follow it yet

- **Severity:** cleanup with a standing cost (a red pre-merge row on every PR
  until the gap closes), not a defect. Nothing is broken and nothing is blocked.
- **Area:** every file that carries its reasoning in `//` above the symbol —
  which is most of them — plus `.coderabbit.yaml`'s pre-merge check block and
  wherever the convention ends up written down (`docs/guidelines/`).

- **THE DECISION, which is what this entry exists to record.** `KI-2026-09-20-i`
  asked whether this repo wants JSDoc as a convention and laid out three honest
  answers, noting that *"leaving it as-is is the one answer with an ongoing
  cost"*. **Mitchell answered on 2026-09-22: yes — answer 1.** JSDoc is the
  convention, and the 80% threshold is a floor worth having.

  **Deliberately not done in the same breath**, also Mitchell's call: *"let's do
  it in a ki not now"*. So this is the work, filed, unscheduled — and the
  decision is no longer the blocker it has been on the last three PRs.

- **Symptom until it lands:** the **Docstring Coverage** pre-merge check keeps
  failing as a ⚠️ warning. Measured: **66.67%** on PR #198 (9 functions, 7
  files), **51.39%** on PR #199 (72 functions, 17 files), **41.18%** on PR #201
  (M13's five links). The trend is down because the newer work adds tooling and
  components whose reasoning is long and lives in `//` blocks — the convention
  those files were written to.

- **What it is NOT.** Not a request to convert everything at once. The prose is
  already written in every one of these files; what is wrong is its shape, and
  a big-bang rewrite would touch hundreds of files to move text that already
  says the right thing. `KI-2026-09-20-i` already records that converting the
  e2e helpers *"for a number rather than for a reader"* would make those files
  internally inconsistent — that objection survives the decision and shapes how
  it is applied.

- **What it would take, in the order that keeps each step cheap:**
  1. **Write the convention down** in `docs/guidelines/` — what gets JSDoc
     (at minimum every exported symbol), what `//` above the symbol is still
     right for (a decision, a citation, a war story), and how the two combine
     on the same symbol. Without this, a codemod encodes an unwritten rule.
  2. **A lint rule** carrying it, so new code lands documented and the
     percentage stops being the only enforcement. The repo's walls
     (`check-lint-wall.mjs` and friends) are the precedent: `KI-2026-09-20-i`'s
     own line is that *"the wall this repo actually enforces is
     `check-lint-wall.mjs`, not a coverage figure"* — this is what it takes for
     that to stop being an objection.
  3. **Apply as files are touched**, not in one pass, with the threshold raised
     to meet reality rather than reality forced to meet the threshold in one
     commit. Step 2 is what stops the gap re-opening while step 3 runs.

- **The one thing to decide when it is scheduled:** whether the 80% floor is
  measured repo-wide (where it stays red for months while step 3 runs) or on
  changed files (where it is meaningful from the first PR). The second is the
  reason step 2 exists.

- **STEPS 1 AND 2 LANDED 2026-09-23; STEP 3 IS THE ONGOING PART, BY DESIGN.**

  1. **The convention is written down** — `docs/guidelines/commenting.md`, in
     the index. JSDoc on every exported function and class; `//` above the
     symbol still right for a decision, a citation or a war story, and placed
     ABOVE the JSDoc rather than instead of it. One sentence is enough and tags
     are mostly unnecessary, because a wall that produces ceremony gets routed
     around.
  2. **The wall carries it** — `scripts/check-docstring-wall.mjs`, in
     `pnpm lint`, with its own tests under `scripts/__tests__/`. A NEW exported
     function or class without JSDoc fails the lane. **470 that predate the
     decision are grandfathered** in `scripts/docstring-wall-baseline.json`
     (991 exported functions and classes across 541 files, 52.6% documented),
     and the list can only shrink: a baseline entry whose symbol has since been
     documented, renamed or deleted ALSO fails, with the instruction to delete
     the line. That second half is this entry's own step-2 requirement — *"what
     stops the gap re-opening while step 3 runs"* — and it is the mechanism
     `reportUnusedDisableDirectives: "error"` already provides for
     `KI-2026-09-02-b`'s backlog.
  3. **Apply as files are touched.** Unchanged, and deliberately not scheduled:
     touch a function in the baseline, document it, delete its baseline line.
     Nobody is asked to clear 470 in one pass — this entry rules that out in
     writing and that ruling stands.

- **THE OPEN DECISION IS ANSWERED, AND BY MEASUREMENT RATHER THAN BY CHOICE.**
  This entry's *"one thing to decide when it is scheduled"* was whether the 80%
  floor is measured repo-wide or on changed files. **It was already changed
  files.** The check's own reports say so — "9 functions across 7 files" on
  #198 and "72 functions across 17 files" on #199, against a repository with
  541 source files. So the floor is meaningful from the first PR, no ratchet is
  needed, and the percentage will move as step 3 runs rather than sitting red
  for months.

  `.coderabbit.yaml` now carries `reviews.pre_merge_checks.docstrings` at
  `mode: warning, threshold: 80`, so the number is one this repo picked rather
  than a default it inherited. `warning` and not `error` on purpose: the
  absolute enforcement is the wall, which cannot be carried by a large
  well-documented diff the way a percentage can, and blocking PRs on a gradient
  while the grandfathered backlog is still being worked through would punish
  people for a backlog nobody is asked to clear.

- **Found by:** `KI-2026-09-20-i`, filed 2026-09-20 from PR #198's leftovers and
  re-confirmed on #199 and #201. That entry asked the question; this one carries
  the answer and the work. It stays open as the record of the three options and
  why the check behaves as it does.
- **First noted:** 2026-09-22.
- **Re-verified 2026-09-25 (overnight sweep):** still true. This is step 3, the ongoing part, and it is shrinking as designed. `node scripts/check-docstring-wall.mjs` prints `docstring wall OK (656 files, 1260 exported functions/classes, 65.5% documented, 435 grandfathered)`, and `scripts/docstring-wall-baseline.json` holds 435 entries. At landing the numbers were 470 grandfathered, 991 functions and classes across 541 files, and 52.6% documented; the figures above are from landing, not current. The wall runs in `pnpm lint` (`package.json:22`), and the check is at `.coderabbit.yaml:75-77`. `KI-2026-09-20-i` moved to `resolved/` in this sweep; this entry now carries the whole remaining gap.
