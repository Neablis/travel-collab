---
description: Plan a protocol run — create the run directory, write the manifest, and emit one brief per unit
---

Set up and drive a subagent protocol run for: $ARGUMENTS

Read `.claude/protocol/CONTRACT.md`, `DISPATCH-TEMPLATE.md`, and `ADAPTER.md`
first. Then:

## 1. Split the work

Produce the dispatch table. Apply the four parallelisation tests from
`DISPATCH-TEMPLATE.md` — disjoint file scopes, no interface change among
concurrent units, no exclusive-resource collision, separate worktrees. State
the verdict for each test out loud. If any fails, the units are sequential;
do not mark them concurrent because it would be faster.

Refuse to create any unit whose acceptance checks you cannot name. A brief
with no acceptance checks is invalid, and an agent receiving one is required
to refuse it — writing one wastes a full dispatch.

## 2. Create the run

    RUN_ID=$(date +%Y-%m-%d)-<short-slug>
    MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
    mkdir -p "$MAIN/.claude/run/$RUN_ID"/{notes,reports}

Write `$MAIN/.claude/run/$RUN_ID/manifest.json`:

    {
      "runId": "<RUN_ID>",
      "createdAt": "<ISO timestamp>",
      "teardown": null,
      "units": [
        {
          "id": "<unit-id>",
          "worktree": "<absolute path>",
          "fileScope": ["<glob>"],
          "state": "open"
        }
      ],
      "resources": { "<resource>": "<unit-id>" }
    }

**The manifest is not bookkeeping.** The file-scope and resource-lease hooks
read it and no-op without it, so a run dispatched without a manifest has no
enforcement at all.

## 3. Dispatch

One worktree per concurrent unit (use `superpowers:using-git-worktrees`).
Fill `DISPATCH-TEMPLATE.md` per unit and dispatch. Do not dispatch a unit
whose `depends-on` target has not reached DONE.

## 4. Close each unit

When a unit reports:

- Confirm `reports/<unit-id>.md` exists. The conformance hook checks a
  report's shape; it cannot catch a report that was never written. **This
  step is the only thing that does.**
- On DONE: set that unit's `state` to `"closed"` in the manifest.
- On BLOCKED: do **not** debug inline — that reimports the context delegation
  was spending to avoid. Re-split the unit, dispatch a fresh debug agent with
  the handback report as its brief, or escalate. A unit whose dependency ends
  BLOCKED or DESCOPED is not dispatched; re-plan instead.
- On DESCOPED: close it and re-check whether dependent units still make sense.

## 5. Teardown

The `Stop` hook will remind you once when every unit is closed. Then:

1. **Promotion gate first.** Triage every entry in `notes/` — promote to a
   known-issue, an ADR, or the adapter, or discard with a one-line reason.
   Nothing is deleted before this.
2. Report the teardown categories and get a **per-category yes** before
   deleting anything: run directory, worktrees, branches, `launch.json`
   entries, stray containers and ports. `/cleanup-orphans` covers most of
   this and already reports before deleting.
3. Record the teardown timestamp in the manifest.
