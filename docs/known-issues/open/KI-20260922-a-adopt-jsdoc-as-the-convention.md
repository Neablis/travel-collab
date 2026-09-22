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

- **Found by:** `KI-2026-09-20-i`, filed 2026-09-20 from PR #198's leftovers and
  re-confirmed on #199 and #201. That entry asked the question; this one carries
  the answer and the work. It stays open as the record of the three options and
  why the check behaves as it does.
- **First noted:** 2026-09-22.
