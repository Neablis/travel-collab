# AGENTS.md — Operating Manual for travel-collab

This file is the contract between every agent (and human) working in this repo.
Read it fully before making changes. When instructions here conflict with an
ad-hoc request, surface the conflict instead of silently picking one.

## What we are building

A collaborative travel-planning platform: users plan vacations (an "Epic")
composed of days and activities, with an immutable change history (undo, revert,
fork-with-lineage), soft-conflict validation, and — in later phases —
multi-user collaboration, community sharing, rich trip pages, cost rollups, and
AI generation.

Think: Jira's planning + git's history + Notion's editing, for vacations.

**Current phase: 1 (full single-player product).** The active milestone lives in
one place — `docs/milestones/README.md` ("Current milestone"); do not restate the
number here (that duplication is how it drifts).
Current state of the work — blockers, in-flight, next action, local dev recipe:
`docs/STATUS.md` (read first on a fresh session).
Design record: `docs/specs/2026-07-07-foundation-design.md` · Decisions:
`docs/architecture/` · Roadmap: `TODO.md` + `docs/milestones/README.md` ·
How-to guides: `docs/guidelines/`

Implementation plans are **archived, not checked out** — `docs/plans/README.md`
explains why and how to retrieve one from history.

## Working agreement with Mitchell

Discuss before building. Design decisions, new structure, and scope changes are
presented with trade-offs and get explicit approval before files or code are
created. Challenge weak ideas directly; record decisions in ADRs after they are
made, not before.

**Default to subagent delegation for implementation work** (writing code,
editing files, running tests) — via the Agent tool / `subagent-driven-development`
— rather than doing it directly in the main conversation thread. This keeps the
main thread's context lean across a long multi-task session: a subagent's own
reads/edits/tool traffic don't accumulate there, only its report does. State the
delegation choice before starting each task or phase, not after the fact.

Live, iterative debugging against a running dev server or browser session is the
standing exception — a subagent can't share that session, and the tight
try-something/read-result loop doesn't survive a handoff. But say so explicitly
at the point of that decision: name the specific reason delegation doesn't fit,
and say plainly that delegation is off for this piece of work, rather than
silently falling back to inline work without flagging it.

**Recognize an error loop and stop, don't retry through it.** If the same
class of fix has been attempted twice without resolving the issue — or a
test/build suite fails with a *different* random subset each run — stop
before a third attempt. Check for an external cause (`ps aux`, `docker ps`,
disk/network) if the failure looks environmental; if the cause isn't yours to
fix, say so and ask rather than keep retrying.

**Pause before a plan-deviating design decision, not just after.** A
mechanical fix (a wrong comment, a stale doc claim) doesn't need a pause. A
new design choice the plan didn't anticipate — especially one where a
competent engineer could reasonably choose differently — does, even under
auto-mode license. Ask first; verify and report after.

## The module map (structural law)

Modules own their data and commands; they reference other modules by ID only.

| Module | Owns | Storage model | Explicitly does NOT know about |
|---|---|---|---|
| **Identity** | accounts, OAuth, sessions, profiles | CRUD + audit fields | trips, invites, anything travel |
| **Trip Planning** | trips, days, activities, itinerary structure | **event-sourced** | who's invited, sharing, votes |
| **Access & Membership** | invites, roles, revocation, share grants | CRUD + audit fields | what a trip contains |
| **History** | event log, replay, undo/revert, fork lineage | the substrate itself | domain semantics (stores/replays, never interprets) |
| **Conflict Engine** | validation rules, Conflict objects | pure functions | UI, storage |
| **Community** (Phase 3) | gallery, votes, reports | CRUD + audit fields | planning internals (consumes published snapshots) |

**The AccessPolicy seam:** Planning never contains invite/permission logic. It
asks an `AccessPolicy` interface "may this actor do this?". In Phase 1 the only
implementation is "actor is the owner." Phase 2 swaps the implementation, never
the callers.

## The Invariants (violating these is never a valid shortcut)

1. **The event log is the sole source of truth for the planning domain.**
   Every trip change is `command → validate → append event(s) → update
   projections`. No code path ever writes a planning projection table directly.
   This is deliberately **scoped** (ADR-003): Identity/Access/Community are
   ordinary CRUD. If a feature seems to need half its state evented and half
   not, that is a boundary smell — stop and escalate to Mitchell.
