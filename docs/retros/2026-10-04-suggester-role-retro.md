# Retro: the suggester role, from one PR to five

**Date:** 2026-10-04
**Session:** `session_019MBSVnLQYpRsAYs9Xc6mSf`, 2026-10-03 → 2026-10-04 (context compacted at
least once)
**Requested by:** Mitchell, after #317 merged: *"Can you retro on some of the mistakes made here
while developing and suggest some improvements to prevent them from happening again"*.

The suggester role ("Can suggest") shipped across five PRs:

| PR | What | Merged |
|---|---|---|
| #308 | Part 1/3: contracts, storage (`0036_trip_suggestions`), server | 2026-10-04 06:22 |
| #309 | Part 2/3: invite as Can suggest, role gating | 2026-10-04 14:13 |
| #311 | Part 3/3: suggest mode, ghosts, review | 2026-10-04 14:42 |
| #314 | Follow-ups from Mitchell's production test and preview comments | 2026-10-04 18:40 |
| #317 | One fix pushed a minute after #314 merged | 2026-10-04 18:54 |

The design held up, and so did the server. What cost time was **process**, and the same thing
happened twice: **a passing check stood in for a person using the feature.** Several of these repeat
the M14 retro (`2026-09-24-m14-stacked-prs-retro.md`): the PR was split after the fact, and parallel
agents were run badly. Those lessons were written down and not applied. That is why the actions below
change **checked defaults** (lint, hooks, brief templates) and not just prose.

## What went wrong

### 1. Bugs that reached Mitchell because every check followed the easy path

Mitchell found four of these on production after #311 shipped. All of them had passed unit tests,
e2e and two browser walks:

- The draft tray sat in the page flow under the sticky header, so a suggester editing a day further
  down never saw it. The draft died on reload. Production logs showed no `POST`.
- The owner had to reload to see a suggestion. The 2s poll timer only started if the trip had more
  than one member **when the page loaded** (`TripProvider.tsx:808`). An owner who opened the page
  before the suggester joined never polled.
- Adding a stop and then moving it counted as 2 changes.
- Accept and Dismiss lived only on the board's ghosts, and the chip said "Every suggestion is on the
  board".

**Why:** the e2e and the walk briefs never scrolled before editing. The owner's page was always
opened after the suggester joined, a stop was never edited after it was added, and the walks checked
that controls existed, not that someone new could find them.

### 2. The full suite run far too often

`pnpm check` plus the full ci-like e2e (235 tests, ~6 min, plus setup) ran on each part of the stack,
again after review fixes, and again on #314. That broke CLAUDE.md rule 4, which says the full suite
is a final-review cost paid once, and that CI runs it anyway on push. Mitchell: *"i think you did a
full test pass on like every feature which took way too long"*.

### 3. Independent work queued behind one agent

Mitchell left five preview comments and two CodeRabbit findings on #314, mostly in different files.
They were sent **by message** to one running agent, which worked through them serially for over an
hour. When they were finally split across parallel agents, the first agent's "stop" message arrived
after it had already done most of them. Three of the new agents duplicated work and were stopped.
Mitchell: *"you would have had a lot more success and efficiency if you had parallelized the fixes
using subagents, rather than queuing them"*.

### 4. One branch checked out in two worktrees

Agents committed to `claude/suggester-4-followups` from their worktree while the main checkout also
had that branch checked out. Twice the main checkout showed "uncommitted changes" that were really
the agent's commits in reverse (the index was still at the old head). The stop hook asked for them
to be committed, which would have undone the fixes. They were caught each time with
`git diff --cached <old-head>` coming back empty, then `git reset --hard HEAD`.

### 5. A push to a PR that had just been merged

