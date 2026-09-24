# Retro: M14 in one day, over four stacked PRs

**Date:** 2026-09-24
**Session:** `session_01FZ1MLs3qFvfPPkDkJAXGGX`, 08:13 → 22:59 UTC (about 14¾ hours, context compacted
three times, and the container restarted once)
**Requested by:** Mitchell, after #221 merged: *"this was one of the first times doing this
complicated stacked PR some things were ok, but there was definitely some issues. Can you retro on
this session, identify issues and record them for future improvements? Include context around why
and how they happened."*

All of M14's code landed on `main`, in four squash merges:

| Merge order | PR | Part | Merged |
|---|---|---|---|
| 1 | #222 | 1/4, field widget foundation | 19:42 |
| 2 | #223 | 2/4, saved templates, ghosts, timezones | 20:07 |
| 3 | #226 | 3/4, weather, field-change migrations, authored repeat | 20:51 |
| 4 | #221 | 4/4, preview feedback | 22:59 |

The work itself is not what this retro complains about. Every CodeRabbit finding was checked against
the code and answered. All 19 Vercel preview threads were fixed and resolved. The stale-save race
that CodeRabbit found on #222 was fixed on the server as well as the client. What cost time was
**the process around the code**. Nine things went wrong in a way worth recording, and most of them
come back to the first one.

## Timeline

