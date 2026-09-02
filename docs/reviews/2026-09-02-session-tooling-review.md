# Session tooling review — what past Claude Code sessions actually spent context on

**Date:** 2026-09-02
**Scope:** every Claude Code session transcript for this repo, 2026-07-08 → 2026-09-02.
**Nature:** read-only mining of `~/.claude/projects/`. No repo code was changed.

---

## Method

### Corpus

| | |
|---|---|
| Project directories | 35 (`-Users-...-travel-collab`, plus 33 `--claude-worktrees-*`, plus `-apps-web`) |
| Session files (`*.jsonl`) | **426** |
| Files with at least one assistant turn | 421 |
| Main-thread sessions (uuid-named) | **72** |
| Subagent transcripts (`agent-*`) | **347** |
| On-disk size | 274 MB |
| First / last timestamp | `2026-07-08T02:26:58Z` / `2026-09-02T07:47:49Z` |
| Model requests (deduped by `requestId`) | 22,982 |
| `tool_use` blocks extracted | 24,098 |
| `tool_result` blocks extracted | 24,101 |

### How the numbers were produced

Nothing was read into context in bulk. Three TSV extracts were built with `jq`
over every file, then aggregated with `awk`/`python3`:

```sh
# per tool call: session, dir, isSidechain, tool_use_id, tool name, first arg
jq -rc 'select(.type=="assistant") | . as $r | (.message.content//[])[]
        | select(.type=="tool_use")
        | [$b,$d,($r.isSidechain|tostring),.id,.name,
           ((.input.command // .input.file_path // .input.skill // .input.pattern
             // .input.subagent_type // .input.url // "")|tostring
            |gsub("[\t\n\r]";" ")|.[0:400])] | @tsv' "$f"

# per tool result: session, tool_use_id, result length in chars, is_error
jq -rc 'select(.type=="user") | (.message.content//[])
        | if type=="array" then .[] else empty end | select(.type=="tool_result")
        | [$b,.tool_use_id,((.content//"")|tostring|length),((.is_error//false)|tostring)] | @tsv' "$f"

# per session: id, dir, first/last ts, branch, turns, output/cache_creation/cache_read
jq -rc -s '...' "$f"
```

The two were joined on `tool_use_id`:

```sh
awk -F'\t' 'NR==FNR{sz[$2]=$3; err[$2]=$4; next}
            {print $0 "\t" (sz[$4]+0) "\t" err[$4]}' toolres.tsv tooluse.tsv > joined.tsv
```

`cd <path> && …` prefixes were stripped before command-shape aggregation, so
`bash.tsv` keys on the semantic command, not the worktree it ran in.

### Token accounting caveats — read these before trusting a number

1. **`chars / 4` is the estimator for text results.** It is an approximation.
   Where an exact figure exists (`message.usage`) it is quoted as such.
2. **Browser results are excluded from every char-based total below.**
   `mcp__Claude_Browser__computer` returned 19.1 M chars, but 189 of those calls
   are base64 screenshots whose real cost is ~1.1–1.6 k tokens each, not
   chars/4. Browser findings are stated in *screenshot counts* instead.
   Non-browser tool output totals **54.3 M chars ≈ 13.6 M tokens**.
3. **The re-read multiplier is the important one.** Deduped across all 22,982
   requests: `cache_creation_input_tokens` = **86,632,214**;
   `cache_read_input_tokens` = **4,440,509,491**. Ratio **51.3×**. Every token
   written into a session's context is re-read on average 51 times before that
   session ends. A byte saved at write time is not saved once.

```sh
find ~/.claude/projects/-Users-...-travel-collab* -name '*.jsonl' -exec \
  jq -rc 'select(.type=="assistant" and .requestId)
          | [.requestId,(.message.usage.cache_creation_input_tokens//0),
             (.message.usage.cache_read_input_tokens//0)] | @tsv' {} + \
  | sort -u -k1,1 | awk -F'\t' '{cc+=$2; cr+=$3} END{print cc, cr, cr/cc}'
```

