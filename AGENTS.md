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
editing files, running tests), so the main thread accumulates reports rather
than tool traffic. State the delegation choice before each task or phase. The
standing exception is live, iterative debugging against a running dev server or
browser, which a subagent can't share — say so at that point, naming the
reason, rather than silently falling back to inline work.

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

**Never run the live eval without asking Mitchell first** (2026-10-09).
`pnpm --filter web eval` calls real models on a paid key, so a milestone gate or
a plan that mentions an eval re-run is not permission to start one. The
grader's own tests (`grade.test.ts`, `replay.int.test.ts`) are free and need no
asking.

## The module map (structural law)

Modules own their data and commands; they reference other modules by ID only.

| Module | Owns | Storage model | Explicitly does NOT know about |
|---|---|---|---|
| **Identity** | accounts, OAuth, sessions, profiles | CRUD + audit fields | trips, invites, anything travel |
| **Trip Planning** | trips, days, activities, itinerary structure | **event-sourced** | who's invited, sharing, votes |
| **Access & Membership** | invites, roles, revocation, share grants | CRUD + audit fields | what a trip contains |
| **Suggestions** | pending suggested changes and their review state | CRUD with audit fields; reaches the trip **only** by replaying its commands through the pipeline as the reviewer (**ADR-064**) | planning state — a pending change is not on the stream |
| **History** | event log, replay, undo/revert, fork lineage | the substrate itself | domain semantics (stores/replays, never interprets) |
| **Conflict Engine** | validation rules, Conflict objects | pure functions | UI, storage |
| **Community** (Phase 3) | gallery, votes, reports | CRUD + audit fields | planning internals (consumes published snapshots) |
| **Entitlements** (Phase 3) | plans, plan versions, grants, capability resolution | committed file (definitions) + CRUD with audit fields (holdings) | trips, invites, anything travel — it answers `can(account, capability)` and the *caller* knows what the capability is about (**ADR-045**) |
| **Billing** (Phase 3) | subscriptions, Stripe customers, checkout, the webhook | CRUD with audit fields; the **webhook is its only writer** | what a plan grants, and what anyone may do — it records what Stripe says is being charged, and Entitlements decides what that entitles (**ADR-047**) |

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
7. **The assistant takes only paths the user could take.** It acts through
   what the acting user could do in the UI, with the same permissions and the
   same mode transitions. If a person must switch a page to Editing to change
   it, the assistant switches to Editing first, visibly, through the same state
   the toggle sets. It never writes around a mode or a permission; a viewer's
   assistant holds pure reads only (every tool declares its `effect`). Mitchell,
   2026-09-27; ADR-058 decisions 8 and 9.

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

The exempt shell is `src/server/**`, `src/app/api/**`,
`src/app/.well-known/**/route.ts` — and, since 2026-09-14,
**`src/app/admin/**`**, which may import `src/server` internals but still may
not reach `packages/domain` or build an Auth.js instance. M20's gate needs a
non-admin to get a 404 for the **route**, and `users.is_admin` is a database column
the edge proxy cannot read under JWT sessions (ADR-025); the console fetching its
own API over HTTP produced two defects in two days. `scripts/check-lint-wall.mjs`
lints three fixtures under `src/app/admin`, so the exemption is exactly one hole.

Since 2026-10-02 the shell also holds **`src/app/sitemap.ts` and
`src/app/robots.ts`** (SEO pass, D2): the sitemap lists every published day,
which only the database knows. Console terms; five fixtures in
`scripts/check-lint-wall.mjs`.

And **`src/app/(app)/playbooks/**/page.tsx`** (SEO pass, D5): the public
library's pages render on the server so a crawler receives the day and a
missing one answers 404. Page files only, on the console's terms; the screens
they render still call the API. Seven fixtures hold it there.

The UI/server lint wall is CI-enforced and is our escape hatch: if serverless
stops fitting (likely at Phase 2 realtime), `src/server` extracts into a
standalone service without touching domain or contracts (ADR-002).

## Repo automation (check here before hand-rolling a workflow)

What each tool does, why it exists and what it measured:
`docs/guidelines/repo-automation.md`. The ones that change how you work:

- **`pnpm state`** — the "where are we" digest, every line cited `file:line`.
  The `SessionStart` hook has usually printed it already.
- **Commands** (`.claude/commands/`): `/roadmap`, `/next-prompt`, `/ki-sweep`,
  `/cleanup-orphans`, `/dispatch`, `/candidates`, `/milestones`. Scripts:
  `pnpm milestones`, `pnpm candidates`, and `pnpm milestone close <id>` — the
  gate-close checklist; `TODO.md`'s rows ARE the order (KI-2026-09-21-a).
