# Codebase and agent-architecture audit — 2026-10-16

Read-only deep dive on `main` at `5541f5c`, asked for by Mitchell: how the repo has grown, how
the agents are set up against current practice for a hands-off orchestrator, how the code is
structured, where the agent guidance contradicts itself, which known issues are dead, and what
pollutes a session's context. Four scoped sub-audits (hooks, architecture, known issues,
guidance) fed this file; every claim below was checked in the tree unless marked *not verified*.

## 1. The verdict in ten lines

1. **The product is in good shape and the invariants hold.** `pnpm arch` passes, the event log is
   still the only planning writer, the new chat, guests and RAG code each respect the module
   they live in, fail open honestly, and carry contract changelog entries.
2. **The documentation of where the work is has stopped tracking the work.** STATUS, TODO, the
   milestone README and `pnpm state` all say M46 is being built and M48 is unscoped. M46's six
   parts and its part 0 merged on 2026-10-13 and 14 with the gate at 0 of 10; trip guests
   (PR 457, ADR-074, migration 0053) and a five-PR RAG stack (PRs 459 to 467, migration 0054) then
   shipped off-milestone. `pnpm state` printed `DRIFT: none` because it only checks the docs
   against each other.
3. **One real defect in the new code:** a playbook that is unpublished or deleted keeps being
   served as a RAG plan example to everyone, including logged-out users, because neither path
   re-queues its embeddings and retrieval filters on a denormalised copy of visibility (§5.1).
4. **The agent process works but is heavier than the harness needs.** Twenty hooks, ten skills,
   seven commands, four agents, a run protocol, a surface wall, a session-metrics analyser and a
   cross-session hand-off chain exist to keep one long-lived orchestrator cheap. The cheapest
   builds in the repo's history (Muse's, §3) skipped most of it.
5. **The guidance is written as incident history, repeated.** The full-suite rule is stated 21
   times in 12 files; "subscribe to no PR" nine times; the draft-PR rule still cites a 2,000-minute
   CI budget the repo left on 2026-08-31. A fresh session reads about 35k tokens before acting,
   and three of its six first-read files are wrong about the same fact.
6. **Known issues: 96 open, 377 KB, 94k tokens, unwalled.** 55 are live, 6 are already fixed,
   18 are not defects at all, 8 are duplicates, 1 is obsolete, 8 unverifiable. Thirteen entries
   are "carried by" milestones that closed weeks ago.
7. **Hooks cost latency and blindness, not tokens.** Roughly 3k tokens per 200 calls, but the
   typecheck hook takes 14 to 66 seconds per edit, silently times out, and is blind in worktrees;
   one hook can never fire; the digest's PR block is dead in every cloud session.
8. **The code's growth is in the right places** (server 52k LOC, components 68k, tests at parity),
   but two filed debts got materially worse: the server root grew from 27 to 56 files and the
   hand-mirrored API client from 999 to 2,136 lines.
9. **`building-with-judgment.md` is the best process document in the repo** and should become
   the shape of every milestone gate: a numeric bar, written before the build, with the eval run
   on real data.
10. **The first fix is a prose PR** (§8, step 1): correct the state files, close the dead known
    issues, delete the stale plans. The second is the RAG privacy fix. Everything else is
    retirement, not construction.

## 2. How the repo has grown

| Area | Files | Code LOC | Test LOC |
|---|---|---|---|
| `packages/contracts` | 74 | 7,645 | 5,839 |
| `packages/domain` | 61 | 3,923 | 6,036 |
| `packages/pages` | 105 | 10,154 | 8,419 |
| `apps/web/src/server` | 419 | 52,476 | 47,719 |
| `apps/web/src/components` | 579 | 68,187 | 63,575 |
| `apps/web/src/app` | 226 | 8,730 | 18,177 |
| `apps/web/src/lib` | 123 | 9,170 | 6,902 |
| `apps/web/e2e` | 83 | 1,239 | 18,517 |
| `scripts` (incl. hooks) | 107 | 10,872 | 7,680 |

Other measures: 76 ADRs, 49 milestone files (M0 to M49, 42 closed), 55 migrations, 96 open and
235 resolved known issues, 25 checked-out plans (13 for closed milestones), 20 hooks, 10 skills, 7
commands, 4 subagents, 351 commits in the last six days of history this clone holds. Only two
remote branches exist, which is clean.

Growth since the last review of this kind (`2026-09-21-development-loop-review.md`): the server
root went from 27 to 56 flat files; `lib/apiClient.ts` from 999 to 2,136 lines with 67 `fetch`
calls; the board→trip component edges from 22 to 42; line-level lint disables from 131 to 148;
open known issues from about 60 to 96. Each of these was a known issue when it was half the size.

## 3. The agent system

### 3.1 What is here

- **Four subagents** (`.claude/agents/`): `phase-implementer` builds one part red-first with a
  scoped check recipe; `part-reviewer` reads a diff and writes ranked findings to a file;
  `phase-verifier` reads CI and walks a preview; `ki-fixer` closes one known issue.
