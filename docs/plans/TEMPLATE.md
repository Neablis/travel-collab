<!-- Copy this file for a new milestone plan; do not edit it in place.
     This file itself is permanent: it is not a milestone plan, so it is never
     removed at gate close. The plan-a-milestone skill's step 4 is the source of
     truth for what a plan must contain; if this template and the skill
     disagree, the skill wins and this file gets fixed. -->
# <M?> plan — <milestone title>

Milestone: `docs/milestones/<M?>-<slug>.md` (decisions D?–D?, answered <date>). ADR: `docs/architecture/<ADR-?>-<slug>.md` (if any).
Part 0 is the prose-only tracking PR on `<part 0 branch>`; it merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `<sha>`, so treat them as a starting point, not as fact.
**New** marks a file that does not exist yet.

## Order

| Part | Branch | Depends on | Can run beside |
|---|---|---|---|
| 1 <title> | `claude/m<?>-part1-<slug>` | — | — |
| 2 <title> | `claude/m<?>-part2-<slug>` | 1 merged | — |

Every part targets `main`. A part that depends on another branches from `main` after that part
has merged. <Note any files two parts both touch, and which one takes `main` first.>

Facts the parts share (the survey, <date>):
- <One bullet per shared fact: migrations and their numbering, access seams, demo rules,
  precedent files with file:line refs.>

## Part 1 — <title> (~<n> files)

**Theme.** <Which decisions this part covers, and what it deliberately does not do.>

| File | Entry point | Change | Test |
|---|---|---|---|
| <path> | <symbol or line> | <what changes> | <test file> |

<Gate boxes this part carries, if any, each seen red.>

**Preview walk:** <What a person clicks on the preview to see this part's change. "Nothing on
screen" is a valid answer for a server-only part; say how to verify it instead.>

## Part 2 — <title> (~<n> files)

**Theme.** <Which decisions this part covers, and what it deliberately does not do.>

| File | Entry point | Change | Test |
|---|---|---|---|
| <path> | <symbol or line> | <what changes> | <test file> |

**Preview walk:** <What a person clicks on the preview to see this part's change.>

## Gate

<The milestone's exit gate: which e2e boxes read CI on each part's head, and what the walk is.>