- **Subagents** (`.claude/agents/`): `phase-implementer`, `phase-verifier`,
  `ki-fixer`. Dispatch these rather than writing the prompt again —
  `phase-verifier` drives the PR's Vercel preview, so the browser walk needs no
  local infra.
- **Skills** (`.claude/skills/`): `minimal-check-subset`, `ci-triage`,
  `worktree-hygiene`, `write-a-test`, `ai-usage`. The first three are symlinks
  into `.agents/skills/`; edit them there.
- **Walls.** `pnpm lint` runs `pnpm arch` (dependency-cruiser; blind to a
  folder↔subfolder cycle, `KI-2026-09-23-b`) and `pnpm surface --check`
  (byte budgets on this file and the other first reads — past 85% a file gets a
  retirement pass, `docs/guidelines/retiring-a-rule.md`; raising a budget is a
  decision recorded in the commit that raises it). `pnpm check` runs
  `pnpm seed:verify` (the Japan fixture, ADR-030); `pnpm content:verify` checks
  content bundles (ADR-041).
- **Hooks** (`scripts/hooks/`): a typecheck of the touched package on every
  `.ts`/`.tsx` edit; a guard on history-rewriting git while several worktrees
  exist; and the **draft-PR guard**, which asks before `gh pr create` without
  `--draft` and before `gh pr ready` when no **Tier-3 stamp** covers HEAD.
  `pnpm check` writes the stamp (`.git/tc-tier3.json`) with the lanes that
  were live — with no database it skips the integration lane silently, so *a
  green `pnpm check` here is NOT a green CI*.
- **The subagent protocol** (`.claude/protocol/CONTRACT.md`) binds every
  dispatched subagent: three exit states, two-strike handback, report shape.
  `ADAPTER.md` holds this repo's facts, including the one resource no hook
  leases — CI minutes.

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
back sequentially — never a shared working tree. Concurrent agents race on
git's index and refs even with disjoint file sets: in M3 one agent's
`git reset --soft` silently dropped a sibling's committed work. Isolate via
`superpowers:using-git-worktrees`.

