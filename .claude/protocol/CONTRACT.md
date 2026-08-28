# Subagent contract

You are one unit of a planned run; this contract is binding. Read your
adapter (`.claude/protocol/ADAPTER.md`) next — it carries every fact
specific to this repository.

## Lifecycle

**Orient → Work → Prove → Report → Teardown.**

Orient, in order, before you touch any file:

1. Read this file and the adapter.
2. Read the board: `<run-dir>/notes/`. Locate it via
   `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`,
   then `.claude/run/<RUN_ID>/` using the `RUN_ID` in your brief.
3. Confirm your brief is valid. **A brief with no acceptance checks is
   invalid** — refuse to start, name the missing field, and hand back.

## Exit criteria

You may terminate in exactly three states. There is no fourth.

**DONE** requires all of:
- Every acceptance check ran, with its exact command and real output or
  exit status quoted — checks are fixed up front, never decided after.
- Every check passed; one that passed only on retry is a flaky bug, not a
  pass.
- No file outside your declared scope was touched, the board was updated
  only if you learned something portable, and your own temporary artifacts
  are gone.

You may **add** a needed check; you may never remove or substitute one.

**BLOCKED** — you hit the strike limit, or an invariant/authority wall.
Report a reproduction, strikes used, what you tried, your hypothesis, and
the tree state you left.

**DESCOPED** — the unit was wrong: not reproducible, already fixed, or
mis-scoped. Legitimate, and it must carry evidence.

"Mostly done", "should work", and "I could not run the tests but the change
is correct" are not exit states. They are BLOCKED.

## Strikes

A **strike** is one failed attempt to get past one blocker.

- **Two strikes on the same blocker → BLOCKED** — the second failed attempt
  is the last one.
- **Three distinct blockers in one unit → BLOCKED**, reason *mis-scoped* —
  three unrelated walls means the split was wrong.
- **Before strike 2:** re-read the board and, if the failure looks
  environmental, run the adapter's environment probe — don't conclude first.

None of these may ever be used to get past a strike — each is an immediate
BLOCKED, stated as such in your report: weakening, skipping, or deleting a
test; widening your declared file scope; or calling a failure flaky,
environmental, or infrastructural without evidence.

**Handing back is a success mode** — stopping at strike 2 with a clean
hypothesis is doing the job right, not failing it.

## The board

Lets a unit that hasn't started yet avoid a wall you hit. One-shot, no
inbox: read it at Orient, before strike 2, and before claiming an
exclusive resource.

One file per entry, never appended, at
`<run-dir>/notes/<ISO-timestamp>-<slug>.md`:

```
---
kind: environment | tooling | repo-fact
observed-by: <your unit id>
observed-at: <ISO timestamp>
recheck: <the exact command a reader must run before acting on this>
---

**Observation.** What you ran and what it printed, verbatim.

**What I did about it.** (optional)
```

Entries are observations, never conclusions ("X is broken, skip it" is not
one); a reader must run `recheck` before acting. The board dies at
teardown — anything true next week is promoted first (adapter says where).

**Write** when another unit would hit the same wall and it isn't about your
code — environment, tooling, a discovered repo fact. **Don't write** about
your implementation or progress; that's your report. Test: *would a unit on
something unrelated change what it does because of this?* If no, it's a
report line.

## Report

Write `<run-dir>/reports/<your-unit-id>.md`; your final message is that
file's content. Required sections are in `REPORT-TEMPLATE.md` and are
checked mechanically — "Evidence gaps" may say "none" but may not be absent.

## Teardown

Delete **only what you created** — scratch files, abandoned branches,
servers or containers you started, your resource lease. Never touch another
unit's artifacts, delete the run directory, or remove a worktree —
**including your own.** The orchestrator owns worktree lifecycle.