Peak context (`max cache_read_input_tokens` per session), main-thread only:
**p50 = 208 k, p75 = 337 k, p90 = 503 k, max = 930 k**.

---

## Measured findings

Token figures are `chars/4` on non-browser tool output unless stated.

| # | Pattern | Occurrences | Est. token cost | Evidence command |
|---|---|---|---|---|
| **F1** | **Repo-doc orientation re-reads.** STATUS.md, TODO.md, `docs/milestones/`, known-issues, AGENTS.md, `docs/architecture/`, `docs/specs/`, `docs/guidelines/`, `docs/plans/` re-read via `Read` and via `cat`/`sed -n`/`grep` | **2,621 tool calls across 220 of 419 sessions** | **~1,913,600 tok** — 16.9 % of all non-browser tool output | `awk`/python over `joined.tsv` grouping arg by the nine path patterns |
| F1a | └ `docs/known-issues*` | 692 calls, 142 sessions | ~523,300 | `awk -F'\t' '$5=="Bash" || $5=="Read" {if ($6 ~ /known-issues/) …}'` |
| F1b | └ `docs/plans/` | 381 calls, 64 sessions | ~329,900 | same, pattern `docs/plans` |
| F1c | └ `docs/milestones/` | 435 calls, 69 sessions | ~265,500 | same |
| F1d | └ `AGENTS.md` | 207 calls, **101 sessions** (63 of them subagents) | ~260,500 | same |
| F1e | └ `docs/STATUS.md` | 328 calls, 68 sessions | ~207,100 | same |
| F1f | └ `TODO.md` | 190 calls, 55 sessions | ~107,400 | same |
| **F2** | **Session bootstrap.** Orientation calls inside the *first 20 tool calls* of a main-thread session | **66 of 72 main sessions** | mean **7,760 tok/session**, median 6,037; **~512,200 tok total** | python: first-20 window, regex `STATUS\|TODO\|milestones\|known-issues\|AGENTS\|CLAUDE\|git log\|git branch\|gh pr (list\|view)\|gh run list\|git worktree\|git status\|guidelines\|architecture\|contracts` |
| **F3** | **Subagents re-do the orientation.** 347 subagent transcripts spend 8.0 % of their tool output on the same nine doc sources | 63 read AGENTS.md (~185,500 tok); 96 read known-issues (~313,800 tok); 27 read milestones; 23 read STATUS.md | **~814,000 tok** | python, `joined.tsv` filtered to `agent-*` session ids |
| F3a | Agent dispatches whose *brief text* says "read AGENTS.md" | **78 of 355** dispatches (66 say "known-issues", 25 say "STATUS.md") | drives F3 | `jq … select(.name=="Agent") \| .input.prompt \| test("AGENTS\\.md")` |
| **F4** | **`phase-verifier` has never been dispatched.** In the repo since 2026-08-24, named in AGENTS.md's automation table, mentioned in 25 transcripts | **0 of 356 `Agent` calls**. Dispatch mix: `general-purpose` 203, none-specified 62, `phase-implementer` 45, `feature-dev:code-reviewer` 17, `ki-fixer` 16, `Explore` 8 | see F5 | `jq … select(.name=="Agent") \| .input.subagent_type \| sort \| uniq -c` |
| **F5** | **Browser verification runs in the main thread.** Consequence of F4 | 1,273 browser calls / **124 screenshots** in **16 main sessions** vs 517 calls / 77 screenshots in 9 subagents | ~**174,000 image tok** in main context (~11 k per affected session), *before* the 51.3× re-read multiplier | `awk '$5 ~ /Claude_Browser/ {k=($1~/^agent-/?"sub":"MAIN") …}' joined.tsv` |
| **F6** | **Redundant re-reads.** Same path `Read` twice in one session **with no intervening `Edit`/`Write`** | **186 calls in 89 sessions** (unfiltered figure, incl. legitimate post-edit re-reads: 472 calls / 143 sessions / ~705 k tok) | **~331,400 tok** | python: per session, track `lastread` + `dirty` sets |
| **F7** | **Skills exist and are not invoked.** | `minimal-check-subset`: **9 sessions**, vs **45 sessions running full `pnpm check`** (130 calls) — **zero overlap**. `ci-triage`: **3 sessions**, vs 50 sessions / 304 manual `gh run\|pr view\|checks` calls. `worktree-hygiene`: **4 sessions**, vs 47 sessions / 112 manual `git worktree` calls. | full-`pnpm check` output alone ~76,700 tok; manual `gh` ~65,000; manual worktree ~32,000 | `awk '$5=="Skill"{c[$6]++}' joined.tsv` cross-referenced with `bash.tsv` regexes |
| **F8** | **`/roadmap` is not invoked** — and would not have helped much if it were, because it *instructs* reading the same four files rather than compressing them | 9 sessions invoked `/roadmap`; **109 sessions read the STATUS/TODO/milestones trio**; **~443,000 tok** of that reading happened in sessions that never invoked it | ~443,000 tok | `grep -l '<command-name>/roadmap'` ∩ python doc-read set |
| **F9** | **Environment bootstrap is hand-rolled.** `pnpm setup` shipped 2026-08-16, but `.claude/hooks/session-start.sh` only runs it when `CLAUDE_CODE_REMOTE=true` | 85 sessions touched `.env.local`/`DATABASE_URL`/`LOCATIONIQ`; **47 hand-rolled env calls in 22 sessions *after* 2026-08-16** (vs 9 calls / 6 sessions before). `pnpm setup` used in only 10 sessions. 39 sessions performed ≥3 of the 5 bootstrap steps (install / env / seed / docker / launch.json) | ~105,800 tok on env commands; ~141,800 tok of bootstrap command output | `awk '$5 ~ /cp .*\.env\|cat > .*\.env\|export DATABASE_URL\|export LOCATIONIQ/' bash.tsv` split on date |
| F9a | └ **Literal API-key material pasted into shell commands** and thereby into transcripts | **11 bash calls, 2 sessions** (`export LOCATIONIQ_API_KEY="pk.864c…"`) | security, not tokens | `awk '$5 ~ /pk\.[0-9a-f]{20,}\|sk-[A-Za-z0-9_-]{20,}\|ghp_[A-Za-z0-9]{20,}/' bash.tsv` |
| **F10** | **Hand-polling `gh pr checks`.** AGENTS.md §"Waiting on PR checks — do not hand-poll" landed 2026-08-24 | bare (no `--watch`): 19 before → **67 after**; with `--watch`: 1 before → 66 after. 36 of the 67 residual bare calls are in **two sessions on 2026-08-29** | ~29,200 tok + wall clock | `awk '$6 ~ /gh pr checks/ {era=($1<"2026-08-24"?…); k=($6~/--watch/?"watch":"bare")}' bashd.tsv` |
| **F11** | **The `ci-like` rule worked.** CLAUDE.md rule 1 landed 2026-08-26 | before: **106 plain / 11 ci-like**; after: **18 plain / 55 ci-like** | rule, not tooling | `awk '$6 ~ /test:e2e/ {era=($1<"2026-08-26"?…); kind=($6~/ci-like/?…)}' bashd.tsv` |
| **F12** | **The prose-tier rule worked.** | Strict measure (no subagents dispatched, every `Edit`/`Write` target `*.md`, yet a typecheck/lint/test/e2e ran): **8 sessions, 21 calls** | ~10,100 tok | python; loose measure (162 sessions) is unusable — main sessions verify code their subagents wrote |
| **F13** | **Retry loops are not a problem.** | 406 errored bash calls of 15,118 (**2.7 %**), across 158 sessions; only **8 distinct commands** failed ≥2× in the same session, 20 calls total; worst is 4× | ~78,300 tok | `awk '$5=="Bash" && $8=="true"' joined.tsv` |
| **F14** | **No measurable context-exhaustion population.** | 1 `compact_boundary` event in 426 files. 145 `api_error` events, **all network** (asleep/ENOTFOUND/ECONNRESET/timeout) | — | `jq 'select(.type=="system") \| .subtype' \| sort \| uniq -c` |

