---
description: Show every milestone, where the work actually is right now, what's next, and reconcile the four places status flags can drift out of sync.
argument-hint: "[optional: a milestone id like M10 to drill into]"
---

# Roadmap and current position

Show the full milestone picture and reconcile it against reality.

Drill-down target (may be empty): **$ARGUMENTS**

## Step 1 — Read the four sources

These are four *different* things. Read all of them; do not assume they agree.

1. **`docs/milestones/README.md`** — the milestone table, and at the bottom the
   **"Current milestone"** line. AGENTS.md designates that line the single
   source of truth for the milestone number.
2. **`TODO.md`** — the checklist. The first unchecked item is the current work.
3. **`docs/STATUS.md`** — where the work actually is, including in-flight
   branches. This is the most current and the least formal.
4. **The current milestone's own file** in `docs/milestones/` — its exit-gate
   checklist boxes.

## Step 2 — Reconcile, and report drift loudly

AGENTS.md's gate-close checklist requires four flags to flip **in one commit**:
the `TODO.md` tick, the milestone file's exit-gate boxes, the retro note, and
the "Current milestone" line. A missed flag is a named drift signal — M2 once
stayed unticked this way.

Check for disagreement:

- Does `TODO.md`'s first unchecked item match "Current milestone"?
- Does `STATUS.md` describe work on a milestone other than the current one?
- Does the current milestone file have exit-gate boxes ticked while `TODO.md`
  still shows it unchecked, or vice versa?
- Does any milestone marked done in the table lack a retro note in its file?

If any disagree, **lead with that** — it is more important than the summary.
Say which file you believe and why.

## Step 3 — Ground it in live repo state

The docs describe intent. Check what is actually happening:

```
git log --oneline origin/main -5
gh pr list --state open --json number,title,headRefName,createdAt --jq '.[] | "#\(.number) \(.title) [\(.headRefName)] \(.createdAt[0:10])"'
git worktree list
```

Flag any open PR older than about a week, and any worktree whose branch is
already merged — both are signs work has been left behind.

Also count what is outstanding:

```
ls docs/known-issues/open/ | wc -l       # still open
ls docs/known-issues/resolved/ | wc -l   # closed to date
```

The directory listing is the index — `docs/known-issues/` has no committed
index file, deliberately (see its README, and KI-95).

## Step 4 — Report

Structure the output as:

**Where we are** — the current milestone, its phase if it has one, and what is
in flight right now with branch and PR. One short paragraph.

**The full table** — every milestone with its status. Use three states only:
done (gate closed, with the date), in flight, not started. Mark anything
blocked and say what blocks it. Include the phase groupings from
`milestones/README.md`, since the ordering has been amended by ADR — do not
assume plain numerical order.

**What's next** — the next milestone, what has to pass before it starts, and
any recorded ordering decision (an ADR) that changed the sequence.

**Open gate conditions** — for the current milestone, which exit-gate boxes
are still unticked. This is the actual answer to "what's left."

**Drift and loose ends** — status-flag disagreements, stale PRs, merged
worktrees, and the open-KI count.

If `$ARGUMENTS` named a milestone, additionally: read that milestone's file in
full and summarize its scope, its exit gate, any gate amendments recorded in
it, and which of its phases are done.

## Rules

- Never restate the milestone table from memory. Read the file every time —
  the ordering has already been amended twice by ADR (M10 brought ahead of M9;
  M15 inserted between M10 and M9).
- A gate is closed only when its file says so. "The code merged" is not a
  closed gate, and `TODO.md` says exactly this: check items off when the gate
  passes, not when code merges.
- Keep it scannable. The reader wants position and next step, not a re-read of
  every milestone file.