2. **Projections are disposable.** Every planning read model must be rebuildable
   from the log; a golden "rebuild equals stored" test guards this.
3. **Conflicts are data, not errors.** Scheduling overlaps, date-anchored events
   broken by a reschedule, and (later) concurrent-edit collisions are `Conflict`
   objects with severity and suggested resolutions. No blocking modal errors for
   plan-consistency problems.
4. **The domain core is pure.** `packages/domain` performs no I/O — no database,
   no HTTP, no wall-clock reads (time is passed in). Depends only on
   `packages/contracts`.
5. **Contracts change by protocol, not by drift.** Cross-boundary types live in
   `packages/contracts` (Zod schemas; types inferred, never hand-written twice).
   Contract changes require a `docs/contracts/CHANGELOG.md` entry and all
   consumers updated in the same PR.
6. **Single-player now, multi-persona always.** Three day-one rules keep Phase 2
   additive: (a) every event carries `actor_id`; (b) no "the user" singletons —
   a trip has a members list (of one), never an owner baked into queries;
   (c) all permission checks go through the AccessPolicy seam.

## Architecture map and dependency rules

```
packages/contracts   Zod schemas: commands, events, DTOs, Conflict. Depends on nothing.
packages/domain      Pure core: aggregates, command handlers, reducers, conflict
                     engine, projection functions. Depends on contracts only.
apps/web             Next.js all-in-one (UI + route handlers/server actions).
  src/server/**      The ONLY code that may import packages/domain. Owns the
                     event store (Postgres), auth, CRUD modules, command pipeline.
  everything else    UI. May import packages/contracts and the typed API client.
                     MUST NOT import packages/domain or src/server internals.
```

The UI/server lint wall is CI-enforced and is our escape hatch: if serverless
stops fitting (likely at Phase 2 realtime), `src/server` extracts into a
standalone service without touching domain or contracts (ADR-002).

## Repo automation (check here before hand-rolling a workflow)

Committed in the repo, so every session and every worktree has them.

**State digest** (`pnpm state`, `scripts/state-digest.mjs`): the "where are we"
answer, extracted rather than summarized — current milestone and its exit-gate
tally, the first unchecked TODO, STATUS.md's leading block, open PRs, a
worktree count, and an open-KI count with the newest few. Every line carries a
`file:line` citation, so a session that needs the detail opens one file at one
offset instead of `cat`-ing 50KB of it. The `SessionStart` hook prints it on
both branches, so it has usually already run before you start; `/roadmap` calls
it for its Steps 1 and 3, then spends its turn on the judgement the script
refuses to make. It defers twice on purpose: a worktree count rather than an
audit (that is `worktree-hygiene`), and a named mismatch rather than a verdict
when the status sources disagree (that is `/roadmap`). Why it is a script and
not one more thing to invoke: `docs/reviews/2026-09-02-session-tooling-review.md`
(R1, findings F1/F2/F8) measured 2,621 orientation re-reads across 220 sessions,
~1.9M tokens, against 9 sessions that thought to run `/roadmap`.

**Slash commands** (`.claude/commands/`):

| Command | What it does |
|---|---|
| `/roadmap` | Every milestone, where we are, what's next — and reconciles the four places status flags drift apart |
| `/next-prompt` | Generates a self-contained handoff prompt from real state, separating what is proven from what is assumed |
| `/ki-sweep` | Clears independent known issues via parallel `ki-fixer` agents in isolated worktrees, respecting milestone and contracts constraints |
| `/cleanup-orphans` | Finds orphaned PRs, branches, worktrees and stale sessions. Reports first; deletes nothing without per-category approval |
| `/dispatch` | Sets up a subagent protocol run — splits the work, writes the manifest the enforcement hooks read, emits one brief per unit, and drives the promotion gate at teardown |

**Subagents** (`.claude/agents/`): `phase-implementer`, `phase-verifier`,
`ki-fixer`. Dispatch these rather than writing the prompt again — `phase-verifier`
in particular drives the PR's Vercel preview, so the browser walk works from a
container with no local infra.

**Skills** (`.claude/skills/`): `minimal-check-subset` (narrowest sufficient
check), `ci-triage` (scoped failing-job logs), `worktree-hygiene` (read-only
worktree audit).