### The doc surface itself

| File | Bytes | ≈ tokens |
|---|---:|---:|
| `TODO.md` (root) | 50,506 | 12,600 |
| `docs/milestones/README.md` | 49,340 | 12,300 |
| `docs/STATUS.md` | 46,428 | 11,600 |
| `AGENTS.md` | 27,216 | 6,800 |
| `docs/known-issues/open/` (42 files) | 142,197 | 35,500 |
| `CLAUDE.md` | 2,095 | 520 |
| **Total "where are we" surface** | **315,687** | **~79,000** |

Reading it once costs ~79 k tokens. F2 says sessions pay a median 6 k and mean
7.8 k of that in their opening moves alone, and F1 says the repo-wide bill is
1.9 M tokens.

---

## Recommendations, ranked by (measured saving ÷ effort)

### R1 — `scripts/state-digest.mjs`, printed by the existing `SessionStart` hook

**Form: a script** (plus two lines of wiring into a hook that already exists).

Not a skill: nothing here needs judgement, and a skill still costs a model turn
plus its own instructions. Not a slash command: the whole point is that it fires
*without* being asked — F8 shows the opt-in path is taken 9 times out of 109.
Not a subagent: a subagent's report is itself tokens, and this is deterministic
extraction.

**Must not duplicate `/roadmap`.** `/roadmap` is a *reconciliation procedure* —
it tells the model to read four files and report drift. It does not reduce the
read; it structures it. R1 does the extraction in Node and prints the answer.
`/roadmap` should be edited to call the script for its Step 1 and Step 3 and
spend its turn on judgement (which source to believe, what the drift means),
which is the part a script cannot do. Likewise it must not duplicate
`worktree-hygiene` — the digest prints a worktree *count* and defers.

