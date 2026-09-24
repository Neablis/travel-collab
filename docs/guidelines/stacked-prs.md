# Stacked PRs

This guide is for work too big for one reviewable PR, such as a whole milestone. It explains how to
plan a stack, merge it, get it reviewed and finish it. It was written from the first time the repo
did this: M14 on 2026-09-24, as #222 → #223 → #226 → #221. That session's retro,
`docs/retros/2026-09-24-m14-stacked-prs-retro.md`, has the evidence for each rule below.

`AGENTS.md` still owns the Definition of Done, the verification tiers and *CodeRabbit is Mitchell's
step*. This file only adds what changes when there are several PRs instead of one.

## 1. Plan the stack when you plan the scope

- Ask the size question when the scope is agreed, not when the PR is done. Anything bigger than
  about **80 reviewable files** is a stack.
- **Budget ~80 files per part, not 100.** CodeRabbit **skips** a PR over 100 reviewable files; it
  does not review part of it. Review fixes and preview feedback always add files. M14's first cut
  had 5–14 files of headroom per part, and part 3 went over the same afternoon.
- **Name each part's theme before writing code**, and build each part on its own branch from the
  start. Cutting parts backwards out of finished history works, but every fix afterwards is harder.
- **Open code PRs fresh, in stack order.** Don't reuse a docs PR's number for code. When the
  lowest-numbered PR merges last, the numbers stop telling anyone the order.
- Each part's body states its position (`Part 2 of 4`), its base, and the merge order.

## 2. Keep `main` moving into the stack, and check ids when it lands

When something merges to `main` under an open stack, merge `main` into **part 1** and carry it
upward (see §3). Then, **before anything else, run `pnpm lint` on the merged tree.** What it catches:

- **Known-issue ids collide.** Ids are handed out per day by letter on each branch, so two branches
  open on the same day pick the same letters. Rename the side with fewer citations, and update every
  citation of it.
- **The same problem solved twice.** M14 ended up with two network guards in `vitest.setup.ts`.
  Check the merged tree for duplicated setup, not only for conflict markers.
- **New lint rules** from `main` apply to your older files too.

## 3. Fixes go to the lowest part they touch, then merge forward

- Put a fix on **the lowest part whose code it changes**, even if the feedback arrived on the top
  part's preview. Then merge that part into the next one up, and so on to the top.
- **Never push to a part while its CodeRabbit review runs.** A push aborts it (see `AGENTS.md`).
  Hold the forward merge at that part until the review finishes.
- The top part's preview is where the whole milestone can be seen, so review happens there. Its
  fixes count against *its* file budget only when they belong to it. If it is heading over budget,
  open a new part instead of growing it.

## 3a. Budget review time, and self-review first

CodeRabbit has three limits that matter for a stack:

| Limit | Effect on a stack |
|---|---|
| ~1 review per hour (free plan) | A four-part stack needs **four hourly slots**, plus one for every re-review. Plan for the rest of a day. |
| 100 reviewable files | It skips the review entirely. See §1. |
| A push during a review aborts it | Fixes to lower parts must wait before being merged forward (§3). |

- **Self-review each part before asking CodeRabbit**, not as the fallback when it fails to run. On
  M14 the fallback self-review of the top part found five real bugs.
- Request reviews **in merge order**, one per slot, so the lowest part is always furthest along.

## 4. Merge with "Create a merge commit", and know the squash recovery

**Use "Create a merge commit"** for every part. A squash merge rewrites the lower part as one new
commit on `main`. The part above is built on the original commits, so Git sees every shared line as
changed on both sides. The next part then conflicts on almost every file both parts touched, and
its diff shows the lower part's changes again.

**If a part was squashed anyway,** do this on the next part up:

```sh
git fetch origin main
git merge <old tip of the squashed part>   # usually already an ancestor; a no-op then
git merge -s ours origin/main              # record main as merged, change no file
git diff origin/main HEAD --stat           # MUST equal this part's own diff
```

The last line is what makes it safe. `-s ours` keeps this branch's tree unchanged. That is correct
only because `main`'s content equals the old part tip, which this branch already contains. Check
that the diff against `main` lists exactly this part's files and line counts before pushing. Then
retarget the PR to `main`.

## 5. The whole-stack check runs before the first merge

A stack spreads final review over several merges, and none of them feels like the last. So:

- Run the **Tier 3** checks from `AGENTS.md` on the **top** part, which contains everything, while
  it is still unmerged: `pnpm check`, every ci-like spec the stack touches, and the preview walk.
  Record the result in **part 1's** body.
- Tick the milestone gate boxes the stack satisfies at the same point, with evidence. A box the
  stack cannot satisfy stays open, and part 1's body says so.
- Tell Mitchell, in chat, what is still owed **before** part 1 merges. Merging each part is his
  decision. The job here is to make sure that decision is made knowing what's left.

## 6. Git hygiene in a many-worktree session

- **No stash.** The stash is shared between worktrees (see the worktree rule in the session
  environment). Set work aside with a WIP commit instead.
- **To see a test fail, copy the file out, don't check it out.** Copy the source file to the
  scratchpad, break it, run the test, then copy it back. `git checkout -- <file>` also throws away
  any uncommitted edit you made to that file.
- **A `git merge` that commits itself** leaves nothing for a following `git commit` in an `&&`
  chain, and the chain stops there. Check `git status` after a merge instead of assuming a commit
  is still needed.
- Run `pnpm install --offline` in each worktree. Do not symlink `node_modules` between them.

## 7. Subagents building parts in parallel

- **Check on every running agent about every 30 minutes.** If one has written no new output since
  the last check, ask it for status then. On M14, four agents sat stalled for three hours because
  nobody asked.
- **When an agent says it's done, check it ran its tests first.** If a permission denial or anything
  else stopped it from running them, treat the work as untested. Run the checks yourself before
  merging it.
- Squash an agent's `wip` commits into one conventional commit when merging its branch.