| Time (UTC) | What happened |
|---|---|
| 08:13 | "Whats the next milestone?" Answer: M24 is current, M14 is next. |
| 08:17–08:38 | Scoping questions for M14: calendar sync dropped, ghosts, the field widget, the widget brainstorm, weather from MET Norway. |
| 08:35 | #221 opened as a **docs** PR: the pre-opening decisions and the brainstorm. |
| 08:43 | "Just make everything on this one PR." M14 is pulled ahead of M24 and built on #221's branch. |
| 08:51–10:06 | 18 implementation subagents are dispatched, most of them running in parallel (40 over the day). |
| ~09:45–12:48 | **Four of them (T08, T11, T20 and T23) sit stalled for about three hours before anyone notices.** |
| 13:31 | The stash is used during a merge chain, against the worktree rule. |
| 15:11 | Mitchell: the PR is "way too large" for CodeRabbit. It is split **after the fact** into three stacked PRs (#222, #223, and #221 reused as part 3). |
| 15:27 | CodeRabbit reviews #222 and rate-limits #223 and #221. Reviews are scheduled an hour apart. |
| 17:13 | The weather and chart subagent was blocked from running tests, so it handed over code it had never run. Running it turned up five defects. |
| 17:14 | #222 `integration-e2e` fails: the phone field list runs 44% off-screen. It is a real bug, and it had passed locally. |
| 19:01 | Mitchell marks #221 ready. |
| 19:11 | CodeRabbit skips #221: preview-feedback fixes had grown it to **126 files**. It is split again: #226 becomes part 3 and #221 becomes part 4. |
| 19:34 | #222 conflicts with `main`, because #224 landed underneath it. The conflicts were duplicate known-issue ids, the CHANGELOG, a second network guard, and a new lint rule. |
| 19:35 | The stash is used a second time, in a red check. |
| 20:07 → 20:51 | #223 and then #226 are squash-merged. **Every squash conflicts the next part.** Each is fixed with a `-s ours` merge. |
| 20:25 | CodeRabbit rate-limits #221 again. |
| 21:03 | "lets just do the review ourselves." The self-review found five bugs. |
| 21:24 | The container restarts mid-work. Both worktrees survive. |
| 22:46 | CodeRabbit's four findings on #221 are fixed in `7339763`. |
| 22:49 | #221 `integration-e2e` fails: a changed weather label is still asserted in an integration test nobody grepped. It is fixed in `348edbe`. |
| 22:59 | #221 merges with the whole-stack Tier 3, the preview walk, the gate boxes and this retro still owed. |

---

## 1. The PR was split after it was built, not planned as a stack

**What happened.** "Just make everything on this one PR" produced one branch with the whole
milestone on it. It was about 270 reviewable files by 15:11. The split into parts was cut then,
backwards, at commits that already existed. The cut points were chosen because those commits had
already been verified, not because they made coherent review units. The first split was three
parts: 95, 86 and 88 files. That left each part only 5 to 14 files of headroom under CodeRabbit's
100-file cap. Part 3 went over by 19:11.

**Why.** Nobody asked the size question when the scope was agreed at 08:43. Pulling the whole
milestone into one PR was a legitimate call. But nobody worked out what one milestone costs in
files, and nobody noticed that CodeRabbit has a hard cap. The cap was learned when the PR hit it.

**What it cost.** Nearly everything below. Parts cut from finished history are harder to fix
forward. Every fix has to land on the lowest part it touches and then be merged up through the
others, while avoiding any part that is under review. With four open parts, one fix on part 1 meant
three forward merges.

**Change.** Plan the stack when you plan the scope. See `docs/guidelines/stacked-prs.md` §1.
Budget about **80 reviewable files per part**, not 100. Name each part's theme before writing code,
and build each part on its own branch from the start.

## 2. Squash merges made every merge conflict the next part

**What happened.** #222, #223 and #226 were each squash-merged. After each merge, the next part
showed conflicts on almost every file both parts had touched. It also showed the lower part's
changes again in its own diff: #226 showed 103 files at 20:24 instead of its own 88.

**Why.** A squash writes the lower part as one brand-new commit on `main`. The upper part is built
on the lower part's *original* commits. Git cannot tell that the two are the same work, so it treats
every shared line as edited on both sides. This is how squash merges always behave with stacked
branches, and nothing in the repo said so. Mitchell's question at ~19:50, *"is there a better way i
should be doing these merges"*, was the first time it came up.

**How it was fixed, each time.** Merge the old part tip, which is what `main` now contains in
content. Then merge `origin/main` with `-s ours`, which records it as merged without changing any
file. Then prove `git diff origin/main <part>` is exactly that part's own diff. This worked, and
that final check is the part that makes it safe. But it was needed three times, once per squash.

**Change.** Use **"Create a merge commit"** on stacked parts, which keeps the shared history and
avoids the conflicts. If a part does get squashed, `stacked-prs.md` §4 has the recovery procedure
with its check.

## 3. `main` moved under the stack, and parallel branches reuse the same KI ids

**What happened.** #224 (the no-third-parties test work) merged while the stack was open. Taking it
into #222 caused four problems:

- a **known-issue id collision**. Both branches had filed `KI-2026-09-24-n`, and later `-o` and
  `-p` collided too.
- two copies of the unit-lane **network guard** in `vitest.setup.ts`;
- a **new lint rule**: e2e specs must import `test` and `expect` from `./fixtures/test`. Part 2's
  spec predated it.
- CHANGELOG entries added on both sides.

**Why.** KI ids are handed out per day by letter: `-a`, `-b`, and so on. Each branch picks the next
free letter *on that branch*, so two branches open on the same day will pick the same letters. The
lint wall catches the duplicate only after the merge. The guard and lint problems were plain
parallel work: two sessions on the same day each solved "no test reaches a third party" their own
way.

**Change.** Before merging `main` into any part, run `pnpm lint` on the merged tree before anything
else. When ids collide, rename the side with fewer citations, as was done here. The durable fix, an
id that cannot collide across branches, is listed under *Candidates* below. It is not done here.

## 4. CodeRabbit's limits were learned one at a time, and in the end it was replaced

**What happened.** Three separate limits were hit, each as a surprise:

- **about one review per hour** on the free plan (15:27 and 20:25);
- **a 100-file cap**, which makes it skip the review rather than review part of it (19:11);
- **a push during a review aborts it**. `AGENTS.md` already records this one.

Reviews were scheduled an hour apart with check-in triggers. Even so, #221 never got a CodeRabbit
review before Mitchell called it at 21:03: *"lets just do the review ourselves."* The self-review
then found five real bugs, including a filter UI missing from the sentence widget and a burn-down
chart that was wrong when filtered. So the self-review was worth doing, but it happened late, as a
fallback.

**Why.** `AGENTS.md` § *CodeRabbit is Mitchell's step* was written for one PR at a time. It covers
the ~21-minute quiet window. It says nothing about the hourly quota, which only matters once several
PRs are waiting, or about the file cap. With four PRs, one review per hour means **four hours of
wall-clock just in review slots**, before counting any re-review after a fix. This session also
triggered reviews itself, on Mitchell's instruction ("while also do a coderabbit review"). That
turned the quota into a scheduling problem the agent had to manage, which cost several check-in
cycles.

**Change.** `stacked-prs.md` §3a records both limits. Self-review each part **before** asking
CodeRabbit, instead of when it fails to run. Request reviews in merge order, one per hour, and
expect a four-part stack to take the rest of a day in review.

## 5. Feedback kept landing on the top PR, and the PR numbers stopped meaning anything

**What happened.** Mitchell reviewed on the preview for #221, which was the top of the stack
(19 threads over the day). Every fix went onto #221, and #221 grew from 88 files to 126 and forced
a fourth part. Along the way:

- #221 had been opened at 08:35 as a docs-only PR. It became "M14 (3/3)", then "M14 (4/4)", and was
  retitled and re-bodied each time.
- #226, opened at 19:10, became part 3. So the lowest-numbered PR merged last, and a higher number
  merged before it.

**Why.** The preview for the top part is the only one that shows the whole milestone, so that is
where review happens. That is correct. But fixes went on the same branch as the feedback, even when
they touched code from a lower part. Reusing #221 for code was never a decision; it was simply the
branch the session was already on.

**Change.** Treat the top part's preview as the review surface. Put each fix on **the lowest part
whose code it changes**, and merge it forward. If the top part is heading past its file budget,
open a new part instead of growing it. Open code PRs fresh, in stack order, rather than reusing a
docs PR's number.

## 6. Subagents failed silently: four stalled, and one shipped untested code

**What happened.**

- **The stall.** Four implementation subagents (T08 renamed/removed fields, T11 ghosts, T20
  timezones and sun, T23 the external-data plumbing) showed as *running* with no progress for about
  three hours. They were found at 12:48 only because the orchestrator happened to ask them for
  status. Each was about to commit or run its final checks. Stopping and resuming them, with their
  context kept, recovered all four.
- **The untested code.** The weather and chart subagent's first `npx vitest` was denied by the
  permission classifier. It then returned code it had never run. When the orchestrator ran the
  checks, they found five defects:
  - a missing insert-menu preset for the burn-down chart;
  - a registry test that counted the new controls as dimensions;
  - raw syntax leaking as "burn-down";
  - e2e test data that didn't match the trip;
  - Sentry 403s from e2e.
- **A wip commit.** T11 left one commit titled "wip: ghosts", which had to be squashed on merge.

**Why.** Eighteen implementation agents were dispatched between 08:51 and 10:06, most of them in parallel. That is more than one orchestrator can keep track of by eye. Nothing in the orchestration checked on a running agent until its result was needed. And
an agent that could not verify its work reported that it was done instead of reporting that it was
blocked. The subagent contract's exit states allow *blocked*. This agent did not use it.

**Change.** Check on every running subagent about every 30 minutes. If one has written no new output
since the last check, ask it for status then; do not wait until its result is needed. When an agent
reports done, first check that it ran its tests. If it was blocked from running them, count that
work as untested and run the checks yourself before merging it. This session did exactly that for
the weather agent, but only because the gap was noticed.

## 7. Git hygiene slips the repo already has rules for

**What happened.**

- **Stash, twice (13:31 and 19:35).** The stash is used despite the worktree rule: *"Never use bare
  `git stash`… the stash stack is shared."* The first time, a merge had already committed itself,
  so the next `git commit` in a `&&` chain found nothing to commit, the chain stopped, and the fixes
  were left in the stash. Both were recovered by SHA, with no loss.
- **A lost rename.** A red-check script restored files with `git checkout`, which wiped an
  uncommitted rename. It had to be redone.

**Why.** The quickest way to "take this change out for a moment" is the stash, or `git checkout`.
Both reach past the one file under test, and in a shared checkout that is exactly the danger. The
rule was known. It was broken under time pressure, in the middle of long command chains.

**Change.** None is needed in the rules. From 19:35 on, the session used this procedure for red
checks, and it held: **copy the file to the scratchpad, break it, run the test, copy it back.** It
is written down in `stacked-prs.md` §6 so the next session starts with it.

## 8. Two failures reached CI that a local check could have caught

**What happened.**

- **#222, 17:14.** `integration-e2e` was red: on a phone, the FieldPicker's list ran 44% off-screen.
  This was a real defect, so the test did its job. It had passed locally, which is why it got as far
  as CI.
- **#221, 22:49.** `7339763` shortened the weather qualifiers to "No forecast · Sep avg". The
  unit tests for the formatter and the block were updated. But
  `apps/web/src/app/api/trips/[tripId]/weather/route.int.test.ts:133` still asserted
  `/^\w+ average \(no forecast\)$/`, and nothing looked there.

**Why (#221).** The change was verified with the minimal subset: typecheck, lint, and the unit
tests for the files that changed. The `minimal-check-subset` skill does say to run the integration
lane for *"any change integration tests exercise"*. But that is a judgement call, and nothing
prompts it when the change is a user-facing string. Searching for the old text would have found the
assertion in one second.

**Change.** When a change alters user-visible text, **grep the whole repo for the old wording**,
including `*.int.test.ts` and `e2e/`, before calling the subset complete. That line is added to the
`minimal-check-subset` skill.

## 9. Done was declared at merge, with the gate still open

**What happened.** #221 merged at 22:59 with four things its own body listed as owed:

- the whole-stack Tier 3 (`pnpm check` plus every M14 ci-like spec);
- the manual preview walk, including the new real-API weather check;
- the gate boxes;
- this retro.

On `main`, `M14-rich-layer.md` has **14 of 22 boxes ticked and 8 open**. One open box says *"The
external-data ADR is accepted before any external-data code lands."* ADR-052 was accepted on
delegation ("go with your own best judgement… I'll review in the morning"). That review has not been
recorded, and the external-data code has now landed. `docs/STATUS.md` and `TODO.md` still name M24
as current, and neither says that M14 shipped ahead of it.

**Why.** A stack spreads "final review" over four merges, and none of them felt like the last one
until it was. Each merge was also Mitchell's click on a PR that was green. From the PR's side,
green-and-mergeable looked like done. The owed work was not blocking anything, so it didn't happen.

**Change.** For a stack, the whole-stack verification runs **on the top part before the first
merge**, and it is recorded in part 1's body. See `stacked-prs.md` §5. What is still owed for M14 is
listed below.

---

## Smaller things worth knowing

- **Notification noise.** "Vercel Preview Comments" reports a *failed* check while any preview
  thread is unresolved. It did so 13 times today. None of those was a CI failure. Read it as "there
  are open preview comments", not "red".
- **Compaction and restarts.** Three compactions and one container restart. The summaries carried
  the state across them well enough. The costly part was re-finding facts after each one: which
  worktree held which part, and which reviews were still running.
- **`node_modules` symlink.** Linking one worktree's `node_modules` into another broke pnpm. Run
  `pnpm install --offline` in each worktree instead.

## What went well

- **The `-s ours` recovery, verified every time.** "The diff against `main` now matches part 2's
  own diff exactly (100 files, same lines)." Checking for no content change is what made it safe.
- **Review findings were treated as bug reports.** Every CodeRabbit finding on all four PRs was
  checked against the code. Each fix was seen red first, and each thread got a reply naming the
  commit. The stale-save race on #222 was followed through to a server-side guard (`expectedUpdatedAt`,
  409 `page-changed`) instead of stopping at the client fix.
- **The preview loop worked.** Mitchell's 19 preview comments were each fixed, replied to and
  resolved on the thread. The two follow-ups he chose to defer are filed as KIs, not dropped:
  one-widget-at-a-time selection (KI-2026-09-24-x) and travel advisories (the brainstorm doc).
- **The third-party policy became real.** No automated test reaches MET Norway, NASA POWER, map
  tiles or Sentry any more. Each has a named manual check on the preview. Part of this landed on
  `main` from #224.

## Recorded in this change

- `docs/guidelines/stacked-prs.md`, new, covering sections 1–7 and 9 above. It is linked from `CLAUDE.md`
  and the guidelines index.
- `.claude/skills/minimal-check-subset/SKILL.md`: grep for old user-visible text before calling a
  subset complete (section 8).

## Candidates, not done here

- **Known-issue ids that cannot collide across branches** (section 3). Options include an id taken
  from the branch or PR, or letters assigned at merge time. Both touch the KI lint wall and every
  existing citation, so this needs its own change.
- **Stall detection in the subagent protocol** (section 6). Detection could live in
  `.claude/protocol/` as a hook, or be a rule in the contract. Section 6's 30-minute status check
  covers it until then.

## Still owed for M14 (not part of this retro)

- Whole-stack Tier 3 on `main` (`60c4215`), and every M14 ci-like spec.
- The preview walk, including the real MET Norway and NASA POWER check (box 936).
- Mitchell's review of ADR-052, which the gate treats as a prerequisite that has already been passed
  (box 930).
- The remaining gate boxes, then the milestone retro appended at gate close (box 948).
- `STATUS.md` and `TODO.md`: record that M14 shipped ahead of M24, and decide which is current.
- After deploy: `migrate-production` for `0029_saved_notebooks` and `0030_external_data_cache`, and
  `EXTERNAL_DATA_CONTACT` set in Vercel.
