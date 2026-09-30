# Retired rules — 2026-09-30

The first retirement pass under `docs/guidelines/retiring-a-rule.md`, moved
here verbatim so nothing is lost and each removal can be reversed. Two files:
`AGENTS.md` (sections 1–11) and `docs/milestones/README.md` (12–13).

`AGENTS.md` went from 42,032 B to 38,273 B against its 47,000 B budget — 89% to 81%, below
the surface wall's 85% retirement line and clear of the 90% at which
`surface-size.test.mjs` fails.

Each entry names the criterion it was retired under (the numbers are the
guideline's) and what replaced it in `AGENTS.md`. **To reverse one**, put the
text back and say in the commit which incident brought it back; that is
evidence the criterion was wrong, and the guideline should learn from it.

`docs/milestones/README.md` paid for the checklist's new step 7 (the pointer
to this procedure) with two retirements of its own, net −316 B. It is still at
89%; it is due a full pass of its own, which is roadmap content and is left
for a milestone close to do deliberately.

No invariant, module-map row or rule was removed. Every change below either
drops history of the document itself, shortens an incident to its citation, or
replaces a second copy with a pointer to the first.

## 1. `AGENTS.md` — criterion 5 — stale: listed three of five skills

**Was:**

````markdown
**Skills** (`.claude/skills/`): `minimal-check-subset` (narrowest sufficient
check), `ci-triage` (scoped failing-job logs), `worktree-hygiene` (read-only
worktree audit).
````

**Now:**

