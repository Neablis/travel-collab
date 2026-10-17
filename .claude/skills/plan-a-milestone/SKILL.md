---
name: plan-a-milestone
description: Plan a travel-collab milestone before any code — find it, settle its open decisions with Mitchell (with an interaction sketch for UI-heavy parts), name the session, open the prose-only part 0, split the work into parts that each target main, and create one sidebar task per part. Loaded by build-a-milestone; ends when the plan and the tasks exist.
---

# Plan a milestone

`docs/guidelines/building-a-milestone.md` §1 is the source. You run this yourself; a subagent may
do the code survey.

1. **Find it.** Run `pnpm state`, and read `docs/STATUS.md` and the milestone file in full. If the
   README, `TODO.md`, STATUS or the milestone file disagree about which milestone is current or
   whether it is scoped, say so first.
2. **Review the decisions with Mitchell.** Have a subagent survey the code each decision touches,
   with file and line references. Ask each open decision in plain language, with a recommendation
   (`AskUserQuestion`, recommended option marked). Nothing is built on an unanswered decision.
   - **For a UI-heavy part, show the interaction model** in the same review: a few lines on how it
     is driven, such as the palette's *Action › Type › Target*, with what each key and click does.
     M41's palette was redesigned twice after Mitchell played with its preview.
3. **Name the session** after the milestone: `set_session_title` with its own session id.
4. **Open part 0** on the session's designated branch, after merging `main` into it. It is prose
   only: the answered decisions in the milestone file, any ADR, the plan in `docs/plans/` (per
   part: its theme, **the files it touches with each entry point and its test file**, and what to
   click on its preview; one `Explore` survey produces the lists, and a builder's brief is refused
   without them), and a PR body that tracks the gate.
   Pick migration, ADR and KI numbers only after that merge. **Open it as a draft**; it is marked
   ready only at the gate (`close-a-milestone`). Its branch must not look like a part's
   (`claude/m<N>-part<K>-…`), so the part-only hooks leave it alone. Do not subscribe to it:
   unsubscribe if opening it subscribed you, and arm the first check-in (`build-a-milestone`).
   Part 0 merges last.
5. **Split the parts.** One theme each, under about 80 reviewable files. Each part's branch is
   `claude/m<N>-part<K>-<slug>`, K from 1 and N with an optional letter (`m48a`), e.g.
   `claude/m42-part2-drawer-is-cards`; the hooks
   recognise a part by that name (`scripts/hooks/lib/part-branch.mjs`).
   - **Every part targets `main` and merges on its own when ready.** No part is based on part 0
     or on another part. A part that needs an earlier one waits for it to merge to `main`, then
     branches from `main`.
   - **An unattended run (overnight, nobody merging) may stack instead** (Mitchell,
     2026-10-17): part K+1 branches from part K's head and its PR targets part K's branch.
     GitHub retargets it to `main` only if K's branch is deleted on merge; otherwise retarget it
     (`github-rest`, `PATCH pulls/<n> -f base=main`, after `stacked-prs.md` §4's diff check).
     The morning's job is to merge in order. Say in each stacked PR's body which PR it waits on.
   - **Decisions are answered before an unattended run starts.** Step 2 is the only step that
     needs Mitchell in the room; an overnight session that reaches it stalls until morning, so
     it runs the evening before, and the brief says every decision is settled.
6. **Create the sidebar tasks**: one for the decisions, one per part, and one for the gate close.
   Each part's task lists its steps, ticked as the part moves:
   build → test seen red → scoped checks → push (opened ready, not draft) → review → fixes →
   CI green → merged.

Done when part 0 is open, the plan names every part, and the tasks exist. Next: `build-a-part`.