- **A milestone orchestrator** (`build-a-milestone` and its four stage skills) that plans with
  Mitchell, dispatches builders and reviewers, never touches code (a marker file plus
  `orchestrator-no-code.mjs` enforce it), waits on a `send_later` check-in instead of PR
  subscriptions, and hands itself off to a fresh session past 250k context via `/next-prompt`
  and `create_session`.
- **A subagent protocol** (`.claude/protocol/`) with run directories, a notes board, three exit
  states, a two-strike rule and a report template, used by `/dispatch` and `/ki-sweep`.
- **Twenty hooks** enforcing the above: no full suite locally, no model id in commits, no draft
  on a part branch, no code edits by the orchestrator, no job logs into the orchestrator, no
  message to a closed agent, no brief without branch/files/done, report shapes on stop.
- **Measurement**: `pnpm state` (digest), `pnpm surface` (byte budgets on first reads),
  `pnpm session-metrics` (transcript analysis), and a spend block in each milestone's retro.

### 3.2 What is working

- Red-first tests, scoped local checks and CI-as-verdict. This cut cost by half between M42 and
  M45 and the discipline survived a tool change (Muse's commits say "address part-reviewer
  findings").
- `part-reviewer` as a read-only reviewer writing to a file the fixer reads. The findings it
  produced on the RAG and guests PRs were real (savepoints, N+1s, mocks).
- The architecture, lint, colour, docstring, migration-journal and KI-citation walls in CI. A
  deterministic check beats a sentence of guidance every time, and this repo has learned that.
- The invariants list and the module map in `AGENTS.md`. They are short, binding, and the new
  code obeyed them even when built by a different tool.
- The spend retro (M42) as a method: it measured, named three habits and turned each into a
  hook. The hooks worked (0 GitHub wakes in M45 against 190).

### 3.3 What fights the harness

1. **The orchestrator reconstructs state the harness already has.** `closed-agent-guard.mjs`
   and `orchestrator-context-limit.mjs` parse transcript JSONL from a guessed path to learn an
   agent's context size; one layout change and both exit 0 forever. `state-digest.mjs` calls
   `gh pr list` (GraphQL), which the cloud proxy refuses, so `OPEN PRS` and `MILESTONE PARTS`
   are dead in every cloud session and the orchestrator pays an MCP call to learn what the
   digest was built to print. REST works (`gh api repos/…/pulls`); `pr-digest.mjs` already
   knows this.
2. **Hand-off chains.** M45 ran five sessions; Mitchell started four of them, and that is what
   he called "less automatey". The fix chosen was to have the orchestrator start its own
   continuation session, which adds a `create_session` chain (stops at depth 8, measured) and a
   trigger-deletion dance. The underlying cause is a single long-lived coordinator that must
   survive a whole milestone. A coordinator that lives one feature, ends, and lets the next
   session rebuild from `pnpm state` and git needs no hand-off at all. That requires `pnpm
   state` to be right (§3.5), which today it is not.
3. **Rules enforced by a hook and still stated in prose up to 21 times.** The hook is the rule;
   the prose is cost. `pnpm surface` measures the prose and stays green because the budgets
   were set to fit it.
4. **Two incompatible mandatory report shapes.** `CONTRACT.md` makes `REPORT-TEMPLATE.md`'s
   sections mandatory for every subagent that reads it (all four open with "read CONTRACT,
   binding"); `phase-implementer.md` demands "exactly these headings, nothing else" with
   different headings; `part-reviewer` a 4,000-character hand-back. The conformance hook only
   engages on `## Exit:`, so a blocked implementer is bounced once for missing `## Unit` and
   `## Board entries written`, which mean nothing for a part.
5. **The browser walk is promised everywhere and possible in one place.** `phase-verifier`
   declares `mcp__Claude_Browser__*` tools that exist only in the desktop app; `AGENTS.md`,
   `repo-automation.md` and the digest say "the browser walk needs no local infra". The cloud
   route is `pnpm --filter web walk:preview`, which the verifier never names.
6. **The draft-first rule is enforced on the path cloud sessions do not take.**
   `draft-pr-guard.mjs` asks on `gh pr create`; cloud PRs go through
   `mcp__github__create_pull_request`, where `pr-tool-guard.mjs` deliberately does not enforce
   it. And `gh pr ready` is GraphQL, so a cloud session cannot un-draft a PR with the documented
   command anyway.

### 3.4 Why Muse felt seamless, and what it cost

The `sunny/*` branches (PRs 449 to 468, 2026-10-14 to 16) show the shape: no part 0, no gate
boxes, no sidebar tasks, no scheduled check-ins, no hand-off; sequential small PRs on `main`
(RAG: infra → embed → eval branch → serving → gate 2, 10 to 17 files each, except the guests
stack which merged as one 81-file PR); a reviewer pass per PR; a fix-forward PR the same morning
a deploy broke; and a guideline written afterwards from what was learned. Mitchell merged each.

That is the repo's own `build-a-part` loop without the orchestrator around it. It was fast
because the ceremony was skipped, and the ceremony's promised benefits were not delivered by
the ceremony either: M46 followed the full process and still merged part 0 with 0 of 10 gate
boxes and no retro.

What skipping it cost, measurably: STATUS, TODO, the candidates file and M48's milestone file
were not updated (§4); M48 has serving code in production behind a flag under a heading that
reads "Decisions it needs, none answered"; no ADR records the pgvector choice; the Gate 1 eval
branch (`sunny/rag-part3-gate1`) sits unmerged with no recorded disposition; `building-with-
judgment.md` writes "stacked PRs" and `#461` against the repo's own two conventions; and two
defects a reviewer with the module map in hand would have caught got through (§5.1, §5.2).

The lesson is not that one tool beats another. It is that the valuable parts of the process
are repo-native and tool-agnostic (invariants, the reviewer definition, red-first, scoped
checks, CI walls) and ported for free, while the expensive parts are Claude-Code-specific
machinery whose benefits (gate evidence, doc currency) have to be produced by a check, not a
ritual, or they are not produced at all.

### 3.5 Recommended shape

The target is a hands-off loop where the human's only actions are answering decisions and
merging.

1. **One thin driver per feature, not one orchestrator per milestone.** A session plans one
   feature (decisions, measurable bar, parts), dispatches a builder per part in its own
   worktree, a reviewer per push, a fixer per finding set, and ends when every part's PR is
   ready. The next feature is a new session. No `create_session` chain, no `send_later`
   check-in, no transcript parsing. Waiting is "end the session"; GitHub events and the next
   session's `pnpm state` carry the state.
2. **Make `pnpm state` derive from git and GitHub, not from the docs.** The drift it must catch
   is exactly today's: merged PRs since STATUS's last commit, migrations in the journal that no
   STATUS or milestone file mentions, milestone files whose parts merged while their gate is
   empty, `[x]` gate boxes in a milestone TODO calls unscoped. Use REST (`pr-digest.mjs`'s
   `api()`), and print `DRIFT` only when something is actually inconsistent with reality.
3. **Gates have numbers, written before the build.** Take `building-with-judgment.md`'s rule
   as the milestone template: each gate box is a measurement with a bar, the eval runs on real
   data, a failed bar stops the build. Replace "[walk] on Mitchell's word" boxes with a recorded
   walk (the `walk:preview` script output, or a toolbar thread id).
4. **The reviewer reads the module map.** Add to `part-reviewer` §2 a data-path check: for any
   diff touching a table or a cache, "what happens when the source row changes visibility, is
   deleted, or its owner lapses?" and "which module owns this write?" The RAG privacy gap and
   the Community→Chat write would both have been one line in that review.
5. **Delete the second report shape.** Keep `phase-implementer`'s headings and `part-reviewer`'s
   hand-back; make `CONTRACT.md`'s template apply only inside a `/dispatch` run, and say so.
6. **Hooks: fewer, faster, loud when blind.** §7 lists the exact changes. Every guard that
   exits 0 because it could not read something writes `{"decision":"skip","why":…}` to the
   guard log.
7. **Keep the agent layer tool-agnostic.** `AGENTS.md` and `.agents/skills/` are what Muse,
   Cursor and Codex read; `.claude/` should hold only the Claude-specific wiring (agents,
   settings, hooks). Move the remaining seven skills to `.agents/skills/` with symlinks, as the
   first three already are.
8. **One rule, one place.** `AGENTS.md` carries the invariants, the module map, the Definition
   of Done tiers and the standing rules with Mitchell, in under about 12k tokens. Incidents go to
   retros, numbers to the retro that measured them, procedure to one skill each. §4.3 has the
   cuts.

## 4. Guidance: contradictions, stale claims and reasoning errors

### 4.1 Stale on the same fact, in every first-read file

| Where | Says | True now |
|---|---|---|
| `docs/STATUS.md:31-33` | Next action: build M46 part 1, migration 0048 | Parts 1 to 6 and part 0 merged 2026-10-13/14; gate 0 of 10, no retro |
| `docs/STATUS.md:334-339` | A second "Next action": scope M43; all 48 migrations applied | Contradicts line 31, line 54 (M43 is last) and the journal (55) |
| `docs/STATUS.md:29` | Part 0 is a draft that merges last | PR 432 merged first-class before any gate box |
| `TODO.md:84`, `docs/milestones/README.md:131` | M48 not scoped, "two offline gates before any serving code" | Serving merged 2026-10-16 (`ff0c421`), three gate boxes ticked, decisions heading still "none answered" |
| STATUS, TODO, README | nothing | Trip guests (PR 457, ADR-074, 0053), RAG (PRs 459-467, 0054), `building-with-judgment.md` (PR 468) |
| `AGENTS.md:17` | Current phase: 1 (single-player) | TODO has been in Phase 3 since 2026-08-28 |
| `docs/plans/README.md:1-9`, `AGENTS.md:26-27` | Plans are archived, not checked out | 25 plans checked out, 13 for closed milestones; README cites `docs/known-issues.md` (a directory now) |
| `docs/candidates.md:447` | "Travellers who are not on the app", not placed | Shipped as trip guests |
| `docs/candidates.md:435` | "/ask survives a throw" | Fixed `19c6fc9`; also KI-2026-09-24-w, still open |
| `pnpm state` | `DRIFT: none detected` | All of the above |

### 4.2 Rules whose justification is gone, and other reasoning errors

- **Draft-first PRs** (`AGENTS.md:226-229`, `ADAPTER.md:22`, `ki-sweep.md:160`): justified by
  "2,000 minutes a month, PR 55 spent 315". `ci.yml:3-9` records the repo went public on
  2026-08-31 and minutes are unlimited; `ci-cost-and-capacity.md` re-justifies with tokens and
  wall clock after the fact. Meanwhile milestone parts, the bulk of the work, open ready by rule,
  and the hook enforcing draft-first runs only on the `gh` path. Retire the rule to one line:
  push only what you believe is green; a part opens ready.
- **CI minutes as an exclusive resource** (`ADAPTER.md`, `adapter.json`): same dead budget.
- **The 250k / 100-calls hand-off threshold and the no-subscription rule** come from one
  milestone each (M45, M42) and the measurements (190 wakes, $57, 141 for nothing) are copied
  verbatim into four files. The rules may be right; the numbers belong in the retro that
  measured them, once.
- **Contradictory pairs.** "Never `pnpm check`" (hook-enforced, 12 files) vs `ki-sweep.md:116,
  137` "run the full `pnpm check` once". "Subagents inherit the project context, so briefs stay
  focused" (`building-with-judgment.md:86`) vs `implementer-brief-check.mjs` refusing a brief
  without branch, files and done-criteria. "Default to subagent delegation, except live
  debugging" (`AGENTS.md:36-41`) vs "you never write or read source code" (hook-enforced): the
  exception cannot be taken in the mode most sessions run in, and `AGENTS.md` never mentions the
  marker file. "Part 0 merges last" (six places) vs PR 432. "Do not build ahead of the current
  milestone" (`AGENTS.md:382`, `TODO.md:12`) vs M48 and guests landing while M46 sat open. Either
  Mitchell waived these, and STATUS must say so, or the rules are dead letters; a reader cannot
  tell which.
- **"Never" with carve-outs in the same documents**: full suite never / `ALLOW_FULL_SUITE=1`;
  draft always / except a part; no sleep / `-- <reason>`; never `pnpm lint` (`phase-implementer`)
  / "`pnpm lint` is not denied" (`build-a-part`). Each carve-out is a second edit site.
- **Repetition counts** (grep hits in the files read): full-suite-never-local 21 statements in 12
  files; subscribe-to-no-PR 9 in 7; Mitchell merges 8 in 5; red-first 9 in 6; "TODO rows are the
  order" 6; grep-KIs-first 7; live-eval 4.
- **Incident narrative where an instruction should be**: `AGENTS.md:129-136, 212-231, 305-315,
  398-402, 437-443`; `CLAUDE.md:59-66`; `TODO.md:105-191` (87 lines of closed-out history under
  a live heading); `STATUS.md:184-232, 271-332`; `phase-verifier.md:77-99`;
  `cloud-agent-sessions.md` (29.5 KB, mostly narrative). The guidelines README's own house rule
  forbids restating retros.
- **Other stale instruction** (one-line fixes): `ki-fixer.md:20,52` and `ki-sweep.md:108` cite
  `KI-0XX` filenames and a "Scope" field entries do not carry; `part-reviewer.md:45` and
  `phase-implementer.md:31-43` say six invariants (there are seven); `cloud-agent-sessions.md:
  507-510` says the repo has no Stop hook (it has one); `cleanup-orphans.md:16,133,140` names MCP
  tools that do not exist (`mcp__ccd_session_mgmt__*`, `mcp__plugin_vercel_vercel__*`);
  `AGENTS.md:216` and `dispatch.md:51` cite `superpowers:using-git-worktrees`, not an available
  skill; `worktree-hygiene/SKILL.md:59` cites AGENTS line numbers that moved; STATUS and AGENTS
  each say the other holds the local dev recipe and neither does; eleven files still name
  CodeRabbit, one (`m42-token-spend-retro.md:331-334`) as a live instruction to edit a deleted
  file; `TODO.md:183-191` ends a DONE item with "do this before flipping required checks on".
- **`gh` in cloud sessions.** Correction to a premise some entries carry: `gh` is installed and
  REST-backed commands work (`gh api`, `gh run list`, `gh pr diff`); GraphQL-backed ones fail
  with "GitHub GraphQL is not available from Claude Code sessions" (`gh pr list`, `gh pr checks`,
  `gh pr ready`, and by the error's own wording, draft/ready changes). KI-2026-10-13-f is
  narrower still: job logs redirect to blob hosts the proxy refuses. `AGENTS.md:352-358, 377`,
  `phase-verifier.md:35-36,58`, `ci-triage/SKILL.md:28,35,41`, `next-prompt.md:32-40`,
  `roadmap.md`, `ki-sweep.md`, `cleanup-orphans.md` and `worktree-hygiene` all prescribe the
  GraphQL forms. One line in `cloud-agent-sessions.md` fixes the lot: "`gh pr *` is GraphQL and
  fails here; use `gh api repos/…` or `pnpm -s pr-digest`".

### 4.3 What a reader pays, and five cuts

Measured: `AGENTS.md` 27,709 + `CLAUDE.md` 4,923 + `STATUS.md` 25,486 + `TODO.md` 18,618 +
`milestones/README.md` 62,788 + digest 2,412 = 141,936 bytes, about 35k tokens, before the first
useful action, plus the current milestone file. The surface wall passes with STATUS 15 bytes
under its retirement trigger. Open known issues add 377 KB that nothing budgets.

Cuts that remove about 73 KB and lose no binding rule:

1. `docs/milestones/README.md` table rows to one line each (id, title, state, date, file);
   `pnpm milestones` already prints exactly that and each file holds the history. About 45 KB.
2. `docs/STATUS.md:61-232` to `docs/retros/2026-10-16-status-archive.md`, keeping the pointer
   row its own header prescribes. About 15 KB, and it removes both stale "Next action"s.
3. `TODO.md:105-191` to the same archive; one line each for the two still-live items (task 7.5,
   the descriptor refactor). About 6 KB.
4. `AGENTS.md:340-378` (the laptop `--watch` recipe, "Do not watch what cannot run") to
   `cloud-agent-sessions.md`, leaving two sentences; `AGENTS.md:212-231` incidents to one rule
   line each. About 4 KB.
5. `AGENTS.md:158-195` to a pointer at `repo-automation.md`; `CLAUDE.md:7-30` duplicates
   `AGENTS.md:17-27`. About 3 KB.

## 5. Code architecture

Judged against the module map and invariants. `pnpm arch`: 0 errors, 9 warnings, the same 9 as
2026-09-25. Ranked by cost.

### 5.1 Unpublishing or deleting a playbook never re-queues its embeddings (privacy)

`apps/web/src/server/savedDays.ts` enqueues embeddings in `storeSavedDay` (line 292) and
`updatePlaybookContent` (line 857) only. `setSavedDayVisibility` (line 671) and `deleteSavedDay`
(line 952) do not, and nothing outside `server/ai/` touches `day_embeddings`. Retrieval
(`server/ai/retrieval.ts:37-55`) filters on the embedding row's own `visibility` and `owner_id`,
a denormalised copy refreshed only when the row is re-embedded (`sweep.ts:59-60`). So: publish a
playbook, let the nightly sweep embed it as public, unpublish or delete it, and every plan turn,
including a logged-out user's (`userId: null`), keeps receiving its days as examples until
something else re-embeds that playbook. `retrieval.int.test.ts` tests a row that *is* private,
never one that *became* private.

Fix: enqueue the day indexes in both functions (the queue upsert resets done rows to pending;
the sweep tombstones a deleted source), or join the source table in the privacy predicate. Add
the red-first integration test: publish, embed, unpublish, retrieve as another user, expect zero
rows. Severity: correctness, privacy. This is the one finding that should ship this week.

### 5.2 Trip Planning now imports the AI module, and every command re-queues every day

`server/commands.ts:31` imports `./ai/queue`, and lines 289-290 enqueue
`detail.days.map((_, i) => i)` on every command, by design ("Unconditional"). `ai/**` imports
`@/server/commands` in 20 places. That is a root↔subfolder cycle of the kind KI-2026-09-23-b says
the wall cannot see, in the module the map guards most: Planning now knows about embeddings.
Cost: a 14-day trip edited 30 times a day writes 420 queue upserts, one `db.execute` each
(`queue.ts:48-50`), inside the command transaction, and re-embeds all 14 days nightly at provider
cost whether or not any text changed. Fix: hash the chunk text per day in `appendAndProject` and
enqueue only changed indexes, batch the insert into one multi-row statement, and invert the
dependency with an after-commit callback that `ai/` registers, so the import runs AI → Planning
only.

### 5.3 The embed sweep cannot keep up, and nothing says so

`sweep.ts:20` processes 50 rows sequentially per run with a 30 s provider timeout each; the cron
is daily (`vercel.json`, Hobby limit); the route declares no `maxDuration`. With §5.2's
amplification four trips consume a day's budget; a function cut mid-run leaves rows in
`processing` until the next day's recovery. Fix: `export const maxDuration`, embed in small
concurrent batches, and print the pending-queue depth in the cron's summary so a backlog is
visible in logs. *Not verified* against the Vercel plan's default duration.

### 5.4 Two filed debts got worse

- **KI-2026-09-23-b** (server root): 27 files at filing, 56 today, with new root→subfolder edges
  (`commands.ts`→`ai/queue`, `savedDays.ts`→`ai/queue`, `reports.ts`→`chat/rev`,
  `quota.ts`→`assistant/entitlements`). Minimal fix: `git mv` the planning cluster into
  `server/planning/` and the library cluster into `server/library/`; the wall then sees both
  cycles and the `PLANNING_AND_ACCESS` regex in `.dependency-cruiser.cjs:34-37` shrinks.
- **KI-2026-09-05-q** (API client): 999 lines / 35 fetches at filing, 2,136 / 67 today, 88
  `catch` blocks, still no `request<T>()` core; chat and guests each added hand-mirrored
  wrappers plus hand-written MSW handlers (`mocks/handlers.ts`, 1,253 lines). The fix in the KI
  is still right and is now twice the work.
- **KI-2026-09-23-c** (board/trip/lenses cycle): board→trip edges 42 against 22 at filing.

### 5.5 Community writes Chat's table directly

`server/reports.ts:381-383` updates `trip_messages.hidden_at` and imports `bumpChatRev`.
ADR-073 §4 sanctions the admin acting on the row, but the module map says Community references
by id, and a second writer with its own idea of the rev is the thing the map exists to prevent.
Fix: `chat/messages.ts` exports `hideMessage` and `restoreMessage` that bump the rev; `reports.ts`
calls them by id.

### 5.6 Three money formatters disagree

`lib/formatMoney.ts:46` (symbol table), `packages/pages/src/format.ts:13` (`Intl`, treats JPY as
zero-decimal) and the domain's `fmt` in `conflicts.ts`. ADR-008 stores hundredths for every
currency, so the same yen price can render as `¥1,234.00` on the board and `¥12.34` in a widget.
Violates ADR-068. Fix: one formatter in `@tc/contracts` (pages may not import app code); delete
the others. Same pattern: `dayLabel` ×3, `tripDateRange` ×2.

### 5.7 Smaller findings

- HNSW post-filtering can return fewer than k rows on a private-heavy corpus
  (`retrieval.ts:117-126`, `LIMIT 2k` after the index's 40 candidates); fail-open hides it.
  `SET LOCAL hnsw.ef_search = 200` and log `rows.length < k`. *Not verified* empirically.
- `enqueueDayChunksForEmbedding` is N statements, not one (`queue.ts:48-50`).
- The sweep and cron 500 on a deployment with `CRON_SECRET` set and no gateway key; check the
  key first and return `skipped`.
- `getTripDetail` is read outside the transaction in five guest functions
  (`access/guests.ts:81, 117, 153, 183, 226`), the pattern inherited from `members.ts`.
- `listMessages` returns the newest 200 and a `hasEarlier` boolean with no cursor
  (`chat/messages.ts:14, 40-51`): older chat history is unreachable from the API.
- `server/assistant/tools/read.ts` carries nine hand-written interfaces each mirrored by a
  `z.ZodType<T>` schema, which checks assignability only. Write the schema first and infer.
- The `Promise.race` timer in `planExamples.ts:87` is never cleared and the losing query runs on.
- `proxy.ts:15, 25` still says "Edge runtime"; which runtime Next 16 uses here is *not verified*
  (SYSTEM-DESIGN §13 says the same).
- `trip_guests.created_at DEFAULT now()` is the only DB-clock default in the schema; harmless,
  inconsistent with "time is passed in".
- `ai/simulatedModel.test.ts` (1,299 lines, 58 cases) tests a test double that is itself the
  tenth-largest source file. That pair is the one place where test volume is cost, not value.

### 5.8 God files and their seams

| File | Lines | Seam |
|---|---|---|
| `server/ai/handleAskRequest.ts` | 2,255 | Lines 1793-2255 are pure prompt building; move to `assistant/instructions.ts`. Apply-proposal (1671-1790) and beyond-trip (1151-1352) handlers are their own files. |
| `lib/apiClient.ts` | 2,136 | One `request()` core plus per-module client files (KI-2026-09-05-q). |
| `components/pages/PageScreen.tsx` | 1,760 | 22 `useState`, 6 `useEffect`; lift into `usePageEditor` and `usePageData`. |
| `server/db/schema.ts` | 1,705 | Section comments already mark modules; split to `db/schema/{identity,planning,access,library,entitlements,billing,ai,chat}.ts` with one index. Mechanical. |
| `components/board/TripBoardScreen.tsx` | 1,681 | Hub of the board/trip cycle; same hook extraction. |
| `server/assistant/admission.ts` | 1,600 | The declared stage array (line 1446) is the good part; stages, ports, request schema and grant record are five concerns. |

### 5.9 What is genuinely good

`cronAuth.ts` fails closed and compares in constant time. The RAG privacy predicate is one
function interpolated into both legs, with the reason written down. `queue.ts:89-108` wraps the
enqueue in a savepoint so a queue failure cannot poison a planning write. `sweep.ts` claims with
`FOR UPDATE SKIP LOCKED`, recovers orphans and dead-letters after retries. `chat/access.ts`
re-evaluates membership and the collaboration gate on every request with the gate's own code.
The admission pipeline is a declared array whose order a test asserts. `instrumentation.ts`
filters one exact React message and has a test that makes both renderers produce the real error.
The architecture wall checks that its own import graph is non-empty. Ten of 25 pages now render
on the server. Three contract changelog entries for guests each name the consumers updated.

## 6. Known issues and candidates

96 open entries, read in full and checked against the tree:

| Verdict | Count | Entries |
|---|---|---|
| Live | 55 | the rest |
| Likely resolved, still in `open/` | 6 | KI-2026-09-24-w (`19c6fc9`), KI-2026-10-05-h (`TripProvider.tsx:202`, `accessLost`), KI-2026-10-09-b (`sheet.tsx:68-90` `onCloseAutoFocus`), KI-2026-10-12-b (`096a0ce`, Docker Hub auth), plus two narrowed to residuals (KI-005, KI-2026-10-12-g) |
| Not a known issue | 18 | KI-024, KI-079, KI-082 (decisions → ADR), KI-2026-08-30-c, -09-12-b, -10-13-e, -10-13-f (harness facts → `cloud-agent-sessions.md`), KI-2026-09-02-d, -09-22-a, -09-22-c (already stated in a guideline or a code comment), KI-2026-09-07-d, -09-26-t, -10-12-d (incidents → retro or delete), KI-2026-09-24-o, -09-27-d (feature asks → candidates), KI-2026-10-09-f (an unwalked gate half → M39's file), KI-2026-09-16-d (process), KI-2026-10-03-a (half fixed, rest is Next's own log line) |
| Duplicate | 8 | KI-015 = KI-2026-09-20-a; KI-2026-09-25-n = -o; KI-2026-10-03-d = -g; KI-2026-10-05-b, -10-11-a, -10-12-a, -10-12-f are one class under the umbrella KI-2026-10-14-c (unseeded property floors) |
| Obsolete | 1 | KI-2026-10-04-c names `zai/glm-4.7-flashx`; the cheap tier is `anthropic/claude-haiku-5.5` since 2026-10-10 |
| Unverified | 8 | KI-2026-09-05-n (Dependabot API 403 here), -09-23-a, -10-03-b, -10-06-a, -10-09-c, -10-11-c, -10-14-c, -09-16-d's env half |

Thirteen entries say "owned by M9, carried" and ten more "M14, carried"; M9 closed 2026-10-06,
M14 2026-10-01, M24 2026-09-25, with none of their carried entries taken or re-homed. Nine
entries cite a path, line or identifier that no longer exists (`.claude/skills/next-prompt/
SKILL.md`, `next@16.3.3`, `deps.ts:106`, `grade.ts:96`, `apiClient.ts` at 999 lines).

The register is 3,601 lines; the ten longest entries hold a third of it as dated addenda,
strike-throughs and proof narratives for sub-items already closed. Status lives in heading
suffixes ("NARROWED, residuals 1 and 2 CLOSED"), so `ls open/` no longer tells you what is live.
The October entries (15 to 35 lines, Symptom / Why not fixed / Fix direction, no history) were
each checkable in under a minute. Make that the rule: an entry is rewritten, not appended to;
line numbers are banned in `Area:` (symbol names survive, line numbers do not); an entry over
40 lines fails `check-ki-filenames.mjs`; a closed sub-item moves to `resolved/` as its own file.

Candidates: delete "Travellers who are not on the app" (built as guests) and "/ask survives a
throw" (fixed); remove the "⌘K hands unmatched text to Ask:" bullet (M45 built it); rewrite the
status of "Architecture map" (SYSTEM-DESIGN exists) and "AI cost/quality tuning" (M33 built the
harness); the chat entry and its follow-ups wait on M46's gate close to be deleted by the script.

## 7. Hooks and context pollution

Measured in this container over a typical 200-call session: the hooks inject about 11 to 12 KB,
roughly 3k tokens, and about 8.3 minutes of latency, 90% of it the typecheck hook. Eight node
processes run per Bash call (432 ms) and print nothing when nothing is wrong. The layer is not
where tokens go; its costs are latency and silent blindness.

| Finding | Fix |
|---|---|
| `typecheck-touched-package.mjs` claims ~4 s / 1.6 s; measured 66 s cold and 14 to 16 s warm for `apps/web`, 6 s for domain. No `timeout` in settings, so the cold run is killed at the 60 s default with nothing shown. A `packages/contracts` edit fans out to seven packages and cannot finish. An edit under a worktree path matches no prefix and exits 0 silently. | Delete it: `build-a-part` already runs `tsc --noEmit` once before push, which is what 30 hook runs amount to. If kept: `"timeout": 180`, fan out to domain and web only, resolve the root from the edited file's own repo, print one line when skipping. |
| `state-digest.mjs:189-201` uses `gh pr list` (GraphQL, 403 here); the `OPEN PRS` and `MILESTONE PARTS` blocks are dead in every cloud session. | Reuse `pr-digest.mjs`'s REST `api()`; say "GraphQL blocked", not "unavailable". |
| `notification-unsubscribe-nudge.mjs` fires on `ReadNotifications`, which never fires since the orchestrator subscribes to no PR (its sibling hook's own comment says so). | Delete the hook, its test and the settings block. |
| Draft-first is enforced on `gh pr create` only; cloud PRs go through the MCP tool where `pr-tool-guard.mjs` deliberately does not enforce it. | Retire the rule (§4.2) or add the one branch to `pr-tool-guard.mjs`. |
| `subagent-report-conformance.mjs` engages on `## Exit:` and demands `/dispatch` run sections from a blocked `phase-implementer`. | No-op when `unitForCwd(cwd)` is null, like its three siblings. |
| `resource-lease`, `subagent-file-scope`, `orchestrator-no-code` spawn git on every Bash or edit before the cheap `existsSync` that would short-circuit them; `check-destructive-git` keeps its own quote-blind tokenizer beside `lib/shell.mjs`. | One `git-guard.mjs` (destructive + commit message + push nudge) and one `gh-guard.mjs` (draft + lean reads); test for `.claude/run` before any spawn. 8 → 4 processes per Bash. |
| `closed-agent-guard.mjs:49-51` and `orchestrator-context-limit.mjs:47-49` guess the transcript layout and exit 0 on a miss; `guard-log.mjs` records only deny/note, so `session-metrics` cannot tell "never engaged" from "always passed". | Log `skip` with a reason; teach the reader the third value. |
| `reviewer-report-check.mjs:8` says the orchestrator posts the review with `--body-file`; `review-a-part` says never. `repo-automation.md:104-133` lists 10 of 20 hooks. | Fix the comment; generate the list from `settings.json`. |
| Session start: the remote branch runs `pnpm install` and `pnpm run setup` unsilenced while the local branch silences both; "181 commits ahead of origin/main" is a shallow-clone artefact. | Redirect like local; suppress the ahead count when `--is-shallow-repository`. |

Outside the repo's control but in every session's context: the user-level plugins configured on
this account inject 35 job-hunt skills, the productivity and design suites, and connection
failures for twelve MCP servers (Figma, Intercom, PagerDuty, Prisma, Asana, Atlassian, ClickUp,
Linear, Monday, Notion, Slack, the plugin GitHub server) at the top of every turn. None is used
by this repo. Disabling them per project in Claude Code's plugin settings removes several
thousand tokens of skill listings and error banners from every session, and the Neon and Vercel
MCP servers (370 deferred tools between them) could be scoped to the sessions that deploy.

## 8. Sequenced plan

**Step 1, one prose PR this week (Tier 1, nothing to run):**
- Rewrite STATUS's *Where the work is* and *Next action* (M46: close the gate; guests and RAG
  shipped off-milestone with Mitchell's say-so recorded or not); delete the second Next action
  and the migration count; archive lines 61-232.
- TODO: M48's row says what shipped and that its decisions are unanswered; delete the 87 lines
  of closed-out history.
- M48's file: record the pgvector decision as an ADR, tick or strike the decisions, record the
  Gate 1 branch's disposition.
- Known issues: move the 6 resolved, delete or re-home the 18 non-issues, merge the 8
  duplicates, retire the obsolete one; strip the "carried by M9/M14" boilerplate.
- Candidates: the four deletions in §6.
- Delete the 13 plans for closed milestones; fix `plans/README.md`'s two paths and its claim.
- The one-line fixes in §4.2 (CodeRabbit retro note, `gh` REST line, seven invariants, hook
  count, MCP tool names, KI filename form, the `#` convention in the new guideline).

**Step 2, code PRs this week:**
- §5.1 RAG privacy: enqueue on unpublish and delete, red-first integration test.
- §5.2 and §5.3: changed-days-only enqueue, one batched insert, `maxDuration`, queue depth in
  the cron summary.
- Hooks: delete the typecheck and notification hooks, merge the Bash guards, REST in the digest,
  skip-logging in the guards. `scripts/hooks/__tests__` covers the merge.

**Step 3, before the next milestone (prose, then one mechanical code PR):**
- `AGENTS.md` retirement pass to one-rule-one-place (§4.3 cuts); the milestone README table
  generated from the files; `phase-verifier` rewritten around `walk:preview`; one report shape.
- `pnpm state` derives drift from git and REST (§3.5 item 2).
- `git mv` the server root into `planning/` and `library/` (§5.4); split `schema.ts` by module.
- The milestone template takes `building-with-judgment.md`'s gate shape.

**Step 4, the next milestone itself** is the test of the thin-driver loop (§3.5 item 1): one
session per feature, no hand-off, no check-in, the reviewer reading the module map. Measure it
with `session-metrics` the way M42 was measured, and compare against M45's $24 per thousand
lines and Muse's builds.

## Not verified

The Vercel plan's default function duration; HNSW under-k behaviour on the real corpus; which
runtime `proxy.ts` runs under on Next 16; whether `if:` on a hook is a supported settings
field; the SubagentStop payload's `agent_type` field; the Dependabot alert count (API 403 from
here); `pnpm state`'s `PROD MIGRATIONS` line, which cites a merge commit rather than a workflow
run; whether Mitchell waived "part 0 merges last" and "do not build ahead" for M46, guests and
RAG.
