# STATUS archive — 2026-11-21

Moved here verbatim on 2026-11-21, from `docs/STATUS.md` as it stood at `153ecdd`. STATUS was
28,230 B against its 30,000 B surface budget (5.9% headroom; the test asks for more than 10%),
so `test / scripts` failed on PR 788 and on `main`. Mitchell ruled to trim it, not raise the budget.

Why each went (`docs/guidelines/retiring-a-rule.md`'s criteria): history (2). Each paragraph is
the close-out of a closed milestone, and that milestone's file holds its gate evidence, retro and
spend. Open follow-ups are in `docs/known-issues/open/`. Closed here: M58, M44, M57, M43, M56,
M55, M54, M49 and M52.

**M58 closed 2026-11-06, gate 11 of 11** (*A notebook anyone can read, and a poll for the people
going*; decisions in `docs/milestones/M58-a-notebook-anyone-can-read.md`, mechanisms and
amendments in ADR-088), by `pnpm milestone close M58 --confirm`. The [walk] was ticked on
Mitchell's word that he walked production. All five code parts are on `main` (`2729315`,
`aac7246`), and part 0 is PR 688 (`10c44a4`). Migrations `0073` and `0074` are applied in
production, `0074` by `migrate-production` run 42255011247 on `10c44a4`. M53 was next after it;
M59 was then placed ahead of M53 (2026-11-08).

**M44 closed 2026-11-03, gate 7 of 7** (*A stop knows what was booked, and what it sits inside*;
decisions in `docs/milestones/M44-a-stop-knows-what-was-booked.md`, mechanisms in ADR-086), by
`pnpm milestone close M44 --confirm` on part 0 (PR 679, `claude/next-milestone-5o3kip`, prose
only), which **waits on Mitchell's merge**. All five code parts are on `main`: PRs 680 to 683 in
`1540f9e` and PR 684 in `4f75af0` (`ci` run 41561850267 green at its head `2696b5a`). No
migration. Evidence, retro and spend (three sessions) are in the milestone file; the plan is
deleted. One new known issue: KI-2026-11-03-a (the Booked chip is below the 44px phone touch
floor). The share page's Booked chip is a candidate.

**M57 closed 2026-11-01, gate 10 of 10** (*The assistant is a graph of personas, and you can watch
it work*; decisions in `docs/milestones/M57-assistant-personas.md`, mechanisms in ADR-085), by
`pnpm milestone close M57 --confirm` on part 0 (PR 667, `ccr-295c38f8-0l82gi`, prose only), which
**waits on Mitchell's merge**. Parts 1 to 5 are on `main` (PRs 668, 670, 671, 672, 673; last merge
`f5bbd18`; migrations `0071` and `0072` applied by `migrate-production` run 41351040591). Part 6
is PR 674 (`a40c632`, `ci-ok` green, `ci` run 41359705691, `ci-ok` check run 125009047622) and
waits on Mitchell's merge; `a40c632` is prompt text only (the Discover trim: edit step 31,963 to
31,609 chars, under the 31,630 the last gate box asked for). Mitchell ruled on KI-20261101-x:
keep the edited `s-ramen-near-hotel` prompt (resolved). Part 0 carries the retro, ADR-085
decisions 7 to 9 and five known issues (KI-2026-11-01-w, -y, -z, -aa and the earlier -s to -v);
the plan is deleted.

