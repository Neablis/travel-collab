---
description: Show every milestone, where the work actually is right now, what's next, and reconcile the four places status flags can drift out of sync.
argument-hint: "[optional: a milestone id like M10 to drill into]"
---

# Roadmap and current position

Show the full milestone picture and reconcile it against reality.

Drill-down target (may be empty): **$ARGUMENTS**

## Step 1 — Run the digest; read only what it points at

```
pnpm state
```

`scripts/state-digest.mjs` extracts, from the four sources, with a `file:line`
citation on every line: the **Current milestone**, the **first unchecked
`TODO.md` item** and the `← current milestone` marker, the leading block of
**`docs/STATUS.md`**, the current milestone's **exit-gate tally**, open PRs, the
worktree count, and the open-KI titles. It is deterministic — no judgement, no
prose — and it costs about 1,100 tokens.

**Do not re-read `STATUS.md`, `TODO.md` or the milestone README in full to
recover what the digest already printed.** That re-read is what this command
was measured doing, and the digest exists to replace it
(`docs/reviews/2026-09-02-session-tooling-review.md`, F1 and F8: 2,621
orientation reads across 220 sessions, ~1.9M tokens).

Read further only where this turn actually needs more than a fact:

- **`docs/milestones/README.md`'s table** — Step 4 reports every milestone with
  its status, and the digest deliberately prints only the current one. You need
  the table; you do not need the file's prose.
- **The current milestone's own file, at the exit-gate line the digest cited** —
  Step 4's "Open gate conditions" needs the box *text*, not just the tally.
- **Anything the digest flagged as drift** — open those two files at those two
  lines, and only those.

These are still four *different* sources and they are still allowed to
disagree. The digest tells you *that* they disagree; it never tells you which
one is right. Steps 2 and 4 are where you work that out.

## Step 2 — Reconcile, and report drift loudly

The digest has already run four checks mechanically and printed a `DRIFT:` line.
Start from that line; it is a list of mismatches, not a verdict. **The verdict
is this step's job** — a script can see that `TODO.md` and the milestone README
name different milestones, and cannot see which of them records a decision
Mitchell actually made.

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

The docs describe intent. Step 1's digest already ran the live checks —
`git log --oneline origin/main -5`, `gh pr list --state open`,
`git worktree list`, and the open-KI count — so **do not run them again**. Read
the `OPEN PRS`, `WORKTREES`, `ORIGIN/MAIN` and `OPEN KIs` blocks it printed.

If the digest said `OPEN PRS: (gh unavailable)`, that is the one case where you
run the query yourself:

```
gh pr list --state open --json number,title,headRefName,createdAt --jq '.[] | "#\(.number) \(.title) [\(.headRefName)] \(.createdAt[0:10])"'
```

What the digest does *not* do is judge, and this step is the judgement:

- **Flag any open PR older than about a week** — the digest prints creation
  dates and says nothing about them.
- **Flag any worktree whose branch is already merged.** The digest prints only
  a count, on purpose: auditing worktrees for staleness and scope drift is the
  `worktree-hygiene` skill's job, and this command should invoke it rather than
  grow a second copy of it.
- **Resolved KIs**, if the count is relevant: `ls docs/known-issues/resolved/ | wc -l`.
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

- **Never restate the digest.** If `pnpm state` already printed a fact with a
  citation, cite it; do not re-derive it and do not paste it back. This command
  earns its turn on the four things a script cannot do: which source to believe,
  what a drift *means*, whether a PR has been left behind, and what is actually
  left of the gate.
- Never restate the milestone table from memory. Read the file every time —
  the ordering has already been amended twice by ADR (M10 brought ahead of M9;
  M15 inserted between M10 and M9).
- A gate is closed only when its file says so. "The code merged" is not a
  closed gate, and `TODO.md` says exactly this: check items off when the gate
  passes, not when code merges.
- Keep it scannable. The reader wants position and next step, not a re-read of
  every milestone file.
