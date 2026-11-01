---
name: plan-a-milestone
description: Plan a travel-collab milestone before any code — find it, settle its open decisions with Mitchell (with an interaction sketch for every part with user-visible behavior), name the session, open the prose-only part 0, split the work into one stack of parts, and create one sidebar task per part. Loaded by build-a-milestone; ends when the plan and the tasks exist.
---

# Plan a milestone

`docs/guidelines/building-a-milestone.md` §1 is the source. You run this yourself; a subagent may
do the code survey.

1. **Find it.** Run `pnpm state`, and read `docs/STATUS.md` and the milestone file in full. If the
   README, `TODO.md`, STATUS or the milestone file disagree about which milestone is current or
   whether it is scoped, say so first.
2. **Review the decisions with Mitchell.** Have a subagent survey the code each decision touches,
   with file and line references. Ask each open decision in plain language, with a recommendation
   (`AskUserQuestion`, recommended option marked). Nothing is built on an unanswered decision, and **every decision is answered before part 1
   starts**: this is the only step that needs Mitchell in the room, and the build after it runs
   end to end without him (Mitchell, 2026-11-01).
   - **For every part with user-visible behavior, show the interaction model** in the same review: a few lines on how it
     is driven, such as the palette's *Action › Type › Target*, with what each key and click does.
     M41's palette was redesigned twice after Mitchell played with its preview.
3. **Name the session** after the milestone: `set_session_title` with its own session id.
4. **Open part 0** on the session's designated branch, after merging `main` into it. It is prose
   only: the answered decisions in the milestone file, any ADR, the plan in `docs/plans/` (per
   part: its theme, **the files it touches with each entry point and its test file**, and what to
   click on its preview; one `Explore` survey produces the lists, and it returns lists only:
   files, entry points, test files, no code excerpts and no architecture prose; a builder's brief
   is refused without them), and a PR body that tracks the gate.
   Pick migration, ADR and KI numbers only after that merge. **Open it as a draft**; it is marked
   ready only at the gate (`close-a-milestone`). Its branch must not look like a part's
   (`claude/m<N>-part<K>-…`), so the part-only hooks leave it alone. Do not subscribe to it:
   unsubscribe if opening it subscribed you, and arm the first check-in (`build-a-milestone`).
   Part 0 merges last.
5. **Split the parts into one stack.** One theme each, under about 80 reviewable files. Each part's branch is
   `claude/m<N>-part<K>-<slug>`, K from 1 and N with an optional letter (`m48a`), e.g.
   `claude/m42-part2-drawer-is-cards`; the hooks
   recognise a part by that name (`scripts/hooks/lib/part-branch.mjs`).
   - A part's brief names at most about 15 files, its entry points and test files; the full
     scope list stays in the plan by section reference. If the entry points and test files alone
     exceed that, split the part.
   - **The parts are one stack** (Mitchell, 2026-11-01: *"use stacked PRs rather than stop and
     wait for me to merge"*). Part 1 branches from `main` and its PR targets `main`; part K+1
     branches from part K's head and its PR targets part K's branch. Order them so a part comes
     after the parts it builds on. Part 0 stays outside the stack, on the session's branch.
   - **Every part's PR is a draft.** A draft runs no CI; the milestone's one full CI run is on
     the top part's PR, retargeted to `main` and marked ready once every part is done
     (`close-a-milestone` step 1). The top PR is the one that merges; it lands every part.
   - Each part's PR body says `Part K of N`, its base, and *"lands through the top part's PR"*.
6. **Create the sidebar tasks**: one for the decisions, one per part, and one for the gate close.
   Each part's task lists its steps, ticked as the part moves:
   build → test seen red → scoped checks → push (draft PR on the part below) → review → fixes
   → fixes merged up to the top. Add one task for the stack's CI: `main` merged in → top
   retargeted to `main` and ready → CI green → Mitchell's walk → top merged.

**Plan template.** The required contents in step 4 are the source of truth; the shape they go
in is `docs/plans/TEMPLATE.md`, copied from the M46 plan. Start a plan by copying the
template, not by re-deriving the shape: header (milestone, ADR, part 0 branch), path and
line-number conventions, an Order table, shared survey facts, then per part a theme line, a
File / Entry point / Change / Test table, and a preview walk, ending with the gate. If the
template and this skill disagree, the skill wins and the template gets fixed.

Done when part 0 is open, the plan names every part, and the tasks exist. Next: `build-a-part`.
