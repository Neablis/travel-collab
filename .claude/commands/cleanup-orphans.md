---
description: Find orphaned PRs, local and remote branches, worktrees, and stale sessions/cloud agents. Reports first; deletes nothing without explicit per-category approval.
argument-hint: "[optional: prs | branches | worktrees | sessions — omit for all]"
---

# Cleanup orphans

Find work that has been left behind. **This command reports. It does not delete
anything until the user approves that specific category**, and it never rewrites
history.

Scope (empty means all): **$ARGUMENTS**

## Step 0 — Find live work before you classify anything

**Do this first.** Call `mcp__ccd_session_mgmt__list_sessions` and note every
session with `isRunning: true`.

A running session's branch, its worktree, and any worktrees its subagents
created are **live work, not orphans** — even though a mid-flight fan-out looks
exactly like abandoned debris: several fresh branches, several `agent-*`
worktrees, no merges yet. Exclude all of it up front and say so in the report.
A `/ki-sweep` in progress is the obvious case, and it produces precisely that
shape.

## Step 1 — Refresh, then audit

```
git fetch origin --prune
```

`--prune` matters: without it, remote-tracking refs for branches deleted on
GitHub linger and look like live branches.

### Orphaned PRs

```
gh pr list --state open --json number,title,headRefName,createdAt,updatedAt,mergeable,isDraft \
  --jq '.[] | "#\(.number) [\(.mergeable)] \(.createdAt[0:10]) \(.headRefName) — \(.title)"'
```

Flag, with the reason:

- **Conflicting** — `mergeable: CONFLICTING`. Dead until rebased.
- **Stale** — open more than ~7 days with no recent update.
- **Superseded** — its head branch is already an ancestor of `main`, meaning
  the work landed some other way:
  `git merge-base --is-ancestor origin/<branch> origin/main`
- **Draft and forgotten** — draft for more than a week.

### Orphaned local branches

```
git for-each-ref --format='%(refname:short) %(committerdate:short)' refs/heads
```

**Exclude `main`, the currently checked-out branch, and any branch checked out
in another worktree before classifying.** `main` is trivially an ancestor of
itself, so a naive merged-check offers it up for deletion; a branch checked out
somewhere cannot be deleted anyway.

For each remaining branch, classify:

- **Merged** — `git merge-base --is-ancestor <branch> origin/main` succeeds.
  Safe to delete.
- **Gone upstream** — its remote branch no longer exists (visible as `[gone]`
  in `git branch -vv`). The PR merged and GitHub deleted the branch.
- **Unmerged and old** — carries commits not on `main`. **Never propose
  deleting these**; report them as work that may be lost, and say how many
  commits would go with it:
  `git rev-list --count origin/main..<branch>`

  **Check whether these are stranded work, not abandoned work.** A branch with
  a small number of real commits and no PR is the signature of a session that
  finished the fix and never pushed — this has already happened here, with
  three KI fixes sitting on local branches while their entries stayed open in
  `docs/known-issues/`. For each unmerged branch, report its commit subjects
  and whether a PR exists, and say plainly whether the work looks finished. A
  branch like this needs a PR, not a deletion.

### Orphaned remote branches

```
git for-each-ref --format='%(refname:short)' refs/remotes/origin \
  | grep -vx 'origin' | grep -v 'origin/HEAD$\|origin/main$'
```

The `grep -vx 'origin'` matters: `refs/remotes/origin` is itself a ref, so
without it the audit reports a branch literally named `origin`.

Flag any already merged into `main` with no open PR — those are leftovers from
merged work.

### Deciding whether unmerged work already landed

Two tempting tests are both **unreliable**, and this has already produced a
wrong read here:

- `git diff origin/main...<branch>` measures from the merge base, so an old
  branch shows a huge diff regardless of what main gained independently.
- `git cherry origin/main <branch>` compares patch-ids, which do not survive a
  squash-merge — every commit reports as new even when the work is on main.

The test that actually works is PR history for that head branch:

```
gh pr list --state all --head <branch> --json number,state,mergedAt \
  --jq '.[] | "PR #\(.number) \(.state) \(.mergedAt[0:10] // "")"'
```

If that is empty, fall back to checking whether the branch's distinctive
artifacts exist on main — a file it added, a doc entry it filed:

```
git ls-tree -r --name-only origin/main <path-it-added>
```

State your confidence honestly. "Strong evidence it landed, not certified" is
the correct answer for a large old branch, and the right response to it is to
keep the branch — a local ref costs nothing.

### Orphaned worktrees

Use the `worktree-hygiene` skill rather than duplicating it here. It already
covers merged-branch worktrees, PR scope drift, and stale `.claude/launch.json`
entries, and it is deliberately read-only.

### Stale sessions and cloud agents

List other sessions for this repo and correlate them with PR state:

```
mcp__ccd_session_mgmt__list_sessions
```

A session whose recorded `prState` is `OPEN` while the PR is actually `MERGED`
is stale bookkeeping — those accumulate. Flag sessions whose PR has merged or
closed as archive candidates via `archive_session`.

If Vercel agent runs are in play, `mcp__plugin_vercel_vercel__list_agent_runs`
shows those separately.

## Step 2 — Report before touching anything

Group findings by category. For each item give: what it is, why it is
orphaned, and the exact command that would clean it up. Put anything carrying
unmerged commits in its own clearly-marked section — that is the one category
where cleanup risks losing work.

Then state a one-line summary: how many items are safe to remove, how many
need a judgment call, and how many should be left alone.

## Step 3 — Ask, per category

Ask which categories to act on. Do not offer a blanket "clean everything."

Once approved:

- Merged local branches: `git branch -d <branch>` (`-d`, never `-D` — `-d`
  refuses to delete anything unmerged, which is the safety property you want).
- Merged remote branches: `git push origin --delete <branch>` — confirm each
  one individually; this is not reversible from here.
- Worktrees: `git worktree remove <path>`, then
  `node scripts/sync-launch-config.mjs` to regenerate `.claude/launch.json`.
  If it refuses with "contains modified or untracked files", **look at the
  diff before reaching for `--force`**. Usually it is incidental (a corepack
  `packageManager` rewrite, a stray build artifact) and safe to discard — but
  say what you are discarding. If it is real work, stop and surface it.
  Removing a worktree frees its branch, which may then become deletable —
  re-check the merged list afterwards rather than missing it this pass.
- Sessions: `archive_session`.
- **PRs: never close one yourself.** Report and let the user decide; a stale PR
  often represents a real decision that was never made.

## Hard rules

- Never `git branch -D`, never force-push, never rewrite history. AGENTS.md
  records an incident where a history rewrite in one worktree silently dropped
  a sibling worktree's committed work, and a `PreToolUse` hook exists precisely
  to catch this.
- Never delete a branch with unmerged commits, even if asked casually — surface
  the commit count and confirm explicitly first.
- Deleting a merged local branch is cheap and recoverable; deleting a remote
  branch or closing a PR is not. Treat them differently.
