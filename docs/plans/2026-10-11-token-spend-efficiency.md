# Token spend: bound it by mechanism, measure it at every gate

**Written 2026-10-11**, from `docs/retros/2026-10-12-m42-token-spend-retro.md` (M42 cost $334,
2.1× M41, for the same amount of code). This plan is built by the PR that adds it. What it leaves
open is the test: **M43's spend block, compared with M42's.** Delete this file in the commit that
records that comparison (`docs/plans/README.md`).

## Why the retro's fixes are not written as rules

The retro's §6 is mostly prose in four skills. Three facts say prose is the weak form here:

- **A rule that was followed still cost $34.** "Routine notifications get no message" was obeyed.
  Reading each one silently still re-read about 400k tokens of context.
- **An earlier fix made this problem.** "Subscribe, do not watch" was written to save wall time,
  and it is what woke the orchestrator 190 times.
- **Nothing was measured between reviews.** `pnpm session-metrics` existed, and its own header
  records that the 2026-09-21 review's recommendations neither shipped nor were re-measured. M42's
  retro then wrote a third one-off script.

So each lever below has a mechanism that holds when the agent forgets, and a number that the gate
close will not proceed without. The skills only describe the mechanism.

## The cost model

A session costs about *number of model calls × size of the context each call re-reads*. Every
decision here cuts one of the two, and none of them cuts review, red-first testing or the local
ci-like run of a part's own spec: the retro's F5 shows those were cheap and caught real defects.

## Decisions

| | Decision | Mechanism | Expected | Measured in the spend block as |
|---|---|---|---|---|
| A | A builder or reviewer that has reported is closed. A follow-up goes to a new agent with a brief. | `closed-agent-guard.mjs` denies `SendMessage` to an agent idle over 270 s or over 150k context. `implementer-brief-check.mjs` refuses a `phase-implementer` dispatch without branch, files and "done means", plus head sha and findings when the branch already exists. | $50–70 a milestone (F2, F3) | Re-writes after a coordinator message: 24 → 2 or fewer. Costliest builder: $36 → under $20. |
| B | The orchestrator hears only what needs it. | CodeRabbit's status comment and Vercel's PR comment are turned off in config. `notification-unsubscribe-nudge.mjs` tells the orchestrator to unsubscribe at the moment a part's event wakes it. The implementer's report must carry a `Closed:` line naming the PR to unsubscribe from. | $35–55 a milestone (F1) | GitHub wakes per merged part: 21 → under 5. |
| C | The orchestrator's context stays small; state lives in part 0's tracker. | `orchestrator-lean-reads.mjs` denies job logs in the orchestrating session. `reviewer-report-check.mjs` caps the reviewer's hand-back at 4,000 characters; the full review travels as a file. The gate close starts in a fresh session, and past 250k of its own context the orchestrator is told on its next wake to ask for a handoff. | Orchestrator share 30% → under 15% | Orchestrator average context: 416k → under 200k. |
| D | A brief names the files. | The same brief check as A. One `Explore` survey at planning produces each part's file list and entry points. | Not sized; reading was 65% of what builders carried | Calls in a builder's first run: under 200. |
| E | Spend is measured at every gate. | `pnpm session-metrics --milestone` prints the block; `pnpm milestone close` refuses without it (`--no-spend "<reason>"` is the one escape). `docs/guidelines/writing-a-retro.md` makes it part of every milestone retro. | The next retro costs minutes, not a session | The block exists for M43. |

## Considered and rejected

- **A 1-hour prompt cache for subagents** (`subagentPromptCacheTtl`). It would remove F3's
  re-writes, but a 1-hour write costs 2× input against 1.25× for a 5-minute write. On M42's
  numbers that is about $34 more on every subagent write to save about $37 of re-writes.
  Decision A removes the re-writes without the surcharge.
- **A hard context cap on a running builder.** M42's part 1 peaked at 278k with no follow-up, so
  a cap could stop healthy work mid-part. M43 measures builder context only; the cap is decided
  from that data.
- **Changing how scope grows mid-build** (F4, about $70). That bought real features. The spend
  block shows the cost per part, so the price of a redirect is visible when it is chosen.

## What is not verified yet

Each of these is checked in M43 and recorded in its retro:

1. **That a `PreToolUse` hook fires for `SendMessage`.** Hooks match any tool by name, but the docs
   never name this one, and a session reads its hooks at start, so the session that wrote the
   guard could not try it. To check: in a fresh session, `touch "$(git rev-parse
   --absolute-git-dir)/tc-orchestrator"`, run any subagent, wait five minutes and message it. A
   denial naming its idle time means it fires. If it does not, decision A rests on the brief
   check and the `Closed:` line, and the guard is deleted.
2. **That `review_status: false` removes CodeRabbit's "review skipped" comment.** Its reference
   says the setting posts those messages; it does not say what turning it off removes.
3. **That `github.silent` still silences Vercel's PR comment.** Vercel marks the key deprecated in
   favour of a dashboard setting (project → Settings → Git). If comments still arrive, Mitchell
   turns them off there.
4. **The wake classifier in `session-metrics --milestone`.** It was written from the retro's
   description of cloud transcripts, which do not exist on a laptop. Its `other` bucket is
   reported so a wrong pattern shows.
5. **Whether a cloud session can filter or refuse PR auto-subscription.** Not documented either
   way.

A hook that misfires twice is deleted, by the repo's own rule (quoted in
`scripts/surface-size.mjs`). The
spend block counts each guard's denials, so a misfire is visible.

## Targets for M43

- under **$20 per 1,000 lines added** (M42: $34; M37–M41 without M39: $11–$16);
- the orchestrator **under 15%** of the spend (M42: 30%);
- **no builder averaging over 250k** context;
- **under 5 GitHub wakes per merged part** (M42: 21);
- **2 or fewer** cache re-writes after a coordinator message (M42: 24).