**Interface**

```
name     scripts/state-digest.mjs   (exposed as `pnpm state`; `--json` for machines)
trigger  .claude/hooks/session-start.sh (both local and remote branches);
         also `/roadmap` step 1+3, and every subagent brief (see R4)
inputs   docs/milestones/README.md ("Current milestone" line + table)
         TODO.md (first unchecked item)
         docs/STATUS.md (the leading "where the work is" block only)
         docs/known-issues/open/*.md (H1 title + one-line summary, never bodies)
         git: branch, `log --oneline origin/main -5`, `worktree list`
         gh:  `pr list --state open --json number,title,headRefName,createdAt`
output   ~60-80 lines, budget ≤ 2,500 tokens:
           CURRENT MILESTONE: M17 — <name>   [source: milestones/README.md:NNN]
           FIRST UNCHECKED TODO: ...          [TODO.md:NNN]
           STATUS SAYS: <3 lines>             [STATUS.md:NNN]
           DRIFT: none | <the four-way mismatch, named>
           OPEN PRS: #116 ... / #113 ...
           WORKTREES: 12 (run worktree-hygiene to audit)
           OPEN KIs: 42 — KI-3 <title> / KI-7 <title> / ...   (titles only)
           NEXT READ: <the one file this state implies>
```

The digest must print **file:line citations**, not prose, so that a session
needing detail opens one file at one offset instead of `cat`-ing the whole
thing — which is what produced the 29 k-char `sed -n '/^## Open/,/^## Resolved/p'`
calls in F1a.

**Estimated saving.** F2 measures 7,760 tok/main session of opening orientation
(512 k total over 72 sessions). A ≤2,500-token digest that answers the same
question replaces most of it — call it **~5,000 tok per main session**. With F3
(R4 below) it also removes the largest slice of the 814 k subagent orientation
bill. At the measured 51.3× cache-read multiplier (Method §3), 5 k tokens
removed from the top of a session's context is what a session re-reads on every
subsequent turn.