**M43 closed 2026-11-01, gate 6 of 6**, by `pnpm milestone close M43 --confirm` on part 0
(PR 659, `ccr-96adddf8-iksgbh`, prose only), which **waits on Mitchell's merge**. All five code
parts are on `main` in `c3452b7`: PR 661 (the Overview's identity is the `pages.kind` column,
migration `0070`, applied by `migrate-production` run 41272194596), PR 662 (the derived Overview
title), PRs 660 and 663 (*What needs you* as the design's rows, with class and Days filters), all
in `e3629e2`, and part 5 (PR 665, `c3452b7`), from Mitchell's production walk of 2026-11-01:
a day-scoped empty is the green line worded for the day, and before day 1 a Today notebook's
*What needs you* checks the whole trip (ADR-037's M43 amendment). Evidence, retro and spend (the
first session carried in from its hand-off) are in `docs/milestones/M43-notebooks-keep-up.md`;
the plan is deleted.

**M56 closed 2026-10-30, gate 17 of 17**, by `pnpm milestone close M56 --confirm` on part 0
(PR 637, `claude/elegant-maxwell-h4ldi1`, prose only), merged to `main` as `7a0b0c8`. All
sixteen code parts are on `main` in `3ac8c02`, none with a migration: parts 1 to 6 (PRs 638 to
643), parts 7 to 11 from the first preview walk (PRs 648 to 653), and parts 12 to 16 from the
second (PRs 654 to 658), each with `ci-ok` green on its final head. Mitchell walked round 2 on
production and reported nothing to change (2026-10-30). Evidence, retro and spend (three of
four sessions measured; the original build session's transcript is gone) are in
`docs/milestones/M56-new-trip-is-a-picker.md`; the plan is deleted.

**M55 closed 2026-10-28, gate 17 of 17**, by `pnpm milestone close M55 --confirm` on part 0
(PR 613, `ccr-a54f396f-65ja2i`, prose only), merged to `main` as `d97e71d`. All eleven
code parts are on `main`: PRs 614, 615, 616, 617, 618 and 620 as one stack in `1c353dd`
(2026-10-27 23:26Z, `0069` applied by `migrate-production` run 40604400973), parts 7 to 10 (PRs
622, 621, 623, 624) as a second stack in `acb7f93` (2026-10-28 02:29Z, no migration), and part 11
(PR 626, `ce7775d`, 2026-10-28 03:56Z, `ci-ok` green on `76a5943`), which made MCP answer
`not-found` on a stranger's trip and ticked *Two gates hold*. Mitchell walked parts 1 to 10 on
production on 2026-10-28. Evidence, retro and spend are in
`docs/milestones/M55-claude-connects-as-you.md`; the plan is deleted.

**M54 closed 2026-10-27, gate 13 of 13**, by `pnpm milestone close M54 --confirm` on part 0
(PR 593, `ccr-3f23dccb-mljaxu`), merged to `main` as `837eef5`. All eight parts are on `main`
(PRs 594, 595, 600, 601, 607, 604, 605, 606, merged as one stack in `e9a46b0f`, 2026-10-26; no
migration). Mitchell walked three checks on `main` from Android (2026-10-27, 01:51Z) and, about
02:00Z, waived the rest of the [walk] and the iPhone cold launch, accepted the pending-button e2e
without a red, and had the lens fade and the e2e splash wait recorded as known issues
(KI-20261027-a to -c; -d is the rail's passive-effect focus). Evidence, retro and spend are in
`docs/milestones/M54-the-motion-pass.md`; the plan is deleted.

**M49 closed 2026-10-25, gate 9 of 9**, by `pnpm milestone close M49 --confirm` on part 0
(PR 581, `claude/cool-goodall-p53ykz`). All four parts are on
`main`: part 1 (PR 580, `fc07b46`, migration `0068` applied in production by `migrate-production`
run 40169051627), then parts 2, 4 and 3 (PRs 584, 585, 588, stacked, merged together as
`cc93447`). The [walk] box was ticked on Mitchell's word, 2026-10-25 17:59Z: *"Confirmed, and
walked. Closed out the gate"*. Evidence, retro and spend are in
`docs/milestones/M49-covers-from-anywhere.md`; the plan is deleted.

**M52 closed 2026-10-24, gate 13 of 13**, by `pnpm milestone close M52 --confirm` on part 0
(PR 529, `claude/serene-tesla-quoyte`). Parts 1–12 merged 2026-10-23/24 (PRs 530–537, 539–542,
545), migrations `0062`–`0065` applied in production. The [walk] box was ticked on Mitchell's
word, 2026-10-24: *"Confirmed, check them all and finish up"* (two-member *No messages yet*,
`auth()` inside `after()` on production, walks of PR 537 at `4301073` and PR 541), beside his
earlier confirmations (Today undeletable on production; part 10's API; part 11 *"Merged,
confirmed fixed"*). Evidence, retro and spend are in
`docs/milestones/M52-the-trip-comes-with-you.md`.
