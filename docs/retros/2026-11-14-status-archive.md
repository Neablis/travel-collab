# STATUS archive — 2026-11-14

Moved here verbatim on 2026-11-14, from `docs/STATUS.md` as it stood at `4d963ab`. The M60 and
M61 closes that day grew STATUS to 28,076 B against its 30,000 B surface budget. That left 6.4%
headroom, and `scripts/__tests__/surface-size.test.mjs` asks for more than 10%, so `test /
scripts` failed on `main` and on every PR.

Why each went (`docs/guidelines/retiring-a-rule.md`'s criteria): history (2). Each paragraph is
the close-out of a closed milestone, and that milestone's file holds its gate evidence, retro and
spend. What stays open from them is in `docs/known-issues/open/` (KI-2026-10-13-a,
KI-2026-10-20-c, KI-2026-10-22-a), not here.

---

**M51 closed 2026-10-22, gate 11 of 11**, on Mitchell's ruling at the close: his walk at 390, 1440
and 3440 works, and the parts are merged (PRs 506–511, 513, 514, 516; part 0 PR 505 merged early;
follow-up tweaks PR 518). Three things left the gate as known issues: the landing's signup →
new-trip path (KI-2026-10-22-a), re-proving the gate's red evidence after the test-pruning pass
(KI-2026-10-22-b), and checking the sea's links against production (KI-2026-10-20-c). Closed with
`--no-spend`. Evidence and retro are in `docs/milestones/M51-the-front-door-tells-the-story.md`.

**M50 closed 2026-10-19, gate 11 of 11** (part 0 PR 493). Parts are PRs 494-501 and 503 (part 9,
from Mitchell's walk), migrations `0060` and `0061`, both applied in production; ADR-079. Five
boxes are ticked on Mitchell's walk of the landing page (his ruling, option a). Evidence, retro
and spend are in `docs/milestones/M50-strangers-find-a-day.md`.

**M47 closed 2026-10-18, gate 7 of 7**, on Mitchell's production test-card walk (ticked on his
word). Parts are PRs 474, 476, 477 and 475, migrations `0055` to `0057`; part 0 PR 473. Evidence,
retro and spend are in `docs/milestones/M47-the-business-over-time.md`.

**M46 closed 2026-10-17, gate 10 of 10** (part 0 PR 472, after PR 432 merged early). The last box,
the two-person walk, is ticked on Mitchell's confirmation that day. Evidence, retro and the
`list_sessions` spend block (closed with `--no-spend`: the transcripts were gone) are in
`docs/milestones/M46-a-trip-has-a-conversation.md`. Parts 1 to 6 and the walk fixes are PRs 433,
435, 436 and 438-447, migrations `0048` to `0052`.

**M45 closed 2026-10-13, gate 12 of 12** (part 0 PR 420); evidence and retro in
`docs/milestones/M45-the-assistant-beyond-one-trip.md`. Accepted gap: KI-2026-10-13-a.