**Effort:** ~150 lines of Node, one `pnpm` script entry, two lines in
`session-start.sh`, an edit to `.claude/commands/roadmap.md`. Highest ratio on
the list by a wide margin.

---

### R2 — Run `pnpm run setup` in the **local** branch of `.claude/hooks/session-start.sh`

**Form: a one-line hook fix.** The hook exists; the script exists; only the
wiring is wrong.

`session-start.sh` runs `pnpm install && pnpm run setup && start_postgres` when
`CLAUDE_CODE_REMOTE=true`, and on the local branch runs only
`pnpm install --frozen-lockfile`. `scripts/setup-env.mjs` is idempotent and
explicitly *never overwrites* an existing `apps/web/.env.local`, so running it
locally is safe by construction.

**Must not duplicate:** nothing. This is a correction to an existing hook, not
new machinery. It does not touch Postgres — the local branch should stay out of
docker's way.

**Estimated saving.** F9: **47 hand-rolled env commands across 22 sessions
after `pnpm setup` shipped**, ~105,800 tok of env-fiddling output, plus the
`docker ps` / `pg_isready` / `curl localhost` probing that follows a missing
`.env.local`. It also closes F9a: the two sessions that pasted a literal
LocationIQ key into 11 shell commands did so *because* the worktree had no
`.env.local`. Those keys are now sitting in transcripts.

**Effort:** two lines. Do this first if only one thing gets done.

---

### R3 — Carry the digest in the subagent brief; stop telling subagents to read AGENTS.md

**Form: a template/prose change** (`.claude/protocol/DISPATCH-TEMPLATE.md`,
`.claude/agents/*.md`), riding on R1's script output.

**Must not duplicate:** `CONTRACT.md` already governs subagent lifecycle and
report shape — this is about the *brief's payload*, which `DISPATCH-TEMPLATE.md`
owns. It must not become a second copy of AGENTS.md; it embeds R1's ≤2,500-token
digest plus the unit's file scope, and states explicitly: *do not read AGENTS.md,
STATUS.md, TODO.md, or `docs/known-issues/` in full; the digest above is the
state, and cites where to look if you need more.*

**Estimated saving.** F3: 347 subagent transcripts spend **~814,000 tok** on the
nine doc sources — 63 of them on AGENTS.md alone (~185,500 tok) and 96 on
known-issues (~313,800 tok). F3a shows **78 of 355 briefs literally instruct the
subagent to go read AGENTS.md**. Mean brief today is 1,264 tokens; adding a
2,500-token digest to save a 2,900-token average AGENTS.md read and a
3,270-token average known-issues read is net positive per subagent, and strongly
positive on the ones that read both.

**Effort:** prose, once R1 exists.

---

### R4 — Make the three skills and `phase-verifier` reachable at the moment of use

**Form: a non-blocking `PreToolUse:Bash` advisory hook** —
`scripts/hooks/suggest-existing-tooling.mjs`.

Why a hook and not documentation: **it is already documented.** AGENTS.md's
"Repo automation" table names all three skills and all three subagents, and the
Definition of Done says in as many words *"Run the `minimal-check-subset`
skill's output and nothing more."* F7 measures what that bought: 9 sessions used
the skill, 45 ran full `pnpm check`, **with zero overlap** — no session ever did
both, so this is not "the skill said run everything", it is "the skill was never
consulted." F4 is starker: `phase-verifier` has existed since 2026-08-24 and has
been dispatched **zero times** in 356 `Agent` calls, while 203 dispatches went to
generic `general-purpose`.

Why not a new skill: a fourth skill nobody invokes helps nobody. The problem is
*reach*, not *content* — the skills themselves are fine.

**Interface**

