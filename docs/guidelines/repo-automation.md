# Repo automation

The full catalog of what is committed in this repo to save a session from
hand-rolling a workflow: what each tool does, why it exists, and the number that
justified it. `AGENTS.md` §Repo automation keeps the short list every session
reads first; this page is the reference behind it. Moved here verbatim from
`AGENTS.md` on 2026-10-10 (`docs/retros/2026-10-10-retired-rules.md`) to keep
the first-read file under its surface budget.

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
assistant's live cost and quality), `build-a-milestone` (a whole milestone, from
Mitchell's decisions to the closed gate — `building-a-milestone.md` as steps). The first three are symlinks into
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
