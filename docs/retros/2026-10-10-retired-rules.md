# Retired rules — 2026-10-10

A retirement pass under `docs/guidelines/retiring-a-rule.md`, run because an external audit (2026-10-09) flagged `AGENTS.md` as the project's context tax, and Mitchell asked for a lower budget with room under it. `AGENTS.md` went from **38,279 B to 27,520 B** (−28%), and its budget in `scripts/surface-size.mjs` from 47,000 B to **34,000 B** — 81% of it, below the 85% `near` line.

Nothing here removes an invariant, a module-map row, or a rule's one-line incident citation. The module map, the invariants, the architecture map and its three exemptions, the Tier 1 trap and the classify command are untouched.

Unlike earlier passes, this one rewrote whole sections rather than single paragraphs, so each entry below archives the **whole section** as it was and as it is. Text moved verbatim; to reverse one, put it back and name the incident in the commit.

## 1. `AGENTS.md` — Working agreement with Mitchell

**Criterion:** 3 (incident narrative past one sentence) — wording only.

The subagent-delegation rule and its live-debugging exception, from two paragraphs to one. Both rules and the "say so explicitly" requirement stay; the explanation of why a subagent's tool traffic does not reach the main thread went.

**Was:**

````markdown
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

**Never run the live eval without asking Mitchell first** (2026-10-09).
`pnpm --filter web eval` calls real models on a paid key, so a milestone gate or
a plan that mentions an eval re-run is not permission to start one. The
grader's own tests (`grade.test.ts`, `replay.int.test.ts`) are free and need no
asking.
````

**Now:**

````markdown
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
````

## 2. `AGENTS.md` — Repo automation (check here before hand-rolling a workflow)

**Criterion:** 4 (restated) and 1 (enforced).

The catalog moved **verbatim** to `docs/guidelines/repo-automation.md`, where it stays live reference rather than history. What remains is the short list of tools that change how a session works. Criterion 1: the draft-PR guard and Tier-3 stamp teach themselves when they fire. Criterion 4: the surface-wall paragraph restated `retiring-a-rule.md`, the protocol paragraph restated `CONTRACT.md`, and the skills and commands are listed by the harness itself.

**Was:**

````markdown
## Repo automation (check here before hand-rolling a workflow)

Committed in the repo, so every session and every worktree has them.

**State digest** (`pnpm state`, `scripts/state-digest.mjs`): the "where are we"
answer, extracted rather than summarized — current milestone and gate tally, the
first unchecked TODO, STATUS.md's leading block, open PRs, a worktree count and
the newest open KIs, each with a `file:line` citation. The `SessionStart` hook
prints it, so it has usually run before you start; `/roadmap` spends its turn on
the judgement the script refuses to make. Why it is a script:
`docs/reviews/2026-09-02-session-tooling-review.md` (R1) measured 2,621
orientation re-reads across 220 sessions against 9 that ran `/roadmap`.

**Slash commands** (`.claude/commands/`):

| Command | What it does |
|---|---|
| `/roadmap` | Every milestone, where we are, what's next — and reconciles the four places status flags drift apart |
| `/next-prompt` | Generates a self-contained handoff prompt from real state, separating what is proven from what is assumed |
| `/ki-sweep` | Clears independent known issues via parallel `ki-fixer` agents in isolated worktrees, respecting milestone and contracts constraints |
| `/cleanup-orphans` | Finds orphaned PRs, branches, worktrees and stale sessions. Reports first; deletes nothing without per-category approval |
| `pnpm milestones` / `pnpm candidates` | The milestone table and the unscheduled ideas, extracted — 4% and 10% of the files they replace |
| `pnpm milestone close <id>` | The gate-close checklist, executed across four files; refuses an open gate, a bad parse and no `--confirm`. The next milestone is `TODO.md`'s next un-paused row — the rows ARE the order, so a reorder moves rows; `--next` only asserts it (KI-2026-09-21-a) |
| `/candidates` / `/milestones` | Thin wrappers over `pnpm candidates` / `pnpm milestones`, for when you want to type one. The digest names the commands anyway — F7 says a command nobody invokes helps nobody, so these are convenience, not the delivery mechanism |
| `/dispatch` | Sets up a subagent protocol run — splits the work, writes the manifest the enforcement hooks read, emits one brief per unit, and drives the promotion gate at teardown |

