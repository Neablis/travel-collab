# Dispatch brief

One per unit. The orchestrator fills this. A unit with no acceptance checks
must not be dispatched, and an agent that receives one must refuse to start.

    RUN_ID:       <run id — the run directory is .claude/run/<RUN_ID>/>
    unit-id:      <stable id; names your report file and your board entries>
    worktree:     <absolute path; one worktree per concurrent unit>

    objective:    <one sentence: what is true when this unit is done>

    file-scope:
      - <glob>
      - <glob>

    acceptance-checks:
      - <exact command>            # what its passing output looks like
      - <exact command>

    resources:    <exclusive resources this unit claims, or none>
    depends-on:   <other unit-ids that must reach DONE first, or none>

    context:      <what the agent cannot derive: prior findings, the
                   constraint that shaped this split, what was already tried>

## The parallelisation test

Units may run concurrently only if **all four** hold. Failing any one means
they are sequential, or the split is wrong.

1. **Disjoint file scopes.** No glob overlap between concurrent units.
2. **No interface change among them.** A change to a shared type or schema
   breaks consumers whose own files did not change, so it is always its own
   serialized unit, reviewed before dependent work continues.
3. **No exclusive-resource collision.** Two units may not both claim the
   same resource; the adapter lists which resources are exclusive.
4. **Separate worktrees.** Never a shared working tree.

Splitting by file set alone is not enough. The real serialization points are
resources, not files.

## When a dependency does not reach DONE

A unit whose `depends-on` target ends BLOCKED or DESCOPED is **not
dispatched**. Its brief was written against an assumption that no longer
holds; dispatching it anyway buys an agent that discovers this expensively,
mid-unit, and hands back. Re-plan instead: re-split the blocked unit, merge
the two, or drop both.