````markdown
**Skills** (`.claude/skills/`): `minimal-check-subset` (narrowest sufficient
check), `ci-triage` (scoped failing-job logs), `worktree-hygiene` (read-only
worktree audit), `write-a-test` (the testing guide as steps), `ai-usage` (the
assistant's live cost and quality). The first three are symlinks into
`.agents/skills/`; edit them there.
````

## 2. `AGENTS.md` — criterion 1 — enforced/restated: the script header and its --check message carry the rationale and the proves/does-not caveat

**Was:**

````markdown
per-file byte budget. It exists because the surface **doubled in nineteen
days** — 315,687 B at the 2026-09-02 tooling review to 635,502 B on
2026-09-21 — while nobody was watching, because no number was being kept. At
the 51.3x cache re-read multiplier that review measured, this is the one place
a byte saved is not saved once. `--since <ref>` prints the before/after
against any commit. Each budget is ~1.25x the file's size when it was set, so
the wall fires on growth rather than on the next legitimate paragraph; raising
one is a decision to record in the commit that raises it.
**What it proves and does not:** byte counts prove the *surface* shrank, not
that sessions got cheaper. The outcome measure is F1/F2 in
`pnpm session-metrics`. `docs/reviews/2026-09-21-development-loop-review.md`.
````

**Now:**

````markdown
per-file byte budget. It exists because the surface **doubled in nineteen
days** while nobody was keeping a number, and at the measured 51.3x re-read
multiplier a byte saved there is not saved once
(`docs/reviews/2026-09-21-development-loop-review.md`). Past 85% of a budget a
file is marked `!!` and `pnpm milestone close` lists a **retirement pass** for
it — `docs/guidelines/retiring-a-rule.md`. Raising a budget is a decision to
record in the commit that raises it.
````

## 3. `AGENTS.md` — criterion 2 — history of the document

**Was:**

````markdown
This section used to open with a single line — *"typecheck, lint, and all tests
pass locally (`pnpm check`)"* — under a header that says **every change**. It
was followed literally, including on changes that touched nothing but prose.
Running the full suite to fix a typo in `TODO.md` is not caution; it spends
local wall clock, Claude tokens reading the output, and — once a PR is open and
someone starts watching it — time waiting for checks that `paths-ignore`
guaranteed would never report.

Classify
````

**Now:**

````markdown
Classify
````

## 4. `AGENTS.md` — criterion 2 — history of the document

**Was:**

````markdown
even when only its markdown moved. (This used to cite
> `api/dev/reset-demo-data/route.ts`, which stopped importing the seed and now
> only carries a comment saying it once did; the rule was right, its reason had
> gone stale. Corrected 2026-09-12.) `ci.yml` gets this right by
````

**Now:**

````markdown
even when only its markdown moved. `ci.yml` gets this right by
````

## 5. `AGENTS.md` — criterion 3 — incident narrative past one sentence

**Was:**

````markdown
puts it in front of GitHub's own merge-conflict detection while the diff is
still small. In M10 Wave 2, Phase 3's branch (`claude/m10-phase-3-rack`) was
fully built and verified in a real browser on 2026-08-22, recorded "done" in
its own branch-local `STATUS.md` — and then sat with no PR while Phase 4 was
built independently on `main` and merged first (PR #25), leaving Phase 3
diverged 12 commits each way with a likely `TimelineLens.tsx` conflict, only
noticed a day later when a fresh session went looking for "the next milestone"
and its own task list still claimed Phase 3 as done. Before starting new
````

**Now:**

````markdown
puts it in front of GitHub's own merge-conflict detection while the diff is
still small. M10 Wave 2's Phase 3 sat built, verified and PR-less while Phase 4
merged past it (PR #25), 12 commits diverged each way. Before starting new
````

## 6. `AGENTS.md` — criterion 1 — enforced by scripts/hooks/draft-pr-guard.mjs; 3 — the accounting lives in ci-cost-and-capacity.md

**Was:**

````markdown
green.** The rule above wants the PR open early for visibility; CI wants it to
stop paying for every intermediate commit. Draft status gives both — the PR is
visible, `gh pr list` sees it, GitHub detects conflicts against it, and
`.github/workflows/ci.yml` skips its jobs until you mark it ready. This is not
a style preference: this repo is private on a GitHub Free plan (2,000 Linux
minutes/month) and a measured 30-day sample burned 1,956 of them, 71% on
pull-request runs. PR #55 alone spent **31 runs and 315 minutes** across 37
commits, nearly all of them on work-in-progress an agent already knew was
unfinished. Open a draft, push freely, then `gh pr ready <n>` and watch with
`gh pr checks <n> --watch --fail-fast`. `docs/guidelines/ci-cost-and-capacity.md`
carries the full accounting.
````

**Now:**

````markdown
green.** Draft status keeps the PR visible and conflict-checked while
`.github/workflows/ci.yml` skips its jobs until `gh pr ready <n>`. The minute
budget is 2,000/month and PR #55 alone spent **315 minutes** on
work-in-progress; the draft-PR guard above now asks before a non-draft
`gh pr create`. Full accounting: `docs/guidelines/ci-cost-and-capacity.md`.
````

## 7. `AGENTS.md` — criterion 2 — history of the document

**Was:**

````markdown
**Why this section changed (2026-09-21).** It prescribed only the blocking
command, from a period when sessions ran on a laptop.
`docs/guidelines/cloud-agent-sessions.md` has recorded since 2026-09-08 that
*most agent work on this repo now happens in a Claude Code remote session*, and
`subscribe_pr_activity`, `external-event` and `wake reason` appeared **nowhere**
in `AGENTS.md`, `CLAUDE.md`, `docs/guidelines/` or `.claude/` — so the one
mechanism that answers "stop polling github" was undocumented while the
complaint it answers was live. Measured context:
`docs/reviews/2026-09-21-development-loop-review.md` (A4), against 100 CI runs
across 15 branches at a median 6.6 minutes each.


````

**Now:**

*(removed — nothing replaces it)*

## 8. `AGENTS.md` — criterion 4 — restated: CLAUDE.md rule 3, which every session already has loaded

**Was:**

````markdown
- **Red first: a test is not done until it has been seen to fail.** Break the
  code it protects, watch it go red for *your* reason, restore, watch it go
  green — and put the source edit and the real failure text in the PR. Three
  tests written in one session (2026-09-02) passed while proving nothing: a
  `waitFor` on a value that could not change between retries, an effect keyed so
  it never re-ran, and an empty-patch check that accepted the emptiest patch.
  Each was caught only by doing this, retroactively. `witness` does it
  mechanically for property tests; for everything else it is manual and there is
  no substitute.
````

**Now:**

````markdown
- **Red first: a test is not done until it has been seen to fail** (CLAUDE.md
  rule 3 carries the procedure and the 2026-09-02 incident). Put the source edit
  and the real failure text in the PR. `witness` does it mechanically for
  property tests; for everything else it is manual and there is no substitute.
````

## 9. `AGENTS.md` — criterion 4 — restated: CLAUDE.md rules 1 and 2

**Was:**

````markdown
- **An e2e result may only be reported from `pnpm --filter web test:e2e:ci-like`.**
  Plain `test:e2e` serves `pnpm dev`, which compiles each route on first hit;
  `ci-like` builds and serves production, which is what CI runs. The dev lane is
  for iterating on a spec you are writing — never for a verdict, a PR checkbox,
  or a claim made to Mitchell. A failing local run now prints this at you
  (`e2e/laneReporter.ts`); it is in the manual too because the reporter only
  fires once you have already run the wrong thing.
- **Before attributing any failure to the environment, grep `docs/known-issues/`
  for the symptom.** Both times the dev-lane trap has been hit, the entry
  describing it (KI-27) already existed and was not read — the second time it
  cost a day and still reached the wrong answer, reported to Mitchell as a
  hardware limit. "Environmental", "flaky" and "infra" are conclusions that
  require evidence, and they are the two most expensive things to be wrong
  about, because both end the investigation. Useful discriminator: **a failure
  whose location moves between runs is a timeout; a real defect fails in the
  same place every time.**
````

**Now:**

````markdown
- **An e2e result may only be reported from `pnpm --filter web test:e2e:ci-like`**
  (CLAUDE.md rule 1). A failing dev-lane run also prints this
  (`e2e/laneReporter.ts`), but only after you have run the wrong thing.
- **Before attributing any failure to the environment, grep `docs/known-issues/`
  for the symptom** (CLAUDE.md rule 2). "Environmental", "flaky" and "infra"
  are conclusions that need evidence, and the most expensive ones to get wrong,
  because they end the investigation.
````

## 10. `AGENTS.md` — criterion 3 — incident narrative past one sentence

**Was:**

````markdown
**Its findings are bug reports, not noise.** It caught a fire-and-forget
navigation race in M10 Wave 2 Phase 7 that no test covered, and on #105 a
tautological assertion that `pnpm check` passed — a test reading its expected
value from the same registry entry the component reads, so a component
ignoring the registry entirely would still have passed it. Verify each finding
against the code, then fix it.
````

**Now:**

````markdown
**Its findings are bug reports, not noise** — it has caught a navigation race
no test covered (M10 Wave 2 Phase 7) and a tautological assertion that
`pnpm check` passed (#105). Verify each finding against the code, then fix it.
````

## 11. `AGENTS.md` — criterion 4 — restated three times in this section; also stale: the trap is above, not below

**Was:**

````markdown
> **The tier rule still decides, and it is a property of the whole branch.** If
> any path the branch touches falls outside `docs/**`, `.claude/**`,
> `.agents/**` or a root-level `*.md`, this does not apply — including
> `.design-sync/**`, per the trap below. Verify before pushing rather than
> assuming, which is one command:
````

**Now:**

````markdown
> **The tier rule still decides, per the whole branch** — `.design-sync/**`
> included, per the trap above. Verify before pushing, in one command:
````

## 12. `docs/milestones/README.md` — criterion 2 — history of the document

**Was:**

````markdown
>
> This is automated because the list is what kept failing. Step 5 was *added*
> to this checklist after M11a's and M11b's gate-close commits both missed it,
> and on 2026-09-21 `TODO.md`'s header still opened *"M21 is the current
> work"* four milestones after M21 closed. A sixth manual step would be one
> more thing to forget.

````

**Now:**

*(removed — nothing replaces it)*

## 13. `docs/milestones/README.md` — criterion 3 — incident narrative past one sentence

**Was:**

````markdown
   `pnpm milestone close`. This was already the stated rule — see the
   2026-09-18 note's *"annotated in place and deleted at those gates"* — and
   it was skipped: M23's entry survived its own gate closing on 2026-09-19 and
   was still there two days later. An entry that says it is *"kept here only
   for the reasoning"* is **scoped**, not placed, and is never auto-deleted.

````

**Now:**

````markdown
   `pnpm milestone close` (M23's survived its own gate by two days when this
   was manual). An entry that says it is *"kept here only for the reasoning"*
   is **scoped**, not placed, and is never auto-deleted.

7. **A retirement pass on any first-read file past 85% of its surface budget**,
   when `pnpm milestone close` lists one — `docs/guidelines/retiring-a-rule.md`.

````