Mitchell merged #314 at 18:40. `8540c46` was pushed at 18:41, which recreated the deleted branch, so
the fix needed its own PR (#317). The merge event reached this session after the push. Mitchell:
*"i didnt realize you were still developing"*.

### 6. Numbering collisions with `main`

All three of these happened, and each cost a rename or a cleanup:

- **Migration:** `0035` collided with main's own `0035`, and was renumbered to `0036`.
- **ADR:** ADR-063 had already been used twice on main, so this one became ADR-064.
- **Known issue:** KI-20261003-b had been taken on main, so ours became `-g`.

The renamed migration also left stale tables in the shared Neon preview branch. A preview build
failed until they were dropped by hand.

### 7. Statements made from stale information

- "The tray is at the bottom of the page." It was at the top.
- "Production is missing `0036`." Local `origin/main` was out of date; production had all 37
  migrations.
- An agent's work was described as unfinished when most of it had been committed.

### 8. Structure arrived late

The first version was one PR (#304) with no visible task list. Mitchell had to ask
(*"no stacked PRs, not task list to follow along with"*) before it was split into #308/#309/#311.

### 9. Noise

Almost every bot status edit, preview rebuild and stop-hook nudge got its own chat message. That
buried the few updates that mattered: red CI, a finding, or a question for Mitchell.

## Actions

Each action names its file. Implement all of them in one PR.

1. **`docs/guidelines/cloud-agent-sessions.md`: add a "Running subagents in parallel" section.**
   - One scope per agent, with no shared files. Split by file ownership **when requests arrive**,
     not after a queue has formed.
   - Each agent works in its own worktree **on its own branch** (`fix/<pr>-<topic>`). Never on the PR
     branch, and never on a branch another worktree has checked out. The coordinator merges or
     cherry-picks them into the PR branch.
   - Never widen a running agent's scope by message. Messages arrive between tool calls, often after
     the work they were meant to prevent. Start a new agent instead.
   - Before pushing to a PR branch, check the PR is still open (`merged: false`). When more commits
     are coming, tell Mitchell not to merge yet.
   - Fetch before stating the state of `main`, production, a PR or an agent.
   - Stay silent on echoes and status-only bot edits, and report real state changes in batches.
   - Cite this retro.
2. **`AGENTS.md`, Definition of Done: make the testing tiers impossible to misread.**
   - During development, each fix runs only its own subset (rule 4).
   - The full suite runs **once**, when the branch leaves draft. Running it locally is optional
     because CI runs it on push; never run it per part, per fix, or "to be sure".
   - Cite this retro.
3. **The `phase-verifier` agent definition (`.claude/agents/phase-verifier.md`) and any walk-brief
   guidance it points to: realistic scenarios for collaboration features.**
   - Two contexts open at once, the reviewer's page opened **before** the other person joins or acts,
     and never reloaded.
   - Scroll to a later day before editing.
   - Add, then edit, then delete the same item.
   - Phone width.
   - A first-time user finding the primary action without being told where it is.
   - Cite this retro.
4. **`pnpm lint`: an ADR-number collision check.**
   - Find the existing known-issue id collision check (it runs in `pnpm lint`; grep `scripts/` for
     the KI check) and add a sibling that fails when two files under `docs/architecture/` share an
     `ADR-NNN-` number.
   - Main already holds two ADR-063s (see `git log` for the history). Grandfather that pair in an
     explicit allow-list with a comment, rather than renaming files other ADRs cite.
   - Add a test in the same style as the KI check's test, and see it fail first (CLAUDE.md rule 3).
5. **Stop hook: name the stale-checkout case** (`~/.claude/stop-hook-git-check.sh` is the user's own
   hook and not in the repo).
   - If the repo has its own stop or session hook under `.claude/hooks/`, add a check: when another
     worktree has the same branch checked out (`git worktree list --porcelain`), print a warning that
     "uncommitted changes" may be a stale index, and how to confirm it (`git diff --cached <head>`).
   - If no repo hook fits, put the check and the recovery steps in `cloud-agent-sessions.md` instead,
     and say so in the PR.
6. **`docs/guidelines/stacked-prs.md`: decide on a stack at planning time.**
   - Any change expected to touch more than about 3 areas (contracts, server, client, storage)
     starts as a stack, with a visible task list.
   - Merge `main` into the branch at the start of each session, and pick migration, ADR and KI
     numbers only after that merge.
   - Cite this retro and the M14 retro, since this is the second time.
