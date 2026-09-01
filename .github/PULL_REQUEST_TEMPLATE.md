<!--
Keep this template. Delete the comments, not the headings.

The point of the Verification section is that a step you did NOT do gets
recorded as not done. Four consecutive M10 phases shipped with a skipped
verification step that only surfaced later in docs/STATUS.md: Phase 5 and
Phase 6 both skipped the manual browser walk, Phase 3 sat built-and-verified
for a day without a PR, and Phase 7 — the one that actually did the walk —
found a crash bug (RangeError: Invalid time value) no test caught. An
unchecked box here is a fine outcome. A silently skipped step is not.
-->

## What and why

<!-- One paragraph. What changed, and what it's for. Link the milestone or
     phase file in docs/milestones/ or docs/plans/, and the plan task ids. -->

Milestone / phase:
Plan:

## Verification actually performed

<!-- State the tier first, then tick only what you actually ran. For anything
     not run, say so on the "Not run" line with the reason — "no interactive
     browser in this container" is a perfectly good reason; leaving it blank
     is not.

     Tiers are defined in AGENTS.md → Definition of Done → "Verification
     scales to the change":

       Tier 1  prose only (docs/**, .claude/**, root *.md) — run NOTHING.
               Every box below stays unchecked and that is the complete,
               correct answer. Do not watch checks: CI and CodeRabbit both
               filter these paths, so none will run.
       Tier 2  scoped code — the minimal-check-subset only. Name the exact
               commands on the "Subset run" line. Not `pnpm check`.
       Tier 3  final review, leaving draft — `pnpm check` once, plus e2e if a
               user flow changed and seed:verify if a fixture/contract did. -->

Tier: <!-- 1 / 2 / 3 -->

Subset run (Tier 2): <!-- the exact commands -->

- [ ] `pnpm check` green locally (typecheck + lint + unit)
- [ ] `pnpm --filter web test:int` green (needs Postgres)
- [ ] `pnpm --filter web test:e2e:ci-like` green (production build + full e2e)
- [ ] Manual browser walk of the changed flow

Preview URL walked: <!-- https://travel-collab-git-<branch>-neablis-projects.vercel.app -->

What I clicked through, and what I saw:

Not run, and why:

## Definition of done

<!-- Restated from AGENTS.md / docs/guidelines/quality-enforcement.md. -->

- [ ] New logic has tests at its layer (domain unit / contract / integration / e2e)
- [ ] Milestone e2e extended if a user flow changed
- [ ] Projection-rebuild golden test still passes if events or reducers changed
- [ ] Contracts changelog entry if any schema changed, consumers updated here too
- [ ] No invariant weakened (a blocker is a finding to report, not a rule to bend)
- [ ] Docs updated — ADR / milestone file / guidelines — if behavior or interfaces changed
- [ ] Conventional commits, one logical change each

## Known issues

<!-- New KIs filed by this PR, and any existing KI it closes. A defect found
     and consciously left is fine — file it in docs/known-issues/ and name
     it here. A defect found and left unrecorded is not. -->

Files:
Closes:

## Waiting on checks

<!-- Do not hand-poll. One blocking command covers all of them:

       gh pr checks <n> --watch --fail-fast

     BUT a green CodeRabbit status no longer means it reviewed anything
     (KI-2026-09-01). This repo is below CodeRabbit's 10-star OSS gate, so
     auto-review is off and it posts `success` with the description
     "Review skipped: manual review required for this OSS repository".
     --fail-fast exits 0 on a PR it never read, and after a second push
     CodeRabbit may vanish from the rollup entirely while it still says
     success. Check presence, state AND description:

       gh pr view <n> --json statusCheckRollup,reviews

     To get a real review, comment `@coderabbitai review`. It works, but
     takes ~21 min (not the 2-11 a normal review takes), so an empty
     `reviews` inside that window is not a failed trigger. Do not claim a
     PR was reviewed when it was not.

     CodeRabbit's summary comment lands ~30s in, but its actual review verdict
     takes 2-11 minutes. --watch exits non-zero the moment anything fails.

     Straight after a push, --watch can return in ~1s with the PREVIOUS
     commit's checks, all green. Confirm the run exists for your real HEAD
     first:

       gh run list --commit "$(git rev-parse HEAD)" --limit 1

     And do not watch what cannot run. A Tier 1 PR is skipped by ci.yml's
     paths-ignore and filtered out by .coderabbit.yaml; a draft PR runs
     nothing until `gh pr ready <n>`. In both cases there is no terminating
     event, so watching is an open-ended loop. No run for your HEAD, and none
     expected, is the finished state — say so and move on. -->