**Fixture check** (`pnpm seed:verify`): folds the canonical Japan demo trip
through the real domain and reports counts, kind/tag coverage, coordinates,
rollups and conflicts against a recorded baseline. Runs inside `pnpm check`
too; the standalone command is for the readable table. See ADR-030.

**Hooks** (`scripts/hooks/`): a `PostToolUse` typecheck of the touched package
on every `.ts`/`.tsx` edit, and a `PreToolUse` guard on history-rewriting git
commands while multiple worktrees exist.

**The subagent protocol** (`.claude/protocol/`): `CONTRACT.md` is binding on
every dispatched subagent — lifecycle, the three exit states, the two-strike
handback rule, the run-scoped board, and the report shape. `ADAPTER.md` and
`adapter.json` carry every travel-collab-specific fact; the other three files
are portable and a test enforces that they name nothing about this repo. Four
hooks enforce it: file scope and resource leases before a tool call, report
conformance at subagent stop, and a teardown reminder at session stop. All
four fail open, and three no-op when no run is active. Report conformance is
the exception: it never reads the manifest, and engages for any subagent whose
final message carries an `## Exit:` heading — run or no run. Design:
`docs/specs/2026-08-28-subagent-operating-contract-design.md`.

## Workstreams (how agents divide the work)

Agents work per-boundary and meet at `packages/contracts`:

- **Domain agent** — aggregates, reducers, conflict engine. Pure, exhaustively
  unit-tested functions.
- **Server agent** — event store, command pipeline, auth, CRUD modules,
  projections in `apps/web/src/server`. Integration-tested against real Postgres.
- **UI agent** — pages/components against the typed client with MSW mocks
  **hand-written against the contract schemas** (`apps/web/src/mocks/handlers.ts`
  — nothing generates it); features work against mocks before the server exists,
  and a new route costs a hand-written handler.

Rule: a contract change (schema + changelog + all consumers) is its own reviewed
step before dependent feature work continues.

Rule: parallel implementers each work in their **own git worktree** and merge
back sequentially — never a shared working tree. Even with fully disjoint file
sets, concurrent agents race on git's index and refs: in M3, one agent's `git
reset --soft` (fixing its own over-broad commit) silently dropped a sibling's
already-committed work from the branch tip — recovered only because it survived
uncommitted in the working tree. Isolate via `superpowers:using-git-worktrees`.

