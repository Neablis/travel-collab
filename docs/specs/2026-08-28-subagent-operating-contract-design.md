# Subagent Operating Contract — design

**Status:** implemented — `.claude/protocol/`, the four hooks in
`scripts/hooks/`, and `.claude/commands/dispatch.md`
**Date:** 2026-08-28
**Supersedes:** nothing. Extends `AGENTS.md` (binding law) and the three agent
definitions in `.claude/agents/`.

## Why

Agent work here is already delegated by default (`AGENTS.md`, "Working
agreement with Mitchell"), but each dispatch reinvents its own boundaries. What
is missing is not more guidance — it is a *contract*: a fixed shape for how work
is split, how an agent knows it is finished, what it does when it is stuck, how
it warns its siblings, what it reports, and what it tears down.

Three failure classes this repo has already paid for motivate the specifics:

- **Silent verification skips.** Four consecutive M10 phases shipped with a
  Definition-of-Done step skipped and nothing on the PR saying so.
- **Scope sprawl.** A phase branch became a 79-file PR that had to be split
  (PR #23).
- **Premature environmental conclusions.** KI-27 was misdiagnosed as
  environmental twice, the second time costing a day, with the correct entry
  already written and unread.

The third one is why the shared-knowledge mechanism in this design is
deliberately constrained: a broadcast channel for conclusions would industrialise
that exact mistake.

## Scope and the portability boundary

This is a **general operating model** with travel-collab as its first consumer.
The boundary is enforced by file placement, not by discipline:

- `.claude/protocol/CONTRACT.md`, `DISPATCH-TEMPLATE.md`, `REPORT-TEMPLATE.md`
  are **portable**. They must never name travel-collab, its commands, its
  packages, or its milestones. A reviewer should be able to drop them into an
  unrelated repository unchanged.
- `.claude/protocol/ADAPTER.md` and `.claude/protocol/adapter.json` are the
  **only** files carrying repo-specific facts — the same facts in prose and in
  machine-readable form. Porting to another repo means rewriting these two
  files, and nothing else.
- The four hook scripts are portable in logic and read all repo-specific values
  from `adapter.json` and `manifest.json`.

**Design point:** the protocol targets a high-water mark of **2–4 concurrent
units on one phase**. Resource *leasing* is deliberately simple (declared owner
in the manifest, one advisory hook) rather than a real allocator. If runs
routinely exceed ~6 concurrent units, this design should be revisited rather
than stretched.

## Layout

```
.claude/protocol/          portable core — must never name travel-collab
  CONTRACT.md              the one page every subagent reads first
  DISPATCH-TEMPLATE.md     orchestrator fills one per unit of work
  REPORT-TEMPLATE.md       required sections of a final report
  ADAPTER.md               repo-specific facts, in prose, for the agent
  adapter.json             the same facts machine-readable — exclusive-resource
                           patterns the lease hook matches commands against,
                           and the forbidden-token list the portability test
                           enforces the three portable files against
scripts/hooks/
  subagent-file-scope.mjs
  resource-lease.mjs
  subagent-report-conformance.mjs
  run-teardown-reminder.mjs
.claude/commands/
  dispatch.md              orchestrator-side command; writes the manifest
.claude/run/<run-id>/      gitignored automatically by `.claude/*`
  manifest.json            units, declared scopes, resource owners, state
  notes/<ts>-<slug>.md     the board — one file per entry, never appended
  reports/<unit-id>.md     final reports, in the hook-validated shape
```

`.gitignore` gains exactly one line, `!.claude/protocol`, alongside the existing
allowlist entries. `.claude/run/` is ignored by the existing `.claude/*` rule
with no change.

### Delivery

Each of the three files in `.claude/agents/` gains one new first instruction:
read `.claude/protocol/CONTRACT.md` and `.claude/protocol/ADAPTER.md` before
anything else. An agent definition is the only text a subagent is guaranteed to
have in context, so that is where the pointer lives.

This costs roughly two tool calls and 1–2k tokens per agent, which is the budget
`CONTRACT.md` must fit inside. **If the contract grows past about one page, that
is a signal to cut it, not to raise the budget** — a contract nobody finishes
reading is the failure mode this design exists to avoid.

### Locating the run directory from a worktree

Worktrees live at `<main>/.claude/worktrees/<name>`, so the run directory can
never be addressed relatively. Every participant derives it the same way:

```bash
main_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
run_dir="$main_checkout/.claude/run/$RUN_ID"
```

`RUN_ID` is supplied in the dispatch brief.

## Planning and splitting

The protocol does **not** introduce a fourth planning ceremony. Planning stays
whatever the existing classification produces (`superpowers:brainstorming`
spike / bounded / architectural, then `superpowers:writing-plans`, with
`docs/plans/` as the explicitly temporary staging area described in
`docs/plans/README.md`).

What the protocol adds is the artifact between plan and dispatch: the
**dispatch table**. No agent is dispatched before its row exists.

Each row declares:

| Field | Meaning |
|---|---|
| `unit-id` | Stable identifier, used in report filenames and board attribution |
| `objective` | One sentence: what is true when this unit is done |
| `file-scope` | Glob list. The file-scope hook enforces this |
| `acceptance-checks` | The exact commands that will prove it, named *before* work starts. Add-only: an agent may add a check it finds is needed, but may never remove or substitute one |
| `resources` | Exclusive resources this unit claims (see ADAPTER) |
| `depends-on` | Other unit-ids that must reach DONE first |
| `worktree` | Absolute path; one worktree per concurrent unit, per AGENTS.md |

### The parallelisation test

A set of units may run concurrently only if **all** hold:

1. **Disjoint file scopes.** No glob overlap between concurrent units.
2. **No contract change among them.** A `packages/contracts` change breaks
   consumers whose own files did not change (`AGENTS.md` invariant 5), so a
   contract change is always its own serialized unit, reviewed before dependent
   work continues.
3. **No exclusive-resource collision.** Two units may not both claim the
   integration database, a dev-server port, or any other resource listed as
   exclusive in `ADAPTER.md`.
4. **Separate worktrees.** Never a shared working tree — `AGENTS.md` records
   the M3 incident where one worktree's `git reset --soft` dropped a sibling's
   committed work.

Failing any of these means the units are sequential, or the split is wrong.
Splitting by file set alone is insufficient: the real serialization points in
this repo are resources, not files.

### When a dependency does not reach DONE

A unit whose `depends-on` target ends BLOCKED or DESCOPED is **not dispatched**.
The orchestrator re-plans instead: the dependent unit's brief was written against
an assumption that no longer holds, and dispatching it anyway produces an agent
that discovers this expensively, mid-unit, and hands back. Re-planning may
re-split the blocked unit, merge the two, or drop both.

## Lifecycle

**Brief → Orient → Work → Prove → Report → Teardown.**

- **Brief** — orchestrator-side. Produces the dispatch table row and the
  manifest entry.
- **Orient** — the agent's first three actions, in order: read `CONTRACT.md`
  and `ADAPTER.md`; read the board; claim its declared resources. It then
  confirms its brief is valid (see below) before touching any file.
- **Work** — implementation, inside the declared file scope.
- **Prove** — run the acceptance checks named in the brief.
- **Report** — write `reports/<unit-id>.md`; the final message is that content.
- **Teardown** — remove what this agent created.

### Brief validation

**A brief with no acceptance checks is invalid.** An agent receiving one must
refuse to start and hand back immediately, stating the missing field.

This is the structural fix for the silent-verification-skip class: "what would
prove this works" is decided before the work exists, where it cannot be quietly
dropped once the work is tiring.

## Exit criteria

An agent may terminate in **exactly three** states.

**DONE** requires all of:
- Every acceptance check from the brief was run, with the exact command and its
  real output or exit status quoted.
- Every check passed. A check that passed only on retry is a flaky-labelled bug
  and is reported as such, not as a pass.
- No file outside the declared scope was modified.
- The board was updated if — and only if — something portable was learned.
- The agent's own temporary artifacts are gone.

**BLOCKED** — the strike limit was reached, or an invariant / authority wall was
hit. Requires a reproduction, the strikes used, what was tried, a best
hypothesis, and the state the working tree was left in.

**DESCOPED** — the unit was wrong: not reproducible, already fixed, or
mis-scoped. Legitimate and evidence-bearing; `ki-fixer` already models this
(KI-13 was resolved exactly this way).

"Mostly done", "should work", and "could not run the tests but the change is
correct" are **not exit states**. They are BLOCKED.

## Strikes and handback

A **strike** is one failed attempt to get past one blocker.

- **2 strikes on the same blocker → BLOCKED.** The second failed attempt is
  the last one: there is no third. This preserves the existing `AGENTS.md`
  rule ("stop before a third attempt" on the same class of fix) rather than
  introducing a competing threshold.
- **3 distinct blockers in one unit → BLOCKED**, reason *mis-scoped*. Three
  unrelated walls means the split was wrong, not that the agent is failing.
- **Before strike 2** the agent must re-read the board — a sibling may have
  already answered it — and, if the failure looks environmental, run the
  environment probe named in `ADAPTER.md` rather than concluding.

None of the following may ever be used to get past a strike; each is an
immediate BLOCKED with that fact stated in the report:

- Weakening, skipping, or deleting a test.
- Widening the declared file scope.
- Labelling a failure flaky, environmental, or infra without evidence.

**Handback is a success mode.** An agent that stops at strike 2 with a clean
hypothesis has done its job correctly.

### Orchestrator behaviour on handback

The orchestrator **does not debug inline.** Inline debugging reimports exactly
the context that delegation was spending to avoid, and three handbacks would
erase the benefit of the whole model. It does one of:

1. Re-split the unit and dispatch the smaller pieces.
2. Dispatch a fresh debug agent whose brief *is* the handback report.
3. Escalate to Mitchell.

The standing exception in `AGENTS.md` still applies: live, iterative debugging
against a running dev server or browser session cannot be handed off. When the
orchestrator takes that path it must say so explicitly and name the reason.

## The board

Purpose: let a unit that has not yet started avoid a wall a sibling already hit.

**Mechanism, stated honestly.** Subagents are one-shot and have no inbox. A note
written at T+5 cannot reach an agent that read at T+0 and is still running. The
board is a *bulletin board read at defined moments*, not a message bus. Its read
points are therefore mandatory and enumerated:

1. During Orient, before any file is touched.
2. Before strike 2 of any failure.
3. Before claiming an exclusive resource.

**Storage.** One file per entry at `notes/<ISO-timestamp>-<slug>.md`. Never an
append — one file per entry means no lock, no interleaving, and no lost write
when two agents publish at once.

**Entry format:**

```markdown
---
kind: environment | tooling | repo-fact
observed-by: <unit-id>
observed-at: <ISO timestamp>
recheck: <exact command a reader must run before acting on this>
---

**Observation.** What I ran and what it printed, verbatim.

**What I did about it.** (optional)
```

**Three rules carry the anti-poisoning story:**

1. **Entries are observations, never conclusions.**
   `pg_isready -h localhost -p 5433 → exit 2 at 14:32` is an entry.
   "Postgres is down, skip the integration tests" is not.
2. **Every entry carries a `recheck` command, and a reader must run it before
   acting on the entry.** The board can save a reader the diagnosis; it can
   never save them the check. This is the direct guard against the KI-27
   species of failure, where one wrong "environmental" call ends everyone's
   investigation.
3. **The board is run-scoped and dies at teardown.** Nothing durable lives
   here. An entry that would still be true next week is in the wrong place and
   must be promoted before the run directory is deleted.

### When to write, and when not to

**Write** when another agent in this run would hit the same wall *and* the wall
is not about your unit's code:

- **environment** — a service down, a port taken, a stale container, a missing
  local dependency.
- **tooling** — a command that needs a different flag here; a check that takes
  nine minutes rather than one.
- **repo-fact** — something you had to discover, e.g. "this suite cannot be
  scoped file-by-file."

**Do not write** anything about your unit's implementation, your design choices,
your progress, or anything another agent cannot act on. That belongs in your
report.

**The test:** *would an agent working on a completely different unit change what
it does because of this?* If no, it is a report line, not a board entry.
Progress chatter is what makes the two or three genuinely useful entries
unfindable.

## Report contract

The report is written to `reports/<unit-id>.md`, and the agent's final message
is that file's content — authored once, present in two places, because the
orchestrator reads the message while later agents grep the file.

Required sections, in this order (validated by the report-conformance hook):

```
## Exit: DONE | BLOCKED | DESCOPED
## Unit
## Files touched
## Acceptance checks      — each: command, real output or exit status, pass/fail
## Evidence gaps          — what was NOT verified, explicitly
## Findings left alone    — noticed, deliberately not acted on
## Board entries written  — paths, or "none"
## Teardown               — what was created, and what was removed
```

BLOCKED reports additionally require:

```
## Blocker                — reproduction, strikes used, what was tried, hypothesis
## Tree state             — what condition the working tree was left in
```

**Evidence gaps** is deliberate. It mirrors the "Not run, and why" line in
`.github/PULL_REQUEST_TEMPLATE.md`: because the section cannot be omitted, it
must say something, which makes an honest gap cheap and a silent skip
structurally awkward. `AGENTS.md` is explicit that an unchecked box is a fine
outcome and a silent skip is not.

**Findings left alone** feeds `docs/known-issues.md` rather than being lost —
the same intent the existing `phase-implementer` and `ki-fixer` reports already
carry.

## Cleanup

### Agent teardown — mandatory, in-unit, no approval

The agent deletes **only what it created**: scratch files, temporary branches it
made and abandoned, servers or containers it started, and its own resource
lease.

It must never:

- touch another unit's artifacts,
- delete the run directory,
- remove a worktree — **including its own.** An agent removing the tree it is
  standing in is a reliable way to lose uncommitted work. The orchestrator owns
  worktree lifecycle.

### Orchestrator teardown — end of run, approval-gated per category

Follows the existing `/cleanup-orphans` norm: report first, delete nothing
without a per-category yes. Categories:

1. Run directory (board + reports)
2. Worktrees
3. Local and remote branches
4. `.claude/launch.json` entries (`scripts/sync-launch-config.mjs` exists for
   this)
5. Stray containers, dev servers, and held ports

### The promotion gate

**Before any deletion**, every board entry is triaged to exactly one of:

- promoted to `docs/known-issues.md`,
- promoted to an ADR in `docs/architecture/`,
- promoted into `.claude/protocol/ADAPTER.md` (for durable tooling/repo facts),
- explicitly discarded, with a one-line reason.

Deleting a run directory containing an unpromoted durable fact is how the repo
pays to relearn it weeks later. This is the step most likely to be skipped,
which is why hook 4 checks for it specifically.

## Enforcement — the four hooks

All four follow the style of `scripts/hooks/check-destructive-git.mjs`: a Node
`.mjs` script reading a JSON payload on stdin, writing `hookSpecificOutput` on
stdout, and **failing open on any parse or IO error**. Hooks 1 and 2 no-op
entirely when no `manifest.json` is present, so ordinary non-run work is
unaffected.

### 1. `subagent-file-scope.mjs` — `PreToolUse`, matcher `Edit|Write`

Maps the tool call's `cwd` to a unit via `manifest.json` (one worktree per
unit), then checks the target path against that unit's declared globs. Out of
scope emits `permissionDecision: "ask"` quoting the declared scope.

Deliberately `ask`, not `deny`: sometimes the declared scope is genuinely wrong,
and the correct outcome is that someone *notices*, not that the agent is stuck.
This is the direct guard against the PR #23 sprawl.

### 2. `resource-lease.mjs` — `PreToolUse`, matcher `Bash`

Matches the command against the exclusive-command list in `ADAPTER.md`. If the
manifest assigns that resource to a different unit, emits `ask` naming the
holder and the concrete symptom of ignoring it.

This prevents a failure already recorded here: concurrent runs of the
integration suite share one Postgres and produce a different random subset of
failures each run — a symptom that reads as flakiness and burns hours.

### 3. `subagent-report-conformance.mjs` — `SubagentStop`

Reads `transcript_path`, takes the final assistant message, and checks for the
exit state and the required sections. On a gap it exits 2 with the missing
sections named on stderr, which forces the agent to continue and fix its report.
It must guard on `stop_hook_active` so it cannot loop.

**Stated limit: this validates shape, not truth.** It can force an "Acceptance
checks" section to exist; it cannot make the output pasted into it real. That is
still worth having — the M10 failures were silent omissions, not fabricated
evidence — but this hook makes reports *complete*, not *trustworthy*.

### 4. `run-teardown-reminder.mjs` — `Stop`, main session

Fires only when a run directory exists whose manifest marks every unit closed
and whose teardown is unrecorded. Blocks once with the promotion and cleanup
checklist.

The narrow trigger is the point: a `Stop` hook that fires on every turn is
trained away within a day, after which it enforces nothing.

### Coverage limits

- `SubagentStop` fires for **Agent-tool subagents in the current session**. Work
  dispatched as *separate* Claude Code sessions in worktrees — normal for phase
  branches per `AGENTS.md` — does not trigger it. Those sessions still get hooks
  1, 2, and 4, which are per-tool-call or per-session and fire regardless of who
  is driving.
- Hooks 1 and 2 depend on `manifest.json`. If the orchestrator dispatches
  without writing one, both silently no-op. `/dispatch` exists to make that
  omission unlikely; it does not make it impossible.

## `/dispatch` — the orchestrator command

A committed slash command in `.claude/commands/dispatch.md`. Given a plan, it:

1. Allocates a `RUN_ID` and creates `.claude/run/<run-id>/{notes,reports}/`.
2. Emits the dispatch table, applying the four parallelisation tests and
   refusing to mark units concurrent when any test fails.
3. Writes `manifest.json` — the file both `PreToolUse` hooks depend on.
4. Fills one brief per unit from `DISPATCH-TEMPLATE.md`, rejecting any unit with
   no acceptance checks.
5. At end of run, drives the promotion gate and the approval-gated teardown.

## `ADAPTER.md` — travel-collab specifics

The single repo-coupled file. Contents:

- **Binding law pointers** — `AGENTS.md` invariants, the module map, the
  Definition of Done, the UI/server boundary.
- **Exclusive resources** — the docker-compose Postgres; dev-server ports; the
  CI minute budget (`docs/guidelines/ci-cost-and-capacity.md`).
- **Exclusive commands** — `pnpm --filter web test:int` (whole-suite, cannot be
  scoped file-by-file), database reset/reseed, `docker compose up`, dev server
  start.
- **Acceptance-check catalogue** — the `minimal-check-subset` skill; the
  contracts exception requiring full `pnpm check`; and the rule that an e2e
  result counts only from `pnpm --filter web test:e2e:ci-like`.
- **Environment probe** — the exact commands to run before concluding
  "environmental", plus the standing instruction to grep `docs/known-issues.md`
  for the symptom first.
- **Cleanup targets** — worktrees under `.claude/worktrees/`,
  `.claude/launch.json` via `sync-launch-config.mjs`, draft-PR conventions.
- **Promotion destinations** — `docs/known-issues.md`, `docs/architecture/`.

## Risks accepted

1. **Hooks are being built for a protocol that has not yet run once.** The
   likeliest outcome is that one hook is wrong and gets fought. Mitigation: all
   four fail open, hooks 1 and 2 use `ask` rather than `deny`, and hook 4 has a
   deliberately narrow trigger. If a hook misfires twice, delete it rather than
   tuning it.
2. **Per-agent token overhead.** Every subagent reads two files at Orient. At
   2–4 concurrent units this is negligible; it is a real cost at ki-sweep
   scale, and is the second reason `CONTRACT.md` must stay short.
3. **The board may simply go unused.** At 2–4 concurrent units the honest
   expected volume is zero to three entries per run. That is the correct volume,
   not a failure — but it means the board should not accrete features. If three
   consecutive runs produce no entries anyone read, cut it.
4. **Manifest dependency.** Two of the four hooks are inert without
   `manifest.json`.

## Strip-out procedure

To remove the protocol entirely:

1. Delete `.claude/protocol/`.
2. Delete the four scripts in `scripts/hooks/` and their `settings.json`
   entries.
3. Delete `.claude/commands/dispatch.md`.
4. Revert one line in each of the three files in `.claude/agents/`.
5. Remove `!.claude/protocol` from `.gitignore`.

To port to another repository: copy `.claude/protocol/`, the four hook scripts,
and `dispatch.md`; rewrite `ADAPTER.md`; add the first-line pointer to that
repo's agent definitions.
