# Retro: the M9 planning session that shipped code

**Date:** 2026-09-15
**Requested by:** Mitchell, mid-execution on
`claude/m9-plan1-step-quota` — "We are still just doing the implementation
plan right? This has been running longer than i expected."

That question is the finding. Nothing in the session had gone wrong in a way
either of us could point at: every step was sanctioned, every artifact was
good, the code that landed is correct and closes two known issues. What went
wrong is that a session that opened with two read-only questions ended four
commits of production code later, and neither of us noticed the transition
happen. He named three problems afterwards — token waste, no separate start,
and starting M9 against an unmerged M21. This retro takes each in turn, and
adds a fourth thing worth keeping, because the session also produced the best
available evidence *for* the rule it broke.

## What actually happened, with timestamps

The session opened on 2026-09-14 with:

> give me a breakdown of the milestones

then:

> break down the open known issues by the milestone they were filed in

Both read-only. Neither asks for a design, a plan, or a line of code. The
path from there:

| | Artifact | Evidence |
|---|---|---|
| 1 | Milestone breakdown (read-only) | — |
| 2 | M9 deep-dive (read-only) | — |
| 3 | Brainstorming three new features | Mitchell's three asks, quoted in the spec's header |
| 4 | A 489-line design spec | `docs/specs/2026-09-15-M9-assistant-and-new-trip-design.md` |
| 5 | A 529-line implementation plan | `docs/plans/2026-09-15-M9-01-step-quota-concurrency.md` |
| 6 | Subagent-driven execution of that plan | 4 code commits, `20:55`–`08:10` |

Both documents landed in one commit, `56340d3` — *"docs(M9): the design for
M9's remainder, and plan 1 of 8"*, authored **2026-09-14 20:50**. The first
code commit, `49aab38`, is five minutes later at **20:55**. There is no pause
between the plan and the build; the same session wrote both and then ran one
into the other.

The work itself is fine. `git diff b49832e..claude/m9-plan1-step-quota`
is 12 files, +1468/−122: a `StepReservation` handle and a window-conditional
`release` in `quota.ts`, `reserveAiSteps` replacing the one-step
pre-authorisation, reconciliation in `settleAiSteps`, and KI-94/KI-97 moved
to resolved. That is not the complaint and this retro does not treat it as
one.

---

## 1. Where the stop-line was, and why it was invisible