Rule: a milestone phase or task branch worked independently of others (not the
worktree case above — separate sessions, separate branches, over separate days)
is not "done" until its **PR is open**, even if review/merge happens later.
Recording completion in a branch-local `docs/STATUS.md` does not count — no
other session or Mitchell will ever read a `docs/STATUS.md` that only exists on
an unmerged branch; a PR is the only thing that makes finished work visible and
puts it in front of GitHub's own merge-conflict detection while the diff is
still small. In M10 Wave 2, Phase 3's branch (`claude/m10-phase-3-rack`) was
fully built and verified in a real browser on 2026-08-22, recorded "done" in
its own branch-local `STATUS.md` — and then sat with no PR while Phase 4 was
built independently on `main` and merged first (PR #25), leaving Phase 3
diverged 12 commits each way with a likely `TimelineLens.tsx` conflict, only
noticed a day later when a fresh session went looking for "the next milestone"
and its own task list still claimed Phase 3 as done. Before starting new
phase/milestone work that another session's docs describe as independent,
check for sibling `claude/*` branches on the current milestone first (`git
branch -a`, `git ls-remote --heads origin`) — a finished-but-unmerged one needs
a PR opened (or an explicit, recorded reason it's being left) before you add
more parallel work on top of it.

Rule: **open that PR as a draft, and mark it ready only when you believe it is
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

## Definition of Done (every change)

### Verification scales to the change

This section used to open with a single line — *"typecheck, lint, and all tests
pass locally (`pnpm check`)"* — under a header that says **every change**. It
was followed literally, including on changes that touched nothing but prose.
Running the full suite to fix a typo in `TODO.md` is not caution; it spends
local wall clock, Claude tokens reading the output, and — once a PR is open and
someone starts watching it — time waiting for checks that `paths-ignore`
guaranteed would never report.

Classify the change by what it touches, then run **only** that tier.

**Tier 1 — prose only.** Every path changed **by the whole branch**, not just
by your latest commit, is under `docs/**`, `.claude/**`, `.agents/**`, or is a
root-level `*.md` (`README`, `AGENTS`, `CLAUDE`, `TODO`).

> **The "whole branch" is load-bearing, and was got wrong once — here, while
> writing this.** For `pull_request` events GitHub evaluates `paths-ignore`
> against the **entire PR diff against base**, never against the push that
> triggered the run. So a docs-only commit pushed onto a PR that already
> contains code re-runs the full suite, every time. Verified on PR #103:
> a commit touching seven prose files ran `static-and-unit` **and**
> `integration-e2e` to completion.
>
> Practical consequence: once a branch has any code in it, it is Tier 2 for
> the rest of its life, however prose-only the next commit looks. Tier 1 is a
> property of the branch, not of the change in front of you.

> Run nothing. No `pnpm check`, no test lane, no typecheck, no e2e, no browser.
> `.github/workflows/ci.yml`'s `paths-ignore` and `.coderabbit.yaml`'s
> `path_filters` already exclude exactly these paths, so there is no check to
> wait for and no review to collect — see *Do not watch what cannot run* below.
>
> **The trap:** `.design-sync/**` is **not** prose. It is a real build input —
> `api/dev/reset-demo-data/route.ts` imports its seed JSON — so a change there
> is Tier 2 even when only its markdown moved. `ci.yml` gets this right by
> listing `*.md` rather than `**/*.md`; classify the same way.

**Tier 2 — code, mid-branch.** Any change that is not Tier 1, before the branch
is ready.

> Run the `minimal-check-subset` skill's output **and nothing more** —
> typically `pnpm --filter <pkg> typecheck`, that package's lint, and the
> specific test files covering what you touched. The KI workflow has been doing
> this correctly for months; read any check-subset line in
> `docs/known-issues/resolved/` for the shape. It is now the rule rather than
> one skill's preference.
>
> "Narrowest sufficient" is not "smallest": for a change under
> `packages/contracts/src` the skill says do not narrow at all, because the
> consumers span packages — there, the sufficient subset genuinely *is*
> `pnpm check`. That is the skill deciding, not a reflex, and it is the only
> way a full run gets earned before Tier 3.
>
> Record the subset you ran in the PR body. "Not run, and why" still applies.

**Tier 3 — final review.** The branch is finished and about to leave draft.

> Run `pnpm check` **once, here**. Add `pnpm --filter web test:e2e:ci-like` if a
> user flow changed, and `pnpm seed:verify` if a contract field or fixture
> changed. This is the single full-suite run a branch pays for. Then
> `gh pr ready <n>` and let CI be the second opinion — that is what CI is for,
> and `ready_for_review` is exactly when `ci.yml` starts paying attention.

A mid-branch full-suite run is a judgment call to justify, not a reflex. If you
genuinely need one — you are chasing a failure whose blast radius you cannot
bound — say so in the PR body rather than running it silently.

### What the change itself must carry

Independent of tier. Most of these are no-ops for a Tier 1 change, which is the
point: they describe the change, not the ceremony around it.

- New domain logic has unit tests; new endpoints have contract + integration
  tests; new user flows extend the milestone e2e script.
- The projection-rebuild golden test still passes if events or reducers changed.
- **If the change adds a contract field, the demo fixture exercises it.** A
  field no fixture carries has no demo, no preview and no screenshot — M18's
  tag chips shipped against a preview whose data had zero tags. Add it to
  `@tc/fixtures` and to the expectations, then run `pnpm seed:verify`.
  `docs/guidelines/fixtures-and-seed-data.md` is the procedure.
- **What the change delivers is reachable by clicking, or the PR body says what
  it is not yet reviewable as.** A slice can be coherent to the architecture and
  invisible to a person — PR #141 opened as "the primitives, not in the picker",
  which was a defensible boundary and produced *"how am i spose to test any of
  this if they arent in the picker? … this is another milestone thats not
  functionally reviewable"*. Rebuilding the boundary mid-PR cost more than
  drawing it there first. The test is one question asked before you start: **on
  the preview, what does a person click to see this?** "Nothing yet, and here is
  the walk that will exist when link N lands" is a fine answer written down and
  a bad one discovered in review.
- No invariant weakened. If one blocked you, that is a finding to report to
  Mitchell, not a rule to bend.
- Docs updated when behavior or interfaces changed (ADR for irreversible
  decisions, changelog for contracts).
- **If the change adds a Drizzle migration, say so in the PR body.** Merging no
  longer applies it: production migrations are dispatched explicitly via the
  `migrate-production` workflow (`gh workflow run migrate-production.yml -f
  confirm=migrate`, from `main`). A merged-but-undispatched migration is a
  production schema drift waiting to happen, and the PR body is the only place
  anyone will look for it. See `docs/guidelines/environments-and-deploys.md`.
- The PR uses `.github/PULL_REQUEST_TEMPLATE.md` and its **Verification
  actually performed** section is filled in honestly — including which tier you
  ran and why. A step you did not run is recorded on the "Not run, and why"
  line. Four consecutive M10 phases shipped with a verification step skipped
  and nothing on the PR saying so; an unchecked box is a fine outcome, a silent
  skip is not. A tier stated plainly ("Tier 1, prose only, nothing run") is a
  complete answer, not an admission.

### Waiting on PR checks — do not hand-poll

One blocking command covers every check that runs automatically:

```
gh pr checks <n> --watch --fail-fast
```

Hand-polling with repeated `gh pr checks` is a reliable time sink; that is why
this is written down rather than left to each session to rediscover.

### CodeRabbit is Mitchell's step, not an automated one

**Decided 2026-09-01. Do not wait on CodeRabbit, and never read its status as
evidence.** It is out of the automated loop entirely — `--watch` above covers
CI, not this.

Why, in one line each. Auto-review is **off** for this repo (public, 0 stars,
below CodeRabbit's 10-star OSS gate), it posts a **green status while
skipping** so `--fail-fast` exits 0 on a PR it never read, a review takes
**~21 minutes**, and **any push during that window aborts it** — so an agent
that triggers mid-work reliably gets nothing. The full evidence, including the
two status descriptions that differ only in wording, is `KI-2026-09-01`.

**The flow instead:**

1. **Agent finishes the work** — CI green on the real head, review threads
   answered, nothing left to push.
2. **Agent hands off to Mitchell in chat** (not as a PR comment): *"PR #N is
   green and ready — trigger CodeRabbit before merging."* This is the only
   step that replaces the automated check, so it is not optional and not a
   footnote at the end of a long message.
3. **Mitchell triggers it**, by commenting `@coderabbitai review` on the PR or
   ticking `🔍 Trigger review` in CodeRabbit's own comment.
4. **Nobody pushes for ~21 minutes.** A push aborts the review and the abort
   only shows up as an edit to an existing comment, which is easy to miss.
5. **Findings get addressed**, and the agent says plainly whether the fix was
   substantive enough to want a re-trigger, or small enough to merge on. That
   judgement is the agent's to state and Mitchell's to take.
6. **Mitchell merges.**

**An agent may trigger it itself only when it is certain it is done pushing** —
same rule, since the ~21-minute quiet window is the real constraint. If in
doubt, hand off instead; a review that aborts is worse than one not yet asked
for.

**Its findings are bug reports, not noise.** It caught a fire-and-forget
navigation race in M10 Wave 2 Phase 7 that no test covered, and on #105 a
tautological assertion that `pnpm check` passed — a test reading its expected
value from the same registry entry the component reads, so a component
ignoring the registry entirely would still have passed it. Verify each finding
against the code, then fix it. Scope and verbosity live in `.coderabbit.yaml`;
tune that file rather than ignoring comments in bulk.


**One trap, hit while writing this down:** immediately after a push, `--watch`
can return in about a second reporting the *previous* commit's checks, all
green, because GitHub has not registered the new run yet. That reads exactly
like "my push passed." Confirm the run exists for your actual HEAD first:

```
git rev-parse --short HEAD
gh run list --commit <sha> --limit 1
```

Then watch. Waiting for the run to appear is the only reliable ordering.

### Do not watch what cannot run

That ordering rule has a second half, and skipping it is how a session spends
ten minutes on a documentation edit. `--watch` is right **when checks will
exist**. Two cases where they will not:

- **A Tier 1 PR** — meaning the *whole PR* is prose, per the caveat in Tier 1
  above. `ci.yml` skips it by path and `.coderabbit.yaml` filters it out, so
  there is no terminating event to wait for. A prose commit on a PR that also
  carries code is **not** this case: that run happens, and you wait for it.
- **A draft PR.** `auto_review.drafts: false` and the `if:` guards in `ci.yml`
  mean nothing runs until `gh pr ready <n>`. Push freely; do not watch.

So: check whether a run exists for your HEAD *before* watching. If none does
and, by the rules above, none should — that is the finished state, not a
problem to poll at. Say so and move on.

## Milestone discipline and drift detection

Work proceeds through the gates in `docs/milestones/README.md`. Do not build
ahead of the current milestone. When a gate passes, flip every status flag in one
commit via that file's **gate-close checklist**; each milestone kickoff runs a
**preflight** that reconciles the previous milestone's. Signals of drift — call
these out immediately:

- A feature "needs" direct writes bypassing the command pipeline.
- Projection rebuild diverges from stored state.
- Hand-written types duplicating contract schemas.
- UI importing domain, or server logic leaking into components.
- Invite/permission logic appearing inside Trip Planning (AccessPolicy bypass).
- Event-sourcing creeping into CRUD modules, or CRUD shortcuts creeping into
  the planning domain (the ADR-003 boundary smell).
- Scope creep past the current milestone's gate definition.
- A passed gate whose status flags (TODO tick, milestone exit-gate boxes,
  Current milestone) were left unflipped.
- A phase/task branch sits finished-but-unmerged while other independent work
  on the same milestone continues elsewhere — see the Workstreams section's
  PR-promptness rule; the longer it sits, the more silently it diverges.

## Testing model

**The procedure is `docs/guidelines/testing.md`** — which layer owns what, the
locator ladder, the testid contract, and four copy-pasteable examples. Read it
before writing a test; the `write-a-test` skill walks it as steps. What follows
is the law it expands: invariants only, each one paid for.

- **Red first: a test is not done until it has been seen to fail.** Break the
  code it protects, watch it go red for *your* reason, restore, watch it go
  green — and put the source edit and the real failure text in the PR. Three
  tests written in one session (2026-09-02) passed while proving nothing: a
  `waitFor` on a value that could not change between retries, an effect keyed so
  it never re-ran, and an empty-patch check that accepted the emptiest patch.
  Each was caught only by doing this, retroactively. `witness` does it
  mechanically for property tests; for everything else it is manual and there is
  no substitute.
- **Test count is a cost, not a score.** A PR that adds tests without covering a
  *new* failure mode made the suite slower and nothing else.
- **Prove it at one layer.** Name the layer that owns each claim and do not
  re-prove it above. The same rule proven four times costs four maintenance
  sites and catches one bug.
- **Never assert presentation.** Classes, tag names, DOM structure and prose
  copy are not contracts — roles, labels, values and behaviour are. Enforced:
  `toHaveClass` outside `src/components/ui/**` fails lint, as does reaching past
  the query layer into nodes.
- **No test may sleep** (`scripts/check-sleep-wall.mjs`), and **data comes from
  `@tc/factories`**, never a hand-built rollup.
- **Unit** (`packages/domain`): fast, exhaustive; property-based tests
  (fast-check) for reducers and the conflict engine. `fast-check` is also
  available in `@tc/pages` and `apps/web` — a claim of the form "for ALL
  inputs" gets a property test wherever it lives, not just in the domain.
- **Property tests carry a `witness`.** A property that skips every generated
  case still reports ✓. Count the assertions and assert a floor (`witness.ts`,
  duplicated per package). **Measure the floor, don't guess it** — set it near
  half the observed minimum; a guessed floor either flaps (retraining everyone
  to ignore red) or is too low to catch anything. Real incidents both ways:
  a probe passed 400 runs having asserted **zero** times, and the first draft
  of these floors flapped 3-in-15.
- **If a comment asserts an invariant, a test enforces it or the comment is a
  lie with a timer on it.** KI-1, the `evolveTrip` totality hole, and KI-14
  were all the same species: a correct-looking abstraction resting on a stated
  assumption nothing checked.
- **Contract**: every endpoint validated against its Zod schema; UI developed
  against MSW mocks from the same schemas.
- **Integration** (`apps/web/src/server`): real Postgres via docker-compose;
  event-store guarantees (ordering, optimistic concurrency, rebuild) have a
  dedicated suite.
- **E2E** (Playwright): one happy-path script per milestone, kept green forever
  after its gate.
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

## Conventions

- TypeScript strict everywhere; pnpm workspaces monorepo.
- Package imports via workspace aliases (`@tc/contracts`, `@tc/domain`).
- Never commit secrets; local config in `.env.local` (gitignored).
- Commits: conventional style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`),
  scoped to one logical change.
