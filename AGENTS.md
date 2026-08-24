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

## Workstreams (how agents divide the work)

Agents work per-boundary and meet at `packages/contracts`:

- **Domain agent** — aggregates, reducers, conflict engine. Pure, exhaustively
  unit-tested functions.
- **Server agent** — event store, command pipeline, auth, CRUD modules,
  projections in `apps/web/src/server`. Integration-tested against real Postgres.
- **UI agent** — pages/components against the typed client with MSW mocks
  generated from contracts; features work against mocks before the server exists.

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

## Definition of Done (every change)

- Typecheck, lint, and all tests pass locally (`pnpm check` once M0 lands).
- New domain logic has unit tests; new endpoints have contract + integration
  tests; new user flows extend the milestone e2e script.
- The projection-rebuild golden test still passes if events or reducers changed.
- No invariant weakened. If one blocked you, that is a finding to report to
  Mitchell, not a rule to bend.
- Docs updated when behavior or interfaces changed (ADR for irreversible
  decisions, changelog for contracts).
- The PR uses `.github/PULL_REQUEST_TEMPLATE.md` and its **Verification
  actually performed** section is filled in honestly. A step you did not run
  is recorded on the "Not run, and why" line. Four consecutive M10 phases
  shipped with a verification step skipped and nothing on the PR saying so;
  an unchecked box is a fine outcome, a silent skip is not.

### Waiting on PR checks — do not hand-poll

One blocking command covers every check, CodeRabbit included:

```
gh pr checks <n> --watch --fail-fast
```

CodeRabbit is a **registered status check** ("CodeRabbit / Review completed"),
not just a comment stream, so `--watch` waits for it and exits non-zero the
moment anything fails. Its summary comment lands ~30 seconds after the PR
opens, but its actual review verdict takes **2-11 minutes** — that gap is what
makes hand-polling with repeated `gh pr checks` such a reliable time sink, and
it is why this is written down rather than left to each session to rediscover.

CodeRabbit's findings are bug reports worth verifying against the code, not
noise — it caught a real fire-and-forget navigation race in M10 Wave 2 Phase 7
that no test covered. Its scope and verbosity are configured in
`.coderabbit.yaml`; tune that file rather than ignoring comments in bulk.

**One trap, hit while writing this down:** immediately after a push, `--watch`
can return in about a second reporting the *previous* commit's checks, all
green, because GitHub has not registered the new run yet. That reads exactly
like "my push passed." Confirm the run exists for your actual HEAD first:

```
git rev-parse --short HEAD
gh run list --commit <sha> --limit 1
```

Then watch. Waiting for the run to appear is the only reliable ordering.

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

## Conventions

- TypeScript strict everywhere; pnpm workspaces monorepo.
- Package imports via workspace aliases (`@tc/contracts`, `@tc/domain`).
- Never commit secrets; local config in `.env.local` (gitignored).
- Commits: conventional style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`),
  scoped to one logical change.
