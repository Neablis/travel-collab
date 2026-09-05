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

Red-first (any PR adding a test): <!-- For each new test: the source edit that
     makes it fail, and the real failure text. "expected 'Sam' to be 'Sam Smith'"
     — not "I verified it fails". A test never seen red is a claim, not a
     control; three written in one session on 2026-09-02 asserted nothing and
     passed. See docs/guidelines/testing.md §3. -->

<!-- TIER THESE AGAINST AGENTS.md "Definition of Done". They are NOT all
     required of every PR, and treating them as a flat list is the exact defect
     KI-2026-09-05-u closed in quality-enforcement.md. Tier 1 (prose-only
     BRANCH) runs NOTHING. Tier 2 (scoped code) runs the minimal-check-subset
     skill's output and nothing more. Tier 3 (final review) runs `pnpm check`, plus the conditional lanes below that actually apply. Tick
     what the tier actually required and strike the rest. -->

- [ ] Tier for this PR (1 prose / 2 scoped / 3 final review): <!-- state it -->
- [ ] `pnpm check` green locally (typecheck + lint + unit) — Tier 3
- [ ] `pnpm --filter web test:int` green (needs Postgres) — Tier 3
- [ ] `pnpm --filter web test:e2e:ci-like` green — Tier 3 **and only if this
      changed a user flow**; e2e is conditional per AGENTS.md, not automatic
- [ ] Seed/fixture verification — only if contracts or fixtures changed
- [ ] Manual browser walk of the changed flow

Preview URL walked: <!-- https://travel-collab-git-<branch>-neablis-projects.vercel.app -->

What I clicked through, and what I saw:

Not run, and why:

## Definition of done

<!-- Restated from AGENTS.md / docs/guidelines/quality-enforcement.md. -->

- [ ] New logic has tests at its layer (domain unit / contract / integration / e2e), and each new test was seen red before it was seen green
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

<!-- Do not hand-poll. One blocking command covers the automated checks:

       gh pr checks <n> --watch --fail-fast

     Straight after a push, --watch can return in ~1s with the PREVIOUS
     commit's checks, all green. Confirm the run exists for your real HEAD:

       gh run list --commit "$(git rev-parse HEAD)" --limit 1

     And do not watch what cannot run. A Tier 1 PR is skipped by ci.yml's
     paths-ignore and filtered out by .coderabbit.yaml; a draft PR runs
     nothing until `gh pr ready <n>`. In both cases there is no terminating
     event, so watching is an open-ended loop. No run for your HEAD, and none
     expected, is the finished state — say so and move on. -->

## CodeRabbit — Mitchell's step before merging

<!-- Decided 2026-09-01. CodeRabbit is NOT an automated check here and its
     status is not evidence: auto-review is off for this repo and it posts a
     GREEN status while skipping, so --fail-fast exits 0 on a PR it never
     read. See AGENTS.md and KI-2026-09-01.

     Tick the first box when you have handed off. Do not tick the second
     yourself unless you triggered the review AND were certain you were done
     pushing — a push during the ~21-minute window aborts it. -->

- [ ] CI is green on the real HEAD, and I have told Mitchell in chat: **"PR #N is green and ready — trigger CodeRabbit before merging."**
- [ ] Review has run (`Review completed`, not `Review skipped`) and its findings are addressed or answered

After addressing findings, say which this was, because it decides whether the review still counts:

- [ ] The fix was small — merge on the existing review
- [ ] The fix was substantive — worth a re-trigger before merging
