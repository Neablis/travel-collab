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
               correct answer. CI's real jobs skip these paths; only
               `ci-ok` reports, in under a minute.
       Tier 2  scoped code — the minimal-check-subset only. Name the exact
               commands on the "Subset run" line. Not `pnpm check`.
       Tier 3  final review: CI green on the head. The full suite runs in
               CI on the PR, not locally (`pnpm check` is denied); add the
               part's own e2e spec via ci-like if a user flow changed, and
               seed:verify if a fixture/contract did. -->

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
     skill's output and nothing more. Tier 3 (final review) is CI green on the
     head, plus the conditional lanes below that actually apply. Tick
     what the tier actually required and strike the rest. -->

- [ ] Tier for this PR (1 prose / 2 scoped / 3 final review): <!-- state it -->
- [ ] CI green on the real HEAD (typecheck + lint + unit + integration + e2e) — Tier 3
- [ ] `pnpm --filter web test:int` green (needs Postgres) — Tier 3
- [ ] The part's e2e spec via ci-like (`pnpm --filter web test:e2e:ci-like
      e2e/<spec>.ts`), and CI — Tier 3 **and only if this changed a user
      flow**; e2e is conditional per AGENTS.md, not automatic
- [ ] Seed/fixture verification — only if contracts or fixtures changed
- [ ] Manual browser walk of the changed flow

Preview URL walked: <!-- https://travel-collab-git-<branch>-neablis-projects.vercel.app -->

What I clicked through, and what I saw:

Not run, and why:

## Migrations

<!-- Merging does NOT apply a migration. Production migrations are dispatched by
     hand (ADR-004, for CI cost): `gh workflow run migrate-production.yml -f
     confirm=migrate`, from main. Between merge and dispatch the code is live
     and the column is not, so anything reading it 500s — this line is the
     handover, and "none" is the usual and correct answer.

     `pnpm lint` runs scripts/check-migration-journal.mjs, which refuses a
     migration whose `when` is not newer than main's newest. If it fired, do NOT
     renumber the file: rebase onto main and re-run `pnpm --filter web
     db:generate` so it gets a fresh `when`. `when` is what drizzle compares,
     and it applies only entries newer than the last row already applied — an
     older one is skipped in silence with `migrate` still printing success.
     KI-2026-09-05-k. -->

- [ ] No Drizzle migration in this PR — nothing to dispatch
- [ ] Adds the migration(s) named below, and **`migrate-production` must be dispatched after merge**

Migrations added: <!-- e.g. 0019_saved_day_pinned — or "none" -->

## Definition of done

<!-- Restated from AGENTS.md / docs/guidelines/quality-enforcement.md. -->

- [ ] New logic has tests at its layer (domain unit / contract / integration / e2e), and each new test was seen red before it was seen green
- [ ] Milestone e2e extended if a user flow changed
- [ ] Projection-rebuild golden test still passes if events or reducers changed
- [ ] Contracts changelog entry if any schema changed, consumers updated here too
- [ ] No invariant weakened (a blocker is a finding to report, not a rule to bend)
- [ ] Docs updated — ADR / milestone file / guidelines — if behavior or interfaces changed
- [ ] Any Drizzle migration is named in the Migrations section above, and the dispatch handed to Mitchell
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

     And do not watch what cannot run. A draft PR runs nothing until
     `gh pr ready <n>`, so there is no terminating event and watching is an
     open-ended loop. A Tier 1 PR skips every real job; its one check is
     `ci-ok`, required, done in under a minute. -->

## Review

<!-- Decided 2026-10-13: CodeRabbit is removed and reviews are ours
     (AGENTS.md, "Review is ours"). A new part-reviewer subagent reviews every
     push (review-a-part); the riskiest part of a milestone gets one extra,
     fresh pass before it is called ready. What goes on the PR is short:
     docs/guidelines/working-a-review.md. -->

- [ ] A `part-reviewer` reviewed the current head, and every finding is fixed (its commit named) or answered on its thread
- [ ] CI is green on the real HEAD, and Mitchell has been told in chat that the PR is ready to merge
