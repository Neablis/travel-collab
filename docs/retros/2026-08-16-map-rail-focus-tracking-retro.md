# Retro: map-rail-focus-tracking

**Date:** 2026-08-16
**Requested by:** Mitchell, after the feature landed on
[PR #23](https://github.com/Neablis/travel-collab/pull/23) — "there was a lot
more work on this feature than I would have expected."

He named four specific pain points to address. This retro takes each in
turn: what actually happened this session (evidence, not impression), then a
concrete proposal — not just an observation.

## Why this feature took more work than expected

For context before the four points: the plan itself (`docs/plans/2026-08-16-
map-rail-focus-tracking.md`) was unusually complete — six tasks, exact code
for nearly every step, written by a prior session after two earlier attempts
had already shipped broken. Tasks 1-5 executed close to as-written. The
actual overrun was **three review rounds during Task 6's live-verification
pass**, each finding a real, previously-unknown bug:

1. A live browser check (something the plan explicitly flagged as
   "genuinely unverified — nobody has run it") found that Tab-navigating the
   rail could leave a focused button completely invisible — a real
   accessibility regression the two prior broken attempts never had a
   chance to introduce, because they never got this far.
2. The first fix for that (a scroll-position poll) was reviewed and found to
   rest on a browser-behavior claim that didn't reproduce independently.
3. The second fix (`overflow: clip` + a focus-correction listener) was
   reviewed again and found to have introduced a *worse* regression:
   clicking a day button could silently re-focus and rescroll to a
   *different* day, for most days — caught because the review dispatched a
   live reproduction across all 14 days instead of trusting the one index
   (day 7) the existing test happened to cover.

None of this was wasted motion — each round caught something real, and the
final state is genuinely solid (verified: 14/14 clicks correct, 13/13 Tab
positions correct and visible, full suite green). But three review rounds on
one area is the concrete shape of "more work than expected," and it's worth
naming plainly: **this is what happens when the review discipline works**.
The alternative — shipping after round one — is exactly how this feature
broke the first two times. The lesson isn't "review less"; it's captured in
the sections below, mostly about *cost*, not correctness.

---

## 1. Branching, worktrees, and cleanup

**What happened.** The task's own kickoff brief pointed at a specific
worktree (`trip-map-focus-tracking-0f3e75`) already checked out on a branch
75 commits ahead of `main` — carrying the entire in-flight M10 redesign, not
just this feature. `.claude/launch.json` had six dev-server entries pointing
at worktrees that no longer existed on disk (deleted by earlier sessions
without updating the config), which caused an actual failure this session
(`cd: ... No such file or directory`) when something tried to auto-start a
preview. At finish time, "merge to main" would silently have carried all 75
commits, not the 11 I'd written — a real footgun, caught only because I
checked `git rev-list --count` before presenting options rather than
assuming scope matched my own commits.

Cleaning up afterward required actual investigative work: seven worktrees
existed on disk, most from prior sessions, and none were self-evidently safe
to delete. I had to check each one's ancestry against the current PR
(`git merge-base --is-ancestor`) and, in one case, diff file *content*
(not just commit messages) to confirm a worktree's only unique commit was a
byte-identical duplicate of something already merged. That's the right way
to do it — but it's exactly the kind of work that should not have
accumulated to seven worktrees deep before someone did it.

**Proposal.**

- **Clean up a worktree the moment its work lands somewhere durable**, not
  "later." A worktree whose branch is fully merged (or whose branch tip is
  now an ancestor of a PR's current tip) has zero reason to keep existing.
  The cost of leaving it is small per-worktree and large in aggregate — this
  session's cleanup pass took real time specifically because it had to
  reconstruct seven sessions' worth of "is this actually done" from git
  ancestry alone, with no record of intent.
- **`launch.json` should be regenerated, not hand-maintained.** A stale
  entry pointing at a deleted worktree is a silent trap for the next
  session. A small script (`node scripts/sync-launch-config.mjs`) that
  rebuilds the config from `git worktree list` would make staleness
  impossible instead of merely unlikely. *(Not built this session — flagging
  as a concrete follow-up, not implying it should have been done here.)*
- **Before offering "merge to main" as a finishing option, check scope
  first.** `git rev-list --count <base>..HEAD` against the target branch,
  surfaced automatically, would have caught the 75-vs-11 mismatch without
  relying on me remembering to check. Worth raising as a process note for
  the `finishing-a-development-branch` skill generally, not just this repo.
- **When a worktree's branch isn't the branch a PR actually tracks** (as
  happened here — my branch and PR #23's branch had diverged in *name* while
  one was a strict ancestor of the other), say so explicitly before
  presenting finishing options, the way this session did after Mitchell's
  redirect. A one-line `git merge-base --is-ancestor` check up front would
  have surfaced this before I needed to be told.

## 2. Recognizing an error loop and asking for help instead of retrying

**What happened, concretely.** After the final code review's fixes landed,
`pnpm test` failed with 13 failures — a different random subset than the
prior run, and again on a third run, with `environment` setup time 8-30x
normal. I *did* eventually investigate (`ps aux` sorted by CPU found a Steam
game at 86% CPU), but only after several retries and a fair amount of
reasoning about whether this was "the pre-existing KI-13 flakiness" before
checking the obvious external cause. Mitchell's own words after stepping in:
*"next time let me know and I'll fix the issue rather than flailing and
wasting tokens."* That's a direct, fair correction — recorded to memory this
session (`surface-resource-contention-early.md`) so it persists past this
conversation.

**The distinguishing signal was present early and I under-used it:**
different tests failing each run, generic `waitFor`/`findByText` timeouts (not
assertion-content failures), and `environment` time far outside its normal
range. That signature — cause external to the code — was recognizable after
the *second* run, not only in hindsight.

**Proposal.**

- **A concrete trigger, not a vague "be more careful":** after a **second**
  consecutive run of the same suite shows *different* tests failing with
  generic timeout errors (not the same failure twice, not a specific
  assertion), stop before a third retry. Run `ps aux` sorted by CPU/mem (or
  the equivalent for the environment) and, if there's an obvious external
  cause, **surface it and ask rather than keep retrying** — the cost of
  asking is one message; the cost of not asking, this session, was several
  minutes and a meaningful chunk of tokens across four retries.
- **Generalize past resource contention:** the same instinct applies to any
  fix/verify loop. If the *second* attempt at fixing the same symptom
  doesn't resolve it, that's the trigger to stop and either ask a clarifying
  question, escalate for more context, or deliberately change strategy
  (different diagnostic tool, fresh subagent, or a direct question to
  Mitchell) — not to try a third variation of the same approach hoping it
  lands. This session's Task-6 review loop is the positive counter-example
  worth naming: each round changed *approach* (poll → CSS fix → equation
  inversion) based on new evidence, rather than re-trying the same fix with
  minor tweaks. That's the behavior to keep; blind retrying is the behavior
  to catch sooner.
- **Where this could live:** a short addition to `AGENTS.md`'s "Working
  agreement with Mitchell" section (see the end of this doc for suggested
  wording) — Mitchell's approve/reject call, not something I should land
  unilaterally.

## 3. A formalized process for mid-implementation plan changes

**What happened.** This session didn't have a moment where Mitchell needed
to interrupt an in-flight plan (the plan was already fully written before I
started, by design). But I *did* face the equivalent from the agent side,
repeatedly: Task 6's live-verification pass surfaced real problems the
written plan hadn't anticipated (the clip-focus bug, then the fix-for-the-fix
regression), each requiring a design choice the plan didn't specify. I made
those choices autonomously — under "auto mode" license — and verified them
heavily before committing. It worked out, but it's exactly the situation
where a fast, cheap way to loop Mitchell in *before* committing to an
approach (not just report it after) would have been valuable, especially for
the second fix, which had two plausible designs (`overflow: clip` alone,
which turned out to leave the button partially visible; vs. adding a
correction — and *what kind* of correction).