**Subagents** (`.claude/agents/`): `phase-implementer`, `phase-verifier`,
`ki-fixer`. Dispatch these rather than writing the prompt again — `phase-verifier`
in particular drives the PR's Vercel preview, so the browser walk works from a
container with no local infra.

**Skills** (`.claude/skills/`): `minimal-check-subset` (narrowest sufficient
check), `ci-triage` (scoped failing-job logs), `worktree-hygiene` (read-only
worktree audit), `write-a-test` (the testing guide as steps), `ai-usage` (the
assistant's live cost and quality). The first three are symlinks into
`.agents/skills/`; edit them there.

**Content check** (`pnpm content:verify`): parses every bundle under `content/`
against `travel-collab/content-bundle/v1`, runs the content rules a schema
cannot state (a `keptOn` in the future, an author in their own adds ledger, a
day written out of chronological order), and prints what the whole set looks
like — including the season and budget-band occupancy Discover filters on.
Needs no server and no database; it is `import-content.ts --dry-run`, the same
code path as the import with the writes off. The same lint runs inside
`pnpm test` via `packages/fixtures/src/bundle/content.test.ts`. See ADR-041 and
`docs/guidelines/content-bundles.md`.

**Surface report and wall** (`pnpm surface`, `pnpm surface --check` inside
`pnpm lint`): how big the files every session reads first actually are, with a
per-file byte budget. It exists because the surface **doubled in nineteen
days** while nobody was keeping a number, and at the measured 51.3x re-read
multiplier a byte saved there is not saved once
(`docs/reviews/2026-09-21-development-loop-review.md`). Past 85% of a budget a
file is marked `!!` and `pnpm milestone close` lists a **retirement pass** for
it — `docs/guidelines/retiring-a-rule.md`. Raising a budget is a decision to
record in the commit that raises it.

**Fixture check** (`pnpm seed:verify`): folds the canonical Japan demo trip
through the real domain and reports counts, kind/tag coverage, coordinates,
rollups and conflicts against a recorded baseline. Runs inside `pnpm check`
too; the standalone command is for the readable table. See ADR-030.

**Architecture wall** (`pnpm arch`, inside `pnpm lint`): dependency-cruiser,
`.dependency-cruiser.cjs`. Fails on a runtime import cycle, a cycle between
sibling folders, and the module map's "does NOT know about" column where a
path can state it. Leftovers are named per KI, never baselined wholesale.
Cannot see a cycle between a folder and its own subfolder
(`KI-2026-09-23-b`). `pnpm arch:graph` prints Mermaid on demand.
`docs/reviews/2026-09-23-architecture-wall-first-run.md`.

**Draft-PR guard** (`scripts/hooks/draft-pr-guard.mjs`, `PreToolUse` on
`gh *`): asks before `gh pr create` without `--draft`, and before
`gh pr ready` when no **Tier-3 stamp** covers HEAD. The rule was followed on
**4 of 15 branches**; PR #196, opened ready, spent **41 CI runs and 8 failures**.
It **asks**, never denies.

**The Tier-3 stamp** (`pnpm check` records it; `pnpm tier3 verify` reads it):
`.git/tc-tier3.json` holds the commit checked and **which lanes were live**.
`pnpm check` ends in `test:int:if-db`, which skips silently with no database —
*"A green `pnpm check` here is NOT a green CI."* The guard names the uncovered
lanes; record them on the PR's *"Not run, and why"* line.

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
````

**Now:**

````markdown
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
````

## 3. `AGENTS.md` — Workstreams (how agents divide the work)

**Criterion:** 3 (incident narrative) and 4 (restated).

The worktree rule keeps the M3 citation in one sentence; the PR-promptness rule keeps PR #25 and the sibling-branch check, and loses the 12-commits-diverged story. The draft rule's pointer to the draft-PR guard was a restatement of the automation section.

**Was:**

````markdown
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
still small. M10 Wave 2's Phase 3 sat built, verified and PR-less while Phase 4
merged past it (PR #25), 12 commits diverged each way. Before starting new
phase/milestone work that another session's docs describe as independent,
check for sibling `claude/*` branches on the current milestone first (`git
branch -a`, `git ls-remote --heads origin`) — a finished-but-unmerged one needs
a PR opened (or an explicit, recorded reason it's being left) before you add
more parallel work on top of it.

Rule: **open that PR as a draft, and mark it ready only when you believe it is
green.** Draft status keeps the PR visible and conflict-checked while
`.github/workflows/ci.yml` skips its jobs until `gh pr ready <n>`. The minute
budget is 2,000/month and PR #55 alone spent **315 minutes** on
work-in-progress; the draft-PR guard above now asks before a non-draft
`gh pr create`. Full accounting: `docs/guidelines/ci-cost-and-capacity.md`.
````

**Now:**

````markdown
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
````

## 4. `AGENTS.md` — Verification scales to the change

**Criterion:** 2 (history of the document), 3 and 4.

"From 2026-09-16 it could (*commit to main directly*)" is history (2). The *Tier 1 is a property of the whole branch* blockquote restated CLAUDE.md rule 4 and the Tier 1 definition one line above it (4). The suggester-role retro citation stays; the Mitchell quote is in the retro it cites (3). Tier 2 lost "the KI workflow has been doing this correctly for months … It is now the rule rather than one skill's preference" (2).

**Was:**

````markdown
### Verification scales to the change

Classify the change by what it touches, then run **only** that tier.

> **The short version, because it has been misread.** During development, each
> fix runs **only its own subset** (Tier 1 or Tier 2 below; CLAUDE.md rule 4).
> The full suite runs **once**, when the branch leaves draft (Tier 3) — and even
> then running it locally is optional, because CI runs it on push. **Never run
> it per part of a stack, per fix, or "to be sure."** The suggester role ran
> `pnpm check` plus the full ci-like e2e (235 tests, ~6 min plus setup) on each
> of three stacked parts, again after review fixes, and again on the follow-up
> PR; Mitchell: *"i think you did a full test pass on like every feature which
> took way too long"* (`docs/retros/2026-10-04-suggester-role-retro.md`, §2).

**Tier 1 — prose only.** Every path changed **by the whole branch**, not just
by your latest commit, is under `docs/**`, `.claude/**`, `.agents/**`, or is a
root-level `*.md` (`README`, `AGENTS`, `CLAUDE`, `TODO`).

> **Tier 1 is a property of the whole branch** (CLAUDE.md rule 4): `ci.yml`'s
> `changes` job judges the entire PR diff, so a docs commit on a branch that
> already has code re-runs the full suite (PR #103).

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

> **A Tier 1 branch needs a PR like any other — it can no longer go straight
> to `main`.** From 2026-09-16 it could (*"commit to main directly"*). On
> 2026-10-04 Mitchell made `ci-ok` a required check on `main` with no bypass
> (*"no exceptions"*), and GitHub rejects a direct push of a commit that check
> has not passed on. The PR is cheap: nothing real runs, `ci-ok` goes green in
> under a minute, and it merges.
>
> **The tier rule still decides what you run, per the whole branch** —
> `.design-sync/**` included, per the trap above. To classify, in one command:
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

> This is the single full-suite run a branch pays for: `pnpm check`, plus
> `pnpm --filter web test:e2e:ci-like` if a user flow changed, and
> `pnpm seed:verify` if a contract field or fixture changed. **Running it
> locally is optional** — `gh pr ready <n>` is exactly when `ci.yml` starts
> paying attention, and CI runs the same suite on push. Run it locally once,
> here, when you want the answer before CI gives it; never earlier, and never
> twice. A stack pays it once for the whole stack, on the top part
> (`docs/guidelines/stacked-prs.md` §5), not once per part.

A mid-branch full-suite run is a judgment call to justify, not a reflex. If you
genuinely need one — you are chasing a failure whose blast radius you cannot
bound — say so in the PR body rather than running it silently.
````

**Now:**

````markdown
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
````

## 5. `AGENTS.md` — What the change itself must carry

**Criterion:** 3 (incident narrative).

PR #141, the M10 template skips and KI-2026-09-05-k each keep their citation and the rule; the stories around them went. Every rule in the list survives.

**Was:**

````markdown
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
- **A new feature does not owe the public API an endpoint** (Mitchell,
  2026-09-24). Document the feature; do not add `/api/v1/**` routes, scopes or
  OpenAPI entries for it unless the task is API work. The public surface is
  caught up in deliberate passes that find the gap mechanically: see
  `docs/guidelines/using-the-api.md`, *Features ship before their endpoints*.
  It does owe one line: a new internal route is added to
  `apps/web/src/server/public-api/exposure.ts` as `public`, `planned` or
  `never`, or `exposure.test.ts` fails. `planned` is the default when nobody
  has decided; `never` is Mitchell's call.
  Changing an endpoint that already exists (a contract it returns grew a field)
  is still in scope: that is keeping the existing surface honest, not adding
  to it.
- No invariant weakened. If one blocked you, that is a finding to report to
  Mitchell, not a rule to bend.
- Docs updated when behavior or interfaces changed (ADR for irreversible
  decisions, changelog for contracts).
- **If the change adds a Drizzle migration, say so in the PR body.** Merging no
  longer applies it: production migrations are dispatched explicitly via the
  `migrate-production` workflow (`gh workflow run migrate-production.yml -f
  confirm=migrate`, from `main`). A merged-but-undispatched migration is a
  production schema drift waiting to happen. The PR template now has a
  **Migrations** section to say it in — and, since KI-2026-09-05-k, the PR body
  is no longer the only control: `pnpm lint` runs
  `scripts/check-migration-journal.mjs` (a migration you add must be newer than
  `origin/main`'s newest, or drizzle will skip it in silence), and
  `.github/workflows/migration-pending.yml` asks production, on every push to
  `main` that touches `apps/web/drizzle/**`, whether it actually has them. See
  `docs/guidelines/environments-and-deploys.md`.
- The PR uses `.github/PULL_REQUEST_TEMPLATE.md` and its **Verification
  actually performed** section is filled in honestly — including which tier you
  ran and why. A step you did not run is recorded on the "Not run, and why"
  line. Four consecutive M10 phases shipped with a verification step skipped
  and nothing on the PR saying so; an unchecked box is a fine outcome, a silent
  skip is not. A tier stated plainly ("Tier 1, prose only, nothing run") is a
  complete answer, not an admission.
````

**Now:**

````markdown
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
````

## 6. `AGENTS.md` — Waiting on PR checks — subscribe in a cloud session, watch locally

**Criterion:** 3, and a move.

Shortened, and the *"One trap, hit while writing this down"* paragraph moved here from the bottom of the CodeRabbit section, where it had been stranded under the wrong heading.

**Was:**

````markdown
### Waiting on PR checks — subscribe in a cloud session, watch locally

**In a Claude Code cloud session, do not wait at all — subscribe.** The harness
delivers CI completions, review comments and merge-state changes into the
conversation as `<wake reason="external-event">` envelopes:

```
subscribe_pr_activity(owner, repo, pullNumber)   # then END THE TURN
```

Ending the turn *is* how you wait. The session is woken when something
actually happens, so the median 6.6-minute run costs no turns instead of one
long blocked one — and a review comment arriving forty minutes later wakes you
too, which no `--watch` ever does. `unsubscribe_pr_activity` when the PR merges
or closes.

**Never combine the two.** A blocking `--watch` inside a subscribed session
spends the wait it exists to avoid.

**Locally, where there is no wake mechanism**, one blocking command still
covers every check that runs automatically:

```
gh pr checks <n> --watch --fail-fast
```

Hand-polling with repeated `gh pr checks` is a reliable time sink; that is why
this is written down rather than left to each session to rediscover.
````

**Now:**

````markdown
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
````

## 7. `AGENTS.md` — CodeRabbit is Mitchell's step, not an automated one

**Criterion:** 3 (incident narrative).

All six steps and the self-trigger rule stay. The *why* is one sentence with `KI-2026-09-01`; the "findings are bug reports" paragraph folded into step 5 with both of its citations. The `--watch` trap moved up to *Waiting on PR checks*.

**Was:**

````markdown
### CodeRabbit is Mitchell's step, not an automated one

**Decided 2026-09-01. Do not wait on CodeRabbit, and never read its status as
evidence.** It is out of the automated loop entirely — `--watch` above covers
CI, not this.

Why: auto-review is **off** for this repo (below CodeRabbit's 10-star OSS gate),
it posts a **green status while skipping**, a review takes **~21 minutes**, and
**any push during that window aborts it**. Evidence: `KI-2026-09-01`.

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

**Its findings are bug reports, not noise** — it has caught a navigation race
no test covered (M10 Wave 2 Phase 7) and a tautological assertion that
`pnpm check` passed (#105). Verify each finding against the code, then fix it. Scope and verbosity live in `.coderabbit.yaml`;
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
````

**Now:**

````markdown
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
````

## 8. `AGENTS.md` — Do not watch what cannot run

**Criterion:** 3 — wording only.

Two bullets and a framing paragraph to one paragraph; both cases and the "finished state, not a problem to poll at" rule stay.

**Was:**

````markdown
### Do not watch what cannot run

That ordering rule has a second half, and skipping it is how a session spends
ten minutes on a documentation edit. `--watch` is right **when checks will
exist**. Two cases where they will not:

- **A Tier 1 PR** — meaning the *whole PR* is prose, per the caveat in Tier 1
  above. `ci.yml`'s real jobs skip and `.coderabbit.yaml` filters it out, so
  the only thing to wait for is `ci-ok`, which is required and reports in
  under a minute. A prose commit on a PR that also
  carries code is **not** this case: that run happens, and you wait for it.
- **A draft PR.** `auto_review.drafts: false` and the `if:` guards in `ci.yml`
  mean nothing runs until `gh pr ready <n>`. Push freely; do not watch.

So: check whether a run exists for your HEAD *before* watching. If none does
and, by the rules above, none should — that is the finished state, not a
problem to poll at. Say so and move on.
````

**Now:**

````markdown
### Do not watch what cannot run

`--watch` is right only **when checks will exist**. They will not on a
**Tier 1 PR** — the *whole PR* prose, so only `ci-ok` reports, in under a
minute (a prose commit on a branch that carries code is not this case) — or on
a **draft PR**, where `ci.yml`'s `if:` guards skip everything until
`gh pr ready <n>`. If no run exists for your HEAD and none should, that is the
finished state: say so and move on.
````

## 9. `AGENTS.md` — Milestone discipline and drift detection

**Criterion:** 3 — wording only.

The KI-citation bullet keeps the script, the judgement half and the 2026-09-19 citation.

**Was:**

````markdown
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
- **A status file restating what a known-issue entry says, rather than pointing
  at it.** Two copies of a fact, and only one was written by somebody looking at
  the failure. `scripts/check-ki-citations.mjs` catches the mechanical half;
  the judgement half is that **three status files agreeing is not corroboration
  when none of their authors opened the entry** — which is exactly how a
  milestone spent three days blocked on a variable that was set all along
  (`docs/known-issues/README.md`, 2026-09-19).
- A phase/task branch sits finished-but-unmerged while other independent work
  on the same milestone continues elsewhere — see the Workstreams section's
  PR-promptness rule; the longer it sits, the more silently it diverges.
````

**Now:**

````markdown
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
````

## 10. `AGENTS.md` — Testing model

**Criterion:** 2, 3 and 4.

"Recorded 2026-09-05: this rule was stated blanket, and a KI-fixer correctly could not obey it" is history (2). The witness bullet keeps both numbers (400 runs at zero assertions, 3-in-15 flaps) (3). The e2e-lane and grep-the-KIs bullets restated CLAUDE.md rules 1 and 2, which every session has loaded; each is now one line pointing there (4).

**Was:**

````markdown
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
  where it cannot.** `packages/factories` depends on `@tc/domain`, and the
  dependency map above scopes `packages/domain` to contracts only, so importing
  factories into a domain test is both an import cycle and an invariant breach.
  Domain tests use that package's own `test/support/` builders and the real
  command path instead. Recorded 2026-09-05: this rule was stated blanket, and
  a KI-fixer correctly could not obey it.
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
- **An e2e result may only be reported from `pnpm --filter web test:e2e:ci-like`**
  (CLAUDE.md rule 1). A failing dev-lane run also prints this
  (`e2e/laneReporter.ts`), but only after you have run the wrong thing.
- **Before attributing any failure to the environment, grep `docs/known-issues/`
  for the symptom** (CLAUDE.md rule 2). "Environmental", "flaky" and "infra"
  are conclusions that need evidence, and the most expensive ones to get wrong,
  because they end the investigation.
````

**Now:**

````markdown
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
````