Rule: a phase or task branch worked independently of others is not "done"
until its **PR is open**. A `docs/STATUS.md` on an unmerged branch is read by
nobody, and only a PR puts the diff in front of conflict detection while it is
small — M10 Wave 2's Phase 3 sat built and PR-less while Phase 4 merged past it
(PR #25). Before starting parallel work on the current milestone, check for
sibling `claude/*` branches (`git ls-remote --heads origin`); a
finished-but-unmerged one gets a PR, or a recorded reason it is left.

Rule: **open that PR as a draft, and mark it ready only when you believe it is
green.** `ci.yml` skips its jobs on a draft. The budget is 2,000 minutes a month
and PR #55 alone spent **315** on work-in-progress.
`docs/guidelines/ci-cost-and-capacity.md`.

## Definition of Done (every change)

### Verification scales to the change

Classify the change by what it touches, then run **only** that tier.

> **The short version, because it has been misread.** Mid-branch, each fix runs
> **only its own subset** (Tier 1 or 2; CLAUDE.md rule 4). The full suite runs
> **once**, when the branch leaves draft (Tier 3), and even then running it
> locally is optional because CI runs it on push. **Never per part of a stack,
> per fix, or "to be sure"** — the suggester role ran it on each of three
> stacked parts and twice more (`docs/retros/2026-10-04-suggester-role-retro.md`, §2).

**Tier 1 — prose only.** Every path changed **by the whole branch**, not just
by your latest commit, is under `docs/**`, `.claude/**`, `.agents/**`, or is a
root-level `*.md` (`README`, `AGENTS`, `CLAUDE`, `TODO`).

> Run nothing. No `pnpm check`, no test lane, no typecheck, no e2e, no browser.
> `.github/workflows/ci.yml`'s `changes` job (`scripts/ci-gate.mjs`) and
> `.coderabbit.yaml`'s `path_filters` already exclude exactly these paths: every
> real job skips, `ci-ok` passes in under a minute, and there is no review to
> collect — see *Do not watch what cannot run* below.
>
> **The trap:** `.design-sync/**` is **not** prose. It is a real build input —
> `packages/fixtures/src/japan/upstreamDrift.test.ts:30` and
> `apps/web/scripts/geocode-japan-seed.mts:139` both read
> `.design-sync/handoff/data/japan-trip-seed.json` — so a change there is Tier 2
> even when only its markdown moved. `ci.yml` gets this right by
> listing `*.md` rather than `**/*.md`; classify the same way.
>
> **A Tier 1 branch still needs a PR:** `ci-ok` is a required check on `main`
> with no bypass (Mitchell, 2026-10-04, *"no exceptions"*). To classify, in one
> command:
>
> ```
> git diff --name-only origin/main...HEAD | grep -vE '^(docs/|\.claude/|\.agents/)|^[A-Za-z]+\.md$'
> ```
>
> Nothing printed means Tier 1. Anything printed means Tier 2.

**Tier 2 — code, mid-branch.** Any change that is not Tier 1, before the branch
is ready.

> Run the `minimal-check-subset` skill's output **and nothing more** —
> typically `pnpm --filter <pkg> typecheck`, that package's lint, and the
> specific test files covering what you touched. "Narrowest sufficient" is not
> "smallest": for `packages/contracts/src` the skill says do not narrow,
> because the consumers span packages, so the subset genuinely *is*
> `pnpm check`. That is the only way a full run gets earned before Tier 3.
> Record the subset in the PR body.

**Tier 3 — final review.** The branch is finished and about to leave draft.

> This is the single full-suite run a branch pays for: `pnpm check`, plus
> `pnpm --filter web test:e2e:ci-like` if a user flow changed, and
> `pnpm seed:verify` if a contract field or fixture changed. **Running it
> locally is optional** — `gh pr ready <n>` is when `ci.yml` starts paying
> attention, and CI runs the same suite. Run it locally at most once, here. A
> stack pays it once, on the top part (`docs/guidelines/stacked-prs.md` §5).

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
  it is not yet reviewable as.** Ask before you start: **on the preview, what
  does a person click to see this?** "Nothing yet, and here is the walk that
  will exist when link N lands" is a fine answer written down and a bad one
  discovered in review — PR #141 opened as "the primitives, not in the picker"
  and drew *"this is another milestone thats not functionally reviewable"*.
- **A new feature does not owe the public API an endpoint** (Mitchell,
  2026-09-24). Do not add `/api/v1/**` routes, scopes or OpenAPI entries for it
  unless the task is API work (`docs/guidelines/using-the-api.md`, *Features
  ship before their endpoints*). It does owe one line: a new internal route is
  added to `apps/web/src/server/public-api/exposure.ts` as `public`, `planned`
  or `never`, or `exposure.test.ts` fails. `planned` is the default when nobody
  has decided; `never` is Mitchell's call. Changing an endpoint that already
  exists is still in scope.
- No invariant weakened. If one blocked you, that is a finding to report to
  Mitchell, not a rule to bend.
- Docs updated when behavior or interfaces changed (ADR for irreversible
  decisions, changelog for contracts).
- **If the change adds a Drizzle migration, say so in the PR template's
  Migrations section.** Merging does not apply it: production migrations are
  dispatched via `gh workflow run migrate-production.yml -f confirm=migrate`,
  from `main`. `pnpm lint` fails a migration not newer than `origin/main`'s
  newest (`scripts/check-migration-journal.mjs`, KI-2026-09-05-k), and
  `migration-pending.yml` asks production on every push to `main` touching
  `apps/web/drizzle/**`. `docs/guidelines/environments-and-deploys.md`.
- The PR uses `.github/PULL_REQUEST_TEMPLATE.md`, its **Verification actually
  performed** section filled in honestly, including the tier and why. A skipped
  step goes on the "Not run, and why" line — four consecutive M10 phases
  skipped one silently. "Tier 1, prose only, nothing run" is a complete answer.

### Waiting on PR checks — subscribe in a cloud session, watch locally

**In a cloud session, subscribe and end the turn:**
`subscribe_pr_activity(owner, repo, pullNumber)`. CI results, review comments
and merge-state changes arrive as `<wake reason="external-event">` envelopes —
including the review forty minutes later that no `--watch` sees. Never combine
it with a blocking `--watch`. `unsubscribe_pr_activity` on merge or close.

**Locally**, one blocking command: `gh pr checks <n> --watch --fail-fast`.
Hand-polling is a reliable time sink.

**The trap:** right after a push, `--watch` can return in a second reporting
the *previous* commit's checks, all green, because GitHub has not registered
the new run. Confirm a run exists for your HEAD first
(`gh run list --commit $(git rev-parse --short HEAD) --limit 1`), then watch.

### CodeRabbit is Mitchell's step, not an automated one

**Decided 2026-09-01: do not wait on CodeRabbit, and never read its status as
evidence.** Auto-review is **off** for this repo, it posts a **green status
while skipping**, a review takes **~21 minutes**, and **any push during that
window aborts it** (`KI-2026-09-01`).

1. **Finish the work** — CI green on the real head, review threads answered,
   nothing left to push.
2. **Hand off to Mitchell in chat** (not as a PR comment): *"PR #N is green and
   ready — trigger CodeRabbit before merging."* This replaces the automated
   check, so it is not optional and not a footnote.
3. **Mitchell triggers it** (`@coderabbitai review`, or `🔍 Trigger review`).
4. **Nobody pushes for ~21 minutes.** An abort shows up only as an edit to an
   existing comment.
5. **Findings get addressed** — they are bug reports, not noise (a navigation
   race in M10 Wave 2 Phase 7, a tautological assertion in #105). Verify each
   against the code, fix it, and say whether the fix warrants a re-trigger.
   Tune `.coderabbit.yaml` rather than ignoring comments in bulk.
6. **Mitchell merges.**

An agent may trigger it itself only when certain it is done pushing; if in
doubt, hand off.

### Do not watch what cannot run

`--watch` is right only **when checks will exist**. They will not on a
**Tier 1 PR** — the *whole PR* prose, so only `ci-ok` reports, in under a
minute (a prose commit on a branch that carries code is not this case) — or on
a **draft PR**, where `ci.yml`'s `if:` guards skip everything until
`gh pr ready <n>`. If no run exists for your HEAD and none should, that is the
finished state: say so and move on.

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
- **A status file restating a known-issue entry rather than pointing at it.**
  `scripts/check-ki-citations.mjs` catches the mechanical half. The judgement
  half: three status files agreeing is not corroboration when none of their
  authors opened the entry — a milestone spent three days blocked on a variable
  that was set all along (`docs/known-issues/README.md`, 2026-09-19).
- A phase/task branch sits finished-but-unmerged while other work on the same
  milestone continues (Workstreams' PR-promptness rule).

## Testing model

**The procedure is `docs/guidelines/testing.md`** — which layer owns what, the
locator ladder, the testid contract, and four copy-pasteable examples. Read it
before writing a test; the `write-a-test` skill walks it as steps. What follows
is the law it expands: invariants only, each one paid for.

- **Red first: a test is not done until it has been seen to fail** (CLAUDE.md
  rule 3 carries the procedure and the 2026-09-02 incident). Put the source edit
  and the real failure text in the PR. `witness` does it mechanically for
  property tests; for everything else it is manual and there is no substitute.
- **Test count is a cost, not a score.** A PR that adds tests without covering a
  *new* failure mode made the suite slower and nothing else.
- **Prove it at one layer.** Name the layer that owns each claim and do not
  re-prove it above. The same rule proven four times costs four maintenance
  sites and catches one bug.
- **Never assert presentation.** Classes, tag names, DOM structure and prose
  copy are not contracts — roles, labels, values and behaviour are. Enforced:
  `toHaveClass` outside `src/components/ui/**` fails lint, as does reaching past
  the query layer into nodes.
- **No test may sleep** (`playwright/no-wait-for-timeout` plus `no-restricted-properties` on `waitForTimeout`, which catches pages not named `page`; both fixtured in `scripts/check-lint-wall.mjs`), and **data comes from
  `@tc/factories`**, never a hand-built rollup — **except in `packages/domain`,
  where it cannot**: `packages/factories` depends on `@tc/domain`, so importing
  it into a domain test is an import cycle and an invariant breach. Domain tests
  use that package's own `test/support/` builders and the real command path.
- **Unit** (`packages/domain`): fast, exhaustive; property-based tests
  (fast-check) for reducers and the conflict engine. `fast-check` is also
  available in `@tc/pages` and `apps/web` — a claim of the form "for ALL
  inputs" gets a property test wherever it lives, not just in the domain.
- **Property tests carry a `witness`.** A property that skips every generated
  case still reports ✓. Count the assertions and assert a floor (`witness.ts`,
  duplicated per package). **Measure the floor, don't guess it** — set it near
  half the observed minimum. A probe once passed 400 runs having asserted
  **zero** times, and the first guessed floors flapped 3-in-15.
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
  after its gate. A verdict comes only from `pnpm --filter web test:e2e:ci-like`
  (CLAUDE.md rule 1).
- **Grep `docs/known-issues/` before calling any failure environmental, flaky
  or infra** (CLAUDE.md rule 2) — those conclusions end the investigation.

## Conventions

- TypeScript strict everywhere; pnpm workspaces monorepo.
- Package imports via workspace aliases (`@tc/contracts`, `@tc/domain`).
- Never commit secrets; local config in `.env.local` (gitignored).
- Commits: conventional style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`),
  scoped to one logical change.