**Proposal — a lightweight amendment mechanism, not a new heavy process:**

- **Distinguish two kinds of plan deviation** by risk, and treat them
  differently:
  - *Mechanical/low-risk* (a wrong comment, a stale doc claim, a test-value
    tweak to avoid a coincidental tie) — fix and note it, no pause needed.
    This session did this correctly throughout (documented every deviation
    inline, in commit messages, and in the spec).
  - *A new design decision the plan didn't anticipate*, especially one with
    more than one reasonable approach — pause and ask, even under
    auto-mode license, **before** implementing, not after. The bar: "would
    two competent engineers plausibly choose differently here?" If yes,
    that's a plan gap worth 30 seconds of Mitchell's input rather than a
    unilateral call, however well-verified afterward.
- **Keep the amendment in the plan document itself**, not scattered across
  commit messages and code comments. This session's `docs/specs/2026-08-16-
  map-rail-focus-tracking-design.md` ended up carrying a long, three-round
  narrative embedded in its "Sticky verification" section — accurate, but
  hard to skim for "what actually shipped" without reading the whole
  history. A short **"Amendments" section at the top** of a plan/spec,
  one line per deviation with a pointer to the detail, would make "what
  changed from the original plan and why" scannable without archaeology.
- This is explicitly a **proposal for Mitchell to weigh in on**, not
  something to adopt unilaterally — see suggested `AGENTS.md` wording below.

## 4. Retro after steps, and returning to known bugs later

**What happened — the good news first.** This repo already has exactly the
mechanism this point is asking for: `docs/known-issues.md`, a durable,
well-established register with 21 entries, clear severity tiers, and a
track record of being revisited (KI-13 already had two prior investigation
rounds before this session added a third). The `subagent-driven-development`
skill's progress ledger (`.superpowers/sdd/progress.md`) also worked well
*within* this session — every task's review outcome, every deviation, every
Minor finding left unfixed was logged there as I went, which is exactly the
kind of running retro this point asks for.

**The gap:** that ledger is gitignored scratch, scoped to one session. Two
real findings from today's review rounds — the `m1-board`/`m4-money-and-
lenses` e2e flakiness (confirmed real, confirmed unrelated to this branch,
via git-stash and clean-DB testing) and the third root cause found for
KI-13 — existed only in that scratch ledger and this conversation until I
went back and filed them as **KI-21** and a KI-13 addendum, respectively,
as part of writing this retro. That filing should have happened at the
point of discovery, not retroactively.

**Proposal.**

- **File a `known-issues.md` entry at the moment a Minor/deferred finding is
  confirmed, not at session end.** The bar for "worth filing" is already
  well-defined by the existing entries: something real, verified, and
  deliberately left unfixed. This session generated two qualifying findings
  during the review rounds and both should have been filed then.
- **The progress ledger already does the "retro after each step" job well —
  keep using it as-is.** No process change needed there; the gap is purely
  "promote durable findings out of session scratch," not "add more
  retrospection."
- **A one-line habit, not a new tool:** whenever a task or review round
  produces a finding categorized "known, not fixing now" (as opposed to
  "fixed" or "not real"), the next action is either fix it or file it —
  never just mention it and move on.

---

## `AGENTS.md` amendments

Mitchell approved both proposals; they now live in "Working agreement with
Mitchell," right after the existing subagent-delegation paragraph
(`AGENTS.md:43-53`):

> **Recognize an error loop and stop, don't retry through it.** If the same
> class of fix has been attempted twice without resolving the issue — or a
> test/build suite fails with a *different* random subset each run — stop
> before a third attempt. Check for an external cause (`ps aux`, `docker
> ps`, disk/network) if the failure looks environmental; if the cause isn't
> yours to fix, say so and ask rather than keep retrying.

> **Pause before a plan-deviating design decision, not just after.** A
> mechanical fix (a wrong comment, a stale doc claim) doesn't need a pause.
> A new design choice the plan didn't anticipate — especially one where a
> competent engineer could reasonably choose differently — does, even under
> auto-mode license. Ask first; verify and report after.
