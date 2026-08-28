# Subagent contract

You are one unit of a planned run. This contract is binding. Read your
adapter (`.claude/protocol/ADAPTER.md`) next — it carries every fact
specific to this repository.

## Lifecycle

**Orient → Work → Prove → Report → Teardown.**

Orient, in order, before you touch any file:

1. Read this file and the adapter.
2. Read the board: `<run-dir>/notes/`. Locate the run directory with
   `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`,
   then `.claude/run/<RUN_ID>/` using the `RUN_ID` in your brief.
3. Confirm your brief is valid. **A brief with no acceptance checks is
   invalid** — refuse to start, name the missing field, and hand back.
   Deciding what would prove the work *after* doing the work is how a
   verification step gets quietly dropped.

## Exit criteria

You may terminate in exactly three states. There is no fourth.

**DONE** requires all of:
- Every acceptance check in your brief was run, with the exact command and
  its real output or exit status quoted.
- Every check passed. A check that passed only on retry is a flaky-labelled
  bug — report it as that, not as a pass.
- No file outside your declared scope was modified.
- The board was updated if, and only if, you learned something portable.
- Your own temporary artifacts are gone.

You may **add** an acceptance check you discover is needed. You may never
remove or substitute one.

**BLOCKED** — you hit the strike limit, or an invariant or authority wall.
Report a reproduction, the strikes used, what you tried, your best
hypothesis, and the state you left the working tree in.

**DESCOPED** — the unit was wrong: not reproducible, already fixed, or
mis-scoped. Legitimate, and it must carry evidence.

"Mostly done", "should work", and "I could not run the tests but the change
is correct" are not exit states. They are BLOCKED.

## Strikes

A **strike** is one failed attempt to get past one blocker.

- **Two strikes on the same blocker → BLOCKED.** The second failed attempt
  is the last one. There is no third.
- **Three distinct blockers in one unit → BLOCKED**, reason *mis-scoped*.
  Three unrelated walls means the split was wrong, not that you are failing.
- **Before strike 2:** re-read the board — a sibling may already have
  answered it — and, if the failure looks environmental, run the adapter's
  environment probe instead of concluding.

None of these may ever be used to get past a strike. Each is an immediate
BLOCKED, with that fact stated in your report:

- Weakening, skipping, or deleting a test.
- Widening your declared file scope.
- Calling a failure flaky, environmental, or infrastructural without
  evidence.

**Handing back is a success mode.** Stopping at strike 2 with a clean
hypothesis is doing your job correctly, not failing at it.

## The board

The board lets a unit that has not started yet avoid a wall you already hit.

It is a bulletin board, not a message bus: you are one-shot and have no
inbox, so a note written now cannot reach a sibling that started earlier and
is still running. Read it at three points — during Orient, before strike 2
of any failure, and before claiming an exclusive resource.

One file per entry at `<run-dir>/notes/<ISO-timestamp>-<slug>.md`. Never
append to an existing file; one file per entry means no lock and no lost
write when two units publish at once.

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

Three rules, and they matter more than the format:

1. **Entries are observations, never conclusions.** A command and its output
   is an entry. "X is broken, skip it" is not.
2. **Every entry carries a `recheck` command, and a reader must run it
   before acting on the entry.** The board can save a reader the diagnosis.
   It can never save them the check. One wrong "environmental" call that
   everyone downstream believes is more expensive than the wall itself.
3. **The board dies at teardown.** Nothing durable lives here. Anything that
   would still be true next week gets promoted before the run directory is
   deleted; the adapter says where.

**Write** when another unit in this run would hit the same wall *and* the
wall is not about your unit's code: environment, tooling, or a repo fact you
had to discover.

**Do not write** about your implementation, your design choices, or your
progress. That is your report.

**The test:** *would a unit working on something completely different change
what it does because of this?* If no, it is a report line. Progress chatter
is what buries the two or three entries that mattered.

## Report

Write `<run-dir>/reports/<your-unit-id>.md`. Your final message is that
file's content — authored once, present in both places, because the
orchestrator reads the message while later units grep the file.

The required sections are in `REPORT-TEMPLATE.md`. They are checked
mechanically. "Evidence gaps" may say "none", but it may not be absent: a
stated gap is a fine outcome, a silent one is not.

## Teardown

Delete **only what you created**: scratch files, temporary branches you made
and abandoned, servers or containers you started, and your resource lease.

Never:

- touch another unit's artifacts,
- delete the run directory,
- remove a worktree — **including your own.** Removing the tree you are
  standing in is a reliable way to lose uncommitted work. The orchestrator
  owns worktree lifecycle.
