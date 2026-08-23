---
name: worktree-hygiene
description: Audit git worktrees in travel-collab for staleness and scope drift — dead launch.json entries, worktrees safe to remove, and a worktree's branch carrying more commits than the PR it represents. Read-only/reporting: surfaces findings, never deletes or rewrites anything itself. Use when starting a session, before finishing a branch, or when .claude/launch.json seems out of date.
---

# Worktree hygiene audit

A read-only audit. It produces a findings list. It never removes a
worktree, deletes a branch, rewrites history, or edits `.claude/launch.json`
itself — those are separate, human-approved steps.

## Procedure

1. **Enumerate worktrees.**
   ```
   git worktree list --porcelain
   ```
   Note each worktree's path and branch. This is the ground truth for every
   check below.

2. **Check for safe-to-remove worktrees.** For each non-main worktree:
   ```
   git merge-base --is-ancestor <branch> main && echo "<path>: branch fully merged, safe to remove"
   ```
   Report matches as candidates for removal. Do not run `git worktree remove`
   — just list them.

3. **Check for scope drift against an open PR.** If a worktree's branch
   corresponds to an open PR, compare the worktree's actual commit count
   against what the PR claims:
   ```
   git rev-list --count <merge-base>..<worktree-branch>
   gh pr view <PR-number> --json commits --jq '.commits | length'
   ```
   A large mismatch means the worktree carries commits beyond what the PR
   represents. Flag this explicitly and call out that "merge to main" from
   this worktree would silently carry the extra commits along — do not let
   that be offered as a finishing option without surfacing the mismatch
   first.

4. **Check `.claude/launch.json` staleness.** Read `.claude/launch.json`.
   For each `configurations[].runtimeArgs` entry, extract the `cd <path>`
   target and verify the path still exists on disk. Flag:
   - any entry whose path no longer exists, and
   - any worktree from step 1 that has no corresponding entry at all.

   Fix for both: run `node scripts/sync-launch-config.mjs` from the repo
   root — it regenerates `.claude/launch.json` from live `git worktree list`
   output. Recommend this rather than hand-editing the file.

5. **Never take destructive action.** Output a findings list only:
   worktrees to consider removing, scope mismatches, stale/missing launch.json
   entries. Removing a worktree, deleting a branch, or rewriting git history
   is a separate, explicit, human-approved step — not something this skill
   does.

## Background

For the incidents that motivate this skill, see `AGENTS.md` (~line 138-143)
and `docs/retros/2026-08-16-map-rail-focus-tracking-retro.md`.