**The stop-line was commit `56340d3`.** A plan is a finished artifact. It has
a name, a location, a reader, and a defined next action ("REQUIRED SUB-SKILL:
use `superpowers:subagent-driven-development` to implement this plan
task-by-task" — the plan says so in its own header). Committing it is a
delivery. The session treated it as a milestone *inside* a longer task.

**Why it was invisible: every individual step was sanctioned, and none of them
was the one that crossed the line.** "Break down the milestones" → "tell me
more about M9" → "here are three things I want" → "write that up" → "plan the
first one" → "go" is six reasonable local decisions. Each one is a small step
from the last. The aggregate is a category change — from *answering questions
about the roadmap* to *changing the assistant's quota kernel* — and no single
step contains it. This is drift by increments, and increments are exactly what
step-by-step approval cannot catch: Mitchell was approving the next step, not
re-approving the trajectory.

**The tell that should have fired.** The session invoked
`superpowers:brainstorming`, then `writing-plans`, then
`subagent-driven-development`. That is three *process* skills in one
conversation, and each one exists because the phase it governs is different in
kind from the phases either side of it. Three process skills in one context is
not a workflow; it is three workflows that were never separated. **Reaching for
a second process skill in a session that already completed one is the
observable signal** — cheaper to notice than "am I drifting," because it is a
fact about the transcript rather than a judgement about intent.

**What the correct end of that session looks like:** commit `56340d3`, run
`next-prompt` to write the handoff, and stop. Total output: a spec, a plan,
and a paragraph telling the next session where to start. The next session
opens with the plan and nothing else.

## 2. The cost of running five phases in one context

**What it cost.** Orientation, design, spec-writing, plan-writing and
execution all shared one window. By the time the first implementer subagent
was dispatched, that context already held: a full milestone breakdown, a
known-issues census grouped by milestone, an M9 deep-dive, a brainstorm over
three features, a 489-line spec, and a 529-line plan — **1018 lines of
document alone**, before any code was read. Every subsequent turn re-sent all
of it. None of it was needed to execute plan 1, which is a self-contained
document naming four tasks over two source files.

The repo already knows this. `AGENTS.md`'s working agreement mandates subagent
delegation for exactly this reason — *"a subagent's own reads/edits/tool
traffic don't accumulate there, only its report does."* The session **did**
delegate; it used `subagent-driven-development` properly and the implementer
traffic stayed out of the main thread. What it did not do is apply the same
reasoning one level up. **Delegation keeps a phase's tool traffic out of the
controller's context. It does nothing about the four earlier phases already
sitting in it.** Subagents solve the within-phase problem; only a session
boundary solves the across-phase one.

**The second cost is subtler and it is not tokens.** A design context makes a
poor execution context. Having just argued the design, the session knew what
the plan *meant*, and read it for confirmation rather than for instruction. §4
is what that cost, measured.

## 3. Starting M9 while M21 was in flight

**The factual position at `20:50`.** `docs/STATUS.md` had M21 as the current
milestone, opened 2026-09-14, with the order
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 ✓ → M21 → M12 → M13 → M14 → M19`, and
**nine of seventeen M21 exit-gate boxes ticked**. PR #177 was open. It merged
as `b49832e` at **20:54** — **four minutes after** M9's design commit was
authored.

**The risk, stated honestly.** #177 is 79 files. The M9 work touches five:
`quota.ts`, `assistant/admission.ts`, `ai/admissionPorts.ts`,
`ai/handleAskRequest.ts`, and `ask/route.int.test.ts`. #177 touches **none of
them** — verified after the fact, and the rebase onto `b49832e` was clean. So
this one did not bite.

But that is a result, not a process, and the near-miss is closer than the
file lists suggest. The admission call M9 plan 1 rewrites is
`consumeQuota([...aiQuotas(ceilings), ...aiStepQuotas(ceilings)])`
(`admissionPorts.ts:91`). Those `ceilings` are produced by
`resolveAiEntitlements` in `server/entitlements/resolver.ts` — reached via
`modelSelection.ts` — **and #177 changed `resolver.ts`.** It also rewrote
`AssistantRail.tsx` (+191), added `useAiEntitled.ts`, and reworked
`planVersions.ts` and both `accountPlan.ts` files. So the two changes did not
share a file, but they shared the value flowing through one: #177 was
redefining what a ceiling *is* while plan 1 changed how one is *charged*.
**That overlap needed checking, and it was not checked until Mitchell raised
it.** A
conflict there would not have been a merge conflict to resolve; it would have
been two sessions independently changing what an admission decision means, with
the second one's tests passing against a base that no longer existed.

**The sharper point: a rule for this already exists and did not fire.**
`docs/milestones/README.md:6` — *"No building ahead of the current
milestone."* `AGENTS.md:475` repeats it. M9 sits *earlier* than M21 in the
order, so resuming it does not read as building ahead; it reads as catching up.
That is the gap. **The rule names direction; the hazard is concurrency.**
Starting a paused earlier milestone while the current one has eight unticked
gate boxes is the same hazard the rule was written for, and the rule's wording
lets it through.

**One thing the session got right, worth recording so the rule is not written
too tight.** The spec's §10 lists **eight decisions Mitchell owed before
build**. Plan 1 (KI-94 and the refund primitive) is item 1 of the spec's own
build order and depends on none of the eight — it is the one slice that was
genuinely unblocked. So the drift was into *execution timing*, not into work
that was waiting on Mitchell. A rule that forbids starting any code before
every open question closes would be wrong, and is not what this retro proposes.

## 4. The finding worth keeping: a plan is under-verified in its own context

This is the part that is evidence rather than regret.

`subagent-driven-development` mandates a pre-flight conflict scan before Task 1
is dispatched — *"Before dispatching Task 1, scan the plan once for
conflicts… one row for every task: whether its own text agrees with itself —
the tests it specifies against the code it specifies."* It ran here, against a
plan written **minutes earlier, in the same conversation, by the same
context.** It found **four defects:**

1. **Wrong call site.** The plan's Task 3 Step 5 says *"In
   `apps/web/src/server/ai/handleAskRequest.ts`, the admission stage calls
   `consumeQuota(aiStepQuotas(...), ...)`."* It does not. At `b49832e` the
   admission call is `apps/web/src/server/ai/admissionPorts.ts:91`;
   `handleAskRequest.ts:326` carries only the *settle* call. The plan's Files
   list named one file for a change that lives in two.

2. **An unmigrated test.** `apps/web/src/app/api/trips/[tripId]/ask/route.int.test.ts`
   asserts the step-ceiling behaviour and appears **nowhere in the plan** — not
   in a Files list, not in the check subset, not in the commit command. It took
   a 48-line migration (`81547fc`) that no task budgeted.

3. **Five stale signatures.** The plan adds a **required** `release` method to
   the `QuotaCounters` interface and specifies implementing it in exactly one
   fake ("Step 4: Implement it in the fake, in the test file"). At `b49832e`
   there are six inline `QuotaCounters` literals across `quota.test.ts` and
   `quota.property.test.ts`. Five of them were left to break.

4. **An unplanned thread through `AiGrant`.** The reservation is created in
   `admissionPorts.ts` and consumed in `handleAskRequest.ts`. The only channel
   between them is the grant returned by `evaluateAiGrant` in
   `assistant/admission.ts`. `AiGrant` is **not mentioned once** in 529 lines of
   plan — yet `admission.ts` took +73 lines and `admissionPorts.ts` +30, neither
   of which the plan lists as a file it modifies.

**What this demonstrates.** All four are the same class of error: **the plan
asserted things about the codebase that the codebase does not say.** A plan
written in a fresh session cannot make them, because a fresh session has to
open the files to find out. A plan written in the design session's context
makes them freely, because that context already "knows" the shape of the code
from having discussed it — and a discussion is not a `git grep`.

**So the separate-session rule is not only a cost argument.** The cheap version
is "fresh sessions use fewer tokens." The real version is: **a plan read for
the first time in a new context gets verified; a plan read in the context that
wrote it gets recognised.** Four defects in a plan minutes old, caught by a
scan whose entire job is to read the plan against the code as a stranger would,
is the measurement. The scan did its job — this is the discipline working, the
same way the map-rail retro's three review rounds were. The lesson is not
"scan harder." It is that the scan was doing a job the session boundary should
have done first, and the next plan should not need it to find four.

---

## Proposed amendments — Mitchell's call, not landed

Neither file is edited. Both proposals are written as the exact text to insert.

### A. `AGENTS.md` — "Working agreement with Mitchell"

Insert after the subagent-delegation paragraphs (`AGENTS.md:36-48`), because
it is the same argument one level up: that paragraph keeps a phase's traffic
out of the thread, and this one keeps the previous phases out.

> **Design, plan and execute are three sessions, not three phases of one.**
> A session that produces a spec or a plan hands off; it does not then build
> from it. Commit the document, run `next-prompt`, stop. Two reasons, and the
> second is the load-bearing one. The cheap one: the design context is the
> most expensive context in the repo, and execution re-sends all of it for
> nothing. The real one: **a plan read for the first time in a fresh session
> gets verified against the code; a plan read in the session that wrote it
> gets recognised.** Measured 2026-09-15 — the pre-flight conflict scan found
> four defects in a 529-line plan written minutes earlier in the same context:
> a call site that named the wrong file, an integration test the plan never
> mentioned, five interface implementations left stale, and a whole type the
> change had to thread through unnamed. The signal that you have crossed a
> boundary is **reaching for a second process skill** (`brainstorming` →
> `writing-plans` → `subagent-driven-development`) in a session that already
> completed one. The exception is a change small enough that no plan document
> was written; if you are invoking `subagent-driven-development`, it is not
> that.

### B. `AGENTS.md` — "Milestone discipline and drift detection"

The existing preflight (`docs/milestones/README.md:32`) reconciles the
*previous* milestone's status flags. It does not ask whether that milestone's
code has landed. Insert after the "Do not build ahead" paragraph
(`AGENTS.md:475-479`):

> **Before the first commit of a new milestone's code, confirm the current
> milestone's work is merged.** `gh pr list --state open` plus the current
> milestone's exit-gate count. If a PR is open, the new branch does not start
> until it lands — or, if Mitchell wants it started anyway, the preflight
> records the open PR's changed files against the files the new work will
> touch, and **that comparison is what he approves**, not a general assurance.
> **Resuming a paused milestone counts as starting one.** M9 is earlier than
> M21 in the order, which made resuming it read as catching up rather than
> building ahead — the rule above names a direction, but the hazard is
> concurrency, and an earlier milestone is just as concurrent as a later one.

And one bullet for that section's drift-signal list:

> - A new milestone's code begins while the current milestone has an open PR
>   or unticked gate boxes with work in flight.

### C. `CLAUDE.md` — recommend **not** adding a fifth rule

CLAUDE.md's four rules share a property: each is a *verification* rule that
was violated, measured, and re-violated. Both proposals above are
session-shape rules, and AGENTS.md's working agreement is where the other two
session-shape rules already live (error loops, plan-deviating decisions), both
added by the 2026-08-16 retro. Adding a fifth CLAUDE.md rule would split that
family across two files.

**If Mitchell wants the handoff rule at first-read prominence**, the smaller
change is one line in CLAUDE.md's existing quick-orientation list rather than
a fifth numbered rule:

> - When a session must hand off instead of continuing (design → plan →
>   execute are three sessions): `AGENTS.md`, "Working agreement with
>   Mitchell"

---

## Status of the work this retro is about

`claude/m9-plan1-step-quota` carries six commits, rebased cleanly onto
`b49832e`. The code is correct, KI-94 and KI-97 are resolved, and M9's
step-ceiling gate box carries an implementation note (it stays unticked —
`- [ ]` with *"Confirm at the gate; do not rebuild"*, which is the right
call: the gate is not this branch's to close). **Nothing here argues for
reverting it.**
The argument is about where the session should have ended, not about what it
produced after it didn't.

The session ledger
(`.superpowers/sdd/2026-09-15-M9-01-step-quota-concurrency/progress.md`),
which held nine numbered rulings including the four pre-flight findings above,
**no longer exists** — it is gitignored scratch and was cleaned up. The four
defects in §4 were reconstructed from the branch diff against `b49832e`
rather than read from the ledger. That is the 2026-08-16 retro's §4 finding
recurring: durable findings have to be promoted out of session scratch at the
moment they are made. **These four were worth a retro and nearly died with a
temp directory.**