```
name     scripts/hooks/suggest-existing-tooling.mjs   (PreToolUse, matcher: Bash)
trigger  command matches one of:
           /pnpm\s+(-w\s+)?(run\s+)?check(\s|$)/      -> "minimal-check-subset decides the subset (AGENTS.md, Tier 2). Tier 3 only."
           /gh\s+run\s+view|gh\s+run\s+list.*--log/   -> "ci-triage fetches --log-failed instead of the whole run."
           /git\s+worktree\s+list/                    -> "worktree-hygiene audits staleness and scope drift."
           /gh\s+pr\s+checks(?!.*--watch)/            -> "bare gh pr checks is a poll; use --watch --fail-fast (AGENTS.md L323)."
behaviour advisory only — never deny, never block. Emits one line to stderr,
         at most once per pattern per session (state under .git/ or /tmp).
```

A parallel line in the digest (R1) should read
`VERIFY: dispatch phase-verifier — it drives the PR's Vercel preview, so the
browser walk works with no local infra.`

**Estimated saving.** F7's three manual paths total **~173,700 tok** of output
that the scoped alternatives would have narrowed. F5 is larger and less direct:
124 screenshots (~174,000 image tokens) sit in 16 main-session contexts that
`phase-verifier` exists to absorb — and image tokens at the top of a context are
re-read by every subsequent turn. F10's residual 67 bare polls are caught by the
same hook for free.

**Effort:** ~60 lines, matching the shape of `check-destructive-git.mjs`. The
repo already has five `PreToolUse`/`PostToolUse` hooks, so the pattern and its
test harness (`scripts/hooks/__tests__/`) exist.

---

### R5 — `scripts/hooks/no-redundant-read.mjs`

**Form: a `PreToolUse:Read` hook.**

Deny (or warn on) a `Read` of a path already read in this session when the file's
mtime has not changed since. The mtime check is what keeps it safe: a file
rewritten by a subagent, a `git checkout`, or an external editor still reads
cleanly. The deny message should say *"already read at turn N; scroll back"*.

**Must not duplicate:** `subagent-file-scope.mjs` is `PreToolUse` on `Edit|Write`
and enforces the run manifest's write scope. This is `Read`, session-local, and
has nothing to do with the manifest.

**Estimated saving.** F6, strict: **186 reads across 89 sessions, ~331,400 tok**
— reads with no intervening edit at all. Roughly 3,700 tok per affected session.
The unfiltered figure (472 reads, ~705 k tok) is the ceiling if mtime-awareness
turns out to catch more than the edit-tracking heuristic did.

**Effort:** ~40 lines plus a test. Ranked last of the five because the saving is
diffuse (spread over 89 sessions) and there is a real false-positive tail — this
is the one recommendation that could annoy rather than help if the mtime check
is wrong.

---

## Findings that are NOT tooling

**The two documented rules that were checked both worked. Do not build anything
for them.**

- **`test:e2e:ci-like` (CLAUDE.md rule 1, landed 2026-08-26).** Before: 106 plain
  vs 11 `ci-like`. After: 18 plain vs 55 `ci-like` — from 9 % correct to 75 %
  correct. This is the strongest evidence in the corpus that a well-placed
  paragraph in `CLAUDE.md` changes behaviour, and it should be the default form
  for any future norm.
- **Verification tiers (AGENTS.md "Verification scales to the change", 2026-08-30).**
  The strict measure of prose-only branches still running checks is **8 sessions,
  21 calls, ~10 k tokens** — noise. The loose measure (162 sessions) is an
  artefact of main sessions verifying code their subagents wrote, and should not
  be quoted.

**Already documented and simply ignored — the interesting category.**

- `phase-verifier`: **0 dispatches in 356**, despite AGENTS.md's "Dispatch these
  rather than writing the prompt again". R4 addresses reach; the deeper question
  is whether the agent is *reachable at the moment verification is due*, which
  is when a PR goes ready. Worth one line in AGENTS.md's Tier 3: *"Tier 3 also
  means dispatching `phase-verifier` — the browser walk is its job, not yours."*
- `minimal-check-subset`: zero overlap with full-`pnpm check` sessions. Same
  cause.
- `/roadmap`, `/next-prompt`, `/cleanup-orphans`, `/ki-sweep`: 8, 5, 5 and 3
  user invocations respectively over two months. These are good commands. They
  are opt-in, and the opt-in never happens. R1 moves the most valuable part of
  `/roadmap` to something that fires on its own.

**Better as a line in AGENTS.md than as tooling.**

- **Secrets in shell commands** (F9a): 11 bash calls in 2 sessions carry a
  literal `pk.…` LocationIQ key, now permanently in the transcripts. One line
  under the environments guidance — *"never inline a key in a shell command;
  put it in `apps/web/.env.local`, which every lane already loads"* — plus R2,
  which removes the motive.
- **Bare `gh pr checks`** (F10): the rule exists at AGENTS.md L323 and moved
  `--watch` adoption from 5 % to 50 %. The residual is concentrated (36 of 67
  bare calls in two sessions on one day), so this is a bad-day pattern, not a
  systemic one. R4's hook catches it for free; no separate action needed.
- **Retry loops** (F13): 2.7 % bash error rate, 8 distinct repeated-failing
  commands corpus-wide. There is nothing here to fix.

---

## What I could not measure, and why

1. **Wall-clock cost.** Per-call durations are not recorded in the transcripts,
   only message timestamps. "Time wasted hand-polling `gh pr checks`" is
   therefore a token figure only, and understates the real cost.
2. **True image token cost.** Screenshot results are base64 in the JSONL; the
   `chars/4` heuristic is wrong for them by roughly an order of magnitude. F5 is
   stated in *screenshot counts* with a 1,400 tok/image assumption, which is an
   estimate, not a measurement. Every other table row excludes browser output
   entirely.
3. **Whether any session "ended badly".** Only **1** `compact_boundary` event
   exists in 426 files, and all 145 `api_error` events are network faults
   (machine asleep, ENOTFOUND, ECONNRESET, timeout). There is no measurable
   context-exhaustion population. Abandoned branches and lost handoffs cannot be
   attributed to a session from transcripts alone — that needs git/PR history
   joined to session ids, which the transcripts do not carry reliably.
4. **The effect of the 2026-08-30 known-issues split.** Post-split there are only
   66 calls in 18 sessions (vs 551 in 124 before). Mean chars per call fell from
   2,854 to 2,389, which is the right direction, but three days is not a
   measurement. Re-run the F1a query in a month.
5. **Attribution of a subagent transcript to its dispatching session.** `agent-*`
   files do not carry the parent session id in a field I could join on, so F3's
   814 k tokens cannot be split across the 72 main sessions.
6. **Whether the read of a doc was *useful*.** Every finding here measures cost,
   not value. A session that read `docs/plans/` for 330 k tokens (F1b) may have
   needed all of it. R1 is deliberately scoped to the *state* files (STATUS,
   TODO, milestones, known-issues), where the question being asked is
   "where are we" and a digest genuinely answers it — not to plans and ADRs,
   where it would not.

---

## Unevidenced hunches (thin evidence — do not act without more)

- **`docs/plans/` is the second-largest doc sink** (381 calls, 64 sessions,
  ~330 k tok) and nothing in the repo indexes it. A `docs/plans/README.md` with
  one line per plan and its status might cut re-reads of superseded plans. No
  evidence was gathered on how many of those reads hit an obsolete plan.
- **`Bash` file reading is displacing `Read`.** 1,359 `sed -n` calls (4.8 M
  chars) and 103 `cat -n` calls (692 k chars) suggest a lot of file inspection
  happens through the shell, where the harness cannot dedupe it. F6's separate
  measurement — 130 bash `cat`/`sed` calls on a file already `Read` in the same
  session, ~56 k tok — is the only hard number, and it is small. R5's hook would
  not see these at all.
- **203 of 355 dispatches use `general-purpose`.** This *might* mean the three
  repo subagents are too narrowly scoped for most work. Or it might just be F4's
  reach problem. Nothing measured distinguishes the two.
- **Median main-session peak context is 208 k tokens** and p90 is 503 k. That
  feels high for the size of the changes being made, but there is no baseline to
  compare against and no measured link between peak context and outcome quality.
