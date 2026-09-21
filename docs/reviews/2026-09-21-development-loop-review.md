# Development loop review — why a feature costs more than it did three weeks ago

**Date:** 2026-09-21
**Asked by Mitchell:** *"it's taking longer and longer and more and more tokens
to build any features… we are spending too much time running tests on every PR
and going back and forth polling github for comments and build functionality."*
**Scope:** the agent files, the known issues about building, the folder
structure, and the placement of the upcoming architecture-map work.
**Nature:** read-only analysis, plus one committed measurement script
(`scripts/session-metrics.mjs`). No product code changed.

Its parent is `docs/reviews/2026-09-02-session-tooling-review.md`, which
measured the same question against 426 session transcripts. Two of that
review's five recommendations shipped. This one re-measures what can be
re-measured from a cloud container, states plainly what cannot, and ranks what
to do next.

---

## Three measurements that reframe the problem

### 1. The orientation surface doubled in nineteen days

The 2026-09-02 review measured the "where are we" surface at 315,687 bytes
(~79,000 tokens) and found **1.9M tokens of re-reads across 220 sessions**
against it. Measured again today:

| File | 2026-09-02 | 2026-09-21 | change |
|---|---:|---:|---:|
| `TODO.md` | 50,506 | 107,642 | **+113%** |
| `docs/milestones/README.md` | 49,340 | 104,498 | **+112%** |
| `docs/known-issues/open/` | 142,197 (42 files) | 320,154 (**79 files**) | **+125%** |
| `docs/STATUS.md` | 46,428 | 63,557 | +37% |
| `AGENTS.md` | 27,216 | 36,012 | +32% |
| `CLAUDE.md` | 2,095 | 3,639 | +74% |
| **total** | **315,687 (~79k tok)** | **635,502 (~159k tok)** | **+101%** |

The parent review also measured the cache re-read multiplier at **51.3×** —
every token at the top of a session's context is re-read ~51 times before that
session ends. A doubled first-read surface is therefore not a 79k-token
regression; it is 79k tokens multiplied by however many turns the session runs.

This is the best single explanation for "more tokens to build any feature", and
it is the one nobody was watching, because `pnpm state` (R1) succeeded at
capping what a session *is shown* and nothing caps what the underlying files
*weigh*.

### 2. CI minutes stopped being the constraint on 2026-08-31, and nothing downstream was updated

`docs/guidelines/ci-cost-and-capacity.md` records that Mitchell made the repo
public to get free runs. Confirmed against the API today: `visibility: public`,
0 stars, 0 forks. Public repositories get unlimited GitHub-hosted standard
runner minutes, so the 2,000-minute budget that `ci.yml`'s header, `AGENTS.md`'s
draft rule, and the three-tier Definition of Done are all argued from **no
longer exists**.

Two consequences, and the second is the live one:

- Every agent that touches those files reads several thousand tokens of
  obsolete budget reasoning.
- **Going public armed the required-status-check trap** that the guideline
  itself warns about: once branch protection is enabled, a `paths-ignore`'d
  check that never runs blocks the merge *forever*. The guideline's own
  instruction — convert the filters to a skip-job pattern **before** enabling
  required checks, not after — is unactioned.

The tiers should survive this, but for a different and better reason: they save
**agent wall-clock and tokens**, not minutes. If the stated reason stays wrong,
the rule gets relitigated by the next session that notices minutes are free.

### 3. The feedback loop is running on CI instead of locally

Measured over the last five days (2026-09-15 → 2026-09-20), 100 `ci.yml` runs
across 15 branches:

| | |
|---|---|
| runs per branch | mean **6.7** |
| run wall clock | median **6.6 min**, p90 7.2 min |
| conclusions | 71 success, 14 **cancelled**, 10 failure, 5 skipped |

The outlier carries the finding. `claude/beautiful-feynman-b86spm` (PR #196,
M26 design parity) took **41 runs, 8 failures and 7 cancellations across 15
hours**, at a cadence of one run every 8–15 minutes. Its **first run fired three
seconds after the PR was opened** — so the PR was opened ready, not draft — and
the job that failed was `pnpm --filter web test:int`.

Measured in this container, on this branch: `pnpm typecheck` **42s**,
`pnpm lint` **65s**, and `apps/web/scripts/db-probe.mjs` answers on
`localhost:5433`, so the integration lane runs locally. **That first failure was
catchable in about seventy seconds** and instead cost a 6.6-minute round trip
plus the tokens to read the failure log.

This is `KI-2026-09-07-d` — *"the verification loop ran on CI instead of
locally: nine pushes, a regression the local lane could have caught"* —
recurring at four times the scale, three weeks after it was filed.

#### Draft adherence, measured

| | branches | mean CI runs each |
|---|---:|---:|
| opened as **draft** (first run `skipped`) | 4 of 15 | **2.25** |
| opened **ready** | 11 of 15 | **8.3** |

**Caveat, stated rather than buried:** the four drafts were small PRs and the
eleven include the large milestone branches, so size confounds that 3.7× ratio
and it should not be quoted as a causal effect. The unconfounded evidence is
PR #196 itself — a run three seconds after opening, failing on a lane that runs
locally in seventy seconds.

`AGENTS.md`'s rule — *"open that PR as a draft, and mark it ready only when you
believe it is green"* — is followed on 4 of 15 branches. It is another instance
of the parent review's most interesting category: **documented and ignored.**

---

## What could not be measured here, and why

**F1, F2, F3/F3a and F7 could not be re-run in this session** — and the reason
is worse than "wrong machine", which is how the first version of this section
framed it.

Claude Code writes session transcripts to `~/.claude/projects/<mangled-cwd>/*.jsonl`
**on the machine that ran the session**. This was a Claude Code on the web
session: the container is cloned fresh and holds **exactly one transcript — its
own** (verified: 1 file, 1.1 MB, 0 `agent-*` files), and
`docs/guidelines/cloud-agent-sessions.md` records that the container is
reclaimed after inactivity.

**Corrected 2026-09-21, after Mitchell said he does much of his work in cloud
containers.** Two consequences the first draft of this review got wrong:

- **The parent review measured LOCAL SESSIONS ONLY.** Its corpus was 35
  directories named `-Users-…-travel-collab` plus 33 `--claude-worktrees-*` —
  all macOS paths. Its headline figures (F1's 1.9M tokens, the 51.3×
  multiplier, F3's 814k, F7's zero overlap) therefore describe the local slice,
  in a window that partly predates the shift. `cloud-agent-sessions.md` — added
  **2026-09-08, six days after that review** — opens with *"Most agent work on
  this repo now happens in a Claude Code remote session."*
- **So "run it on the Mac" is not the fix, and this review originally said it
  was.** For the majority of recent sessions the transcript was destroyed with
  its container; there is no corpus on disk to run anything against. Running
  `pnpm session-metrics` on the Mac yields a shrinking minority slice, and
  calling that a baseline would repeat the parent review's sampling bias while
  believing it had been corrected.

**What actually closes it: capture inside the container, before it dies.** A
`Stop` hook (the repo already has one — `run-teardown-reminder.mjs`) runs the
aggregation over the session's own transcript and appends one record to a
durable sink. Constraints worth stating before it is built:

- **Aggregates only, never content.** Transcripts contain everything. The
  record carries counts and token sums — no prompt text, no file contents, no
  arguments. `computeFindings()` is already shaped this way.
- **One file per session id**, so concurrent sessions cannot conflict.
- **An orphan `session-metrics` branch** is the cheapest durable sink that adds
  no service and never pollutes a PR diff.
- **Fail open.** A metrics hook that can fail a session start is worse than no
  metrics, which is the standing rule for every hook in `scripts/hooks/`.

Until that exists, `pnpm session-metrics` on the Mac is still worth running —
as **the local slice, labelled as such**, not as the baseline.

```
pnpm session-metrics                      # local corpus only
pnpm session-metrics --since 2026-09-02   # only since the parent review
pnpm session-metrics --json               # for diffing runs
```

The script reproduces the parent review's method, prints the 2026-09-02 figure
beside each finding, and **refuses to be mistaken for a baseline** when it
finds fewer than five transcripts.

### What this correction does NOT change

Separated deliberately, because it is most of this review. Everything measured
from the **GitHub Actions API** (runs per branch, run duration, PR #196's 41
runs, draft adherence) and everything measured from **the repository itself**
(the doubled doc surface, the public-repo finding, the armed required-check
trap) is container-independent and stands as written.

### What it re-weights

- **A2 and B1 get MORE important.** A cloud container starts cold every time —
  no warm context, no resumed session, no accumulated knowledge of the code.
  Every session pays full bootstrap, and a 51.3× multiplier measured where
  sessions can resume probably *understates* the cloud cost. B1 is precisely
  the artifact that substitutes for what an ephemeral container throws away.
- **A1's stamp must record WHICH SUBSET RAN, not merely that it ran.** In a
  cloud container the local lane is conditionally available, and four open
  entries say so: `KI-2026-09-08-b` (`pnpm --filter` aborts on a pnpm-major
  skew), `KI-2026-09-12-b` (agent worktrees get no `node_modules`),
  `KI-2026-09-02-a` (Node 26 breaks the unit lane), `KI-49` (the egress proxy
  blocks the map tile host, so that e2e cannot be walked here at all). A stamp
  recording only success would go green on a session whose lane aborted.
- **C2 is elevated.** Some e2e genuinely cannot run in-container (KI-49), which
  makes `phase-verifier` driving the PR's Vercel preview the cloud-native
  verification path — and its 0 dispatches in 356 a larger problem than scored.

### Two items this correction ADDS

- **A4 — event-driven PR waking, replacing the blocking watch.** `AGENTS.md:411`
  prescribes `gh pr checks <n> --watch --fail-fast`, which blocks the session
  for a median 6.6 minutes. In a cloud session the harness can subscribe to PR
  activity and **wake** the session when CI finishes or a review lands.
  `subscribe_pr_activity`, `external-event` and `wake reason` appear **nowhere**
  in `AGENTS.md`, `CLAUDE.md`, `docs/guidelines/` or `.claude/`. This is a
  direct answer to the "polling github" half of the original ask, it is
  available today, and it pairs with A3 rather than replacing it: subscribe for
  the wake, one command for the inbox.
  **Reliability HIGH** (strictly fewer missed events than polling);
  **efficiency HIGH** (removes the blocking wait entirely);
  **measurability HIGH** (count blocking `gh pr checks` calls per PR).
- **A5 — a SessionStart lane probe.** `pnpm state` already runs every session.
  It should also print, in one line, which verification lanes *this* container
  has: `pnpm --filter` usable, DB answering, Playwright linked, egress
  reachable. Today a session discovers a broken lane mid-task and, per the four
  KIs above, sometimes misdiagnoses it as a code failure. It is cheap, and it
  is what makes A1's stamp trustworthy.
  **Reliability HIGH**, **efficiency MEDIUM**, **measurability MEDIUM**
  (count sessions that hand-roll an environment fix after start).

**One honest datapoint from the corpus of one.** This analysis session spent
**18,674 tokens** on orientation inside its first 20 tool calls, against the
2026-09-02 mean of 7,760 — 2.4×, in the direction the surface doubling
predicts. It is n=1 and it is an analysis session rather than a feature
session, so it corroborates nothing on its own. It is recorded because it is
consistent with finding 1, not as evidence for it.

---

## Improvements, ranked

Each is scored on the three axes Mitchell asked for: **reliability** (does the
work stay good), **efficiency** (tokens and speed), **measurability** (can we
prove it helped).

### Tier A — strong on all three

#### A1. Make draft-open and the pre-ready gate mechanical rather than remembered

A `PreToolUse` Bash hook that injects `--draft` into `gh pr create` unless
explicitly overridden, plus a `gh pr ready` guard that refuses unless a Tier-3
stamp exists for the current SHA — where `pnpm check` writes `.git/tier3-<sha>`
on success. Five hooks of this shape already exist in `scripts/hooks/`.

- **Reliability: HIGH.** It skips no check; it moves the check earlier. The
  failure mode is an agent bypassing the stamp, which stamp-on-success makes
  awkward rather than impossible.
- **Efficiency: HIGH.** ~6 CI runs per branch at 6.6 min each, plus the tokens
  spent reading each failure log.
- **Measurability: HIGHEST on this list.** Runs-per-branch and first-run
  conclusion are one Actions API query. **Baseline set today: 6.7 runs/branch,
  73% of branches opened ready.** Re-measure in two weeks.

#### A2. Extend STATUS.md's archive discipline to `TODO.md` and `milestones/README.md`, behind a wall

`docs/STATUS.md` has been cut twice and carries the rule in its own header
(*"if this file is over ~300 lines again, that is the signal"* — it is at 969).
Nothing applies that rule to the two files that grew 112% each. Narrative for a
closed milestone belongs in that milestone's file at gate close; the roadmap
files keep the pointer. Then add a ninth wall to `pnpm lint` (there are eight)
that fails when any first-read file exceeds a byte budget.

- **Reliability: HIGH for the wall** (mechanical, fires only on growth).
  **MEDIUM for the archiving** — deciding what is still live is judgement, and
  `STATUS.md` records that **the stale section is the defect and length only the
  symptom**. Archiving the wrong paragraph is worse than a long file.
- **Efficiency: HIGHEST.** This is the one that compounds at 51.3×.
- **Measurability: HIGH.** Byte counts are trivial; `pnpm session-metrics`
  gives the token half.

#### A3. One command that returns the whole review inbox

`docs/guidelines/working-a-review.md` documents four surfaces with four
different mechanics — Copilot threads never self-resolve; CodeRabbit's inline
threads do not either in this repo, because auto-review is star-gated; its
walkthrough lives outside the diff and is stamped with a stale SHA; Vercel
toolbar threads are not GitHub threads at all and gate a check. All four are
walked by hand, every round, from prose. That is the "polling github for
comments" cost, and it is structural.

Build `pnpm review <pr>`: fetch all four, dedupe against already-resolved,
print one table (surface / thread id / `file:line` / one-line ask / resolved?),
and bake in the `--watch` ordering trap (confirm a run exists for HEAD first).

- **Reliability: HIGH.** Strictly more complete than the manual pass, which
  measurably misses things: 13 fixed-in-code threads left open on PR #141, 14
  on PR #170.
- **Efficiency: HIGH.** Replaces N polls plus four hand-walks with one call.
- **Measurability: MEDIUM-HIGH.** Count `pull_request_read` / `gh pr view` calls
  per PR before and after; and track threads still open at merge — that is the
  quality metric, not just the cost one, and it is queryable.

### Tier B — high value, more judgement

#### B1. Ship the architecture map — but cut it to Job 1, and make it fire without being asked

`docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md` is a good
spec: six signals each verified machine-readable, three structural drift
conditions, a node cap, and it correctly refuses to claim the map enforces DRY.

**The objection is the delivery mechanism, not the design.** The spec puts
Job 1 ("I am about to change X, what should I know") behind a skill, names F7
as the risk, and then relies on *"Job 1 being cheaper than the habit it
replaces."* The repo's own data says that is not sufficient:
`minimal-check-subset` was used in 9 sessions against 45 running full
`pnpm check`, **zero overlap**; `phase-verifier` was dispatched **0 times in
356**. Opt-in does not happen here. The two interventions that demonstrably
worked were a `SessionStart` hook (`pnpm state`) and a paragraph in `CLAUDE.md`
(rule 1 moved `ci-like` adoption from 9% to 75%).

So: make Job 1 `pnpm map --for <path>`, printing the nodes touched, their
*"explicitly does NOT know about"* column, bound open KIs, governing ADRs and
the specific invariants at risk — then wire it into the digest's `NEXT READ`
line and into every subagent brief. **Cut the annotation layer from v1**; it
depends on a gate-close checklist step being remembered, and that checklist has
already grown once for exactly this reason.

- **Reliability: HIGH for the mechanical layer.** All three drift conditions are
  "a real thing exists and the map does not know about it" — none fires on
  formatting, ordering or wording. **MEDIUM for annotation**, which is why it
  should wait.
- **Efficiency: POTENTIALLY THE LARGEST, AND UNPROVEN.** It aims at F1's 1.9M
  tokens, but nothing yet measures how much of that a map actually replaces.
- **Measurability: MEDIUM — and this is the item that most needs a baseline
  BEFORE it is built.** Count code-file reads in the first 20 tool calls of
  implementation sessions, via `pnpm session-metrics`. Set it now; it cannot be
  reconstructed later.

#### B2. Correct the CI-budget premise and defuse the required-check trap

Rewrite the budget reasoning in `ci.yml`, `AGENTS.md` and
`ci-cost-and-capacity.md` to argue the tiers from agent wall-clock and tokens,
which is both true and a stronger argument. Then convert `paths-ignore` to a
skip-job pattern before branch protection is ever enabled.

- **Reliability: HIGH** (a correction, not a loosening).
  **Efficiency: LOW directly, HIGH indirectly** — it stops a false premise
  driving decisions. **Measurability: LOW — do not try to measure it.**

#### B3. Land R3 and R4 from the parent review; skip R5

R1 (state digest) and R2 (`pnpm setup` in the local hook branch) shipped and
work. Verified today: `.claude/protocol/DISPATCH-TEMPLATE.md` mentions neither
the digest nor `AGENTS.md`; there is no `scripts/hooks/suggest-existing-tooling.mjs`;
there is no `scripts/hooks/no-redundant-read.mjs`.

**R3 is the one that matters now**, because implementation has moved into
subagents: F3 measured ~814,000 tokens of subagent orientation, and F3a found
**78 of 355 briefs literally instruct the subagent to read `AGENTS.md`** — now
36 KB. Carry the digest in the brief; tell the subagent not to read the state
files.

- **Reliability: HIGH** for R3 and R4 (R4 is advisory and never blocks).
- **Efficiency: HIGH for R3.**
- **Measurability: HIGH** — `pnpm session-metrics` reports F3 and F3a directly.
- **Skip R5** (the redundant-read hook). The parent review ranked it last, flagged
  a real false-positive tail, and this repo's standing rule is *"if a hook
  misfires twice, delete it rather than tuning it."*

### Tier C — worth doing, smaller or less certain

- **C1. The KI backlog is now a first-read surface in its own right.** 42 → 79
  open in nineteen days (~2/day net accrual), 216 entries, 320 KB — roughly
  equal to `TODO.md` + `milestones/README.md` + `STATUS.md` + `AGENTS.md`
  combined. `CLAUDE.md` rule 2 tells every session to grep it, which is right,
  but a set growing at this rate stops being greppable. Either run `/ki-sweep`
  on a cadence with a net-zero-accrual-per-milestone target, or split `open/`
  into blocking vs accepted so the grep surface stays small. The map's
  Decision 3 (KIs bound to nodes, derived from the existing `Area:` line) is the
  structural fix — another reason for B1. **Measurability: HIGH**, the count is
  already in `pnpm state`.
- **C2. Re-check `phase-verifier` adoption.** F4 measured 0 dispatches in 356.
  The digest's `VERIFY:` line may have fixed it. `pnpm session-metrics` prints
  the F4 mix. If it is still ~0, the subagent is not the answer and the browser
  walk belongs inside A1's Tier-3 stamp.
- **C3. 14% of runs are cancelled** — pushes landing on in-flight runs, i.e. not
  waiting for one's own signal. Largely absorbed by A1.

---

## What NOT to do

- **Do not loosen the suite or the walls.** The failures CI is catching are real
  (`test:int`, e2e). The defect is *where* they are caught, not *that* they are.
- **Do not add a fourth skill and hope.** F7 is unambiguous: the problem is
  reach, not content.
- **Do not build the map's annotation layer in v1.** It depends on a checklist
  step being remembered.
- **Do not build R5.**

---

## Sequencing

**Revised 2026-09-21 for cloud-primary work.**

1. **A4 and A5 first.** Both are small, both are cloud-native, and A4 answers
   half the original complaint ("polling github") on its own.
2. **The durable metrics sink** — the `Stop`-hook capture described above.
   Under cloud-primary work this is the ONLY way a baseline ever exists; it is
   no longer a one-off command on a laptop. Run `pnpm session-metrics` on the
   Mac meanwhile for the local slice, labelled as the local slice.
3. **A1 and A2** — independent and cheap (two hooks; one wall plus an archiving
   pass), both measurable within two weeks from the Actions API, which needs no
   transcripts at all.
4. **B3 (R3 first)**, riding on the digest that already exists.
5. **B1**, once the sink has produced a baseline — the biggest build, the least
   proven, and the one that most needs a before-number.

---

## Verification actually performed

- **Tier 2** (`docs/guidelines` + `scripts/` + root `package.json`; this branch
  carries code, so it is not Tier 1).
- `node --test scripts/__tests__/session-metrics.test.mjs` — 11 pass, 0 fail.
- **Red-first, per `CLAUDE.md` rule 3.** Three mutations of
  `scripts/session-metrics.mjs`, each restored after:
  - *Drop the requestId guard AND accumulate usage* → `not ok 4 … expected:
    1000, actual: 3000` (the streamed response counted three times).
  - *Stop excluding browser output from char totals* → `not ok 7 … expected:
    400, actual: 100400` (a base64 screenshot reaching a chars/4 total).
  - *Reorder `DOC_SOURCES` so a broad `docs/` pattern wins* → `not ok 1` and
    `not ok 2 … expected: 'known-issues', actual: 'specs'`.
  - **A fourth mutation stayed green and is recorded because it changed the
    source.** Removing the `!usageByRequest.has()` guard *alone* left all 11
    tests passing: keying a `Map` by requestId is what actually dedupes, and the
    guard only skips a redundant write. Per `working-a-review.md` — *"a green
    mutation is usually a bad mutation"* — the aim was corrected rather than the
    test weakened, and the script's comment now says which line does the work.
- `pnpm typecheck` (42s) and `pnpm lint` (65s) pass on this branch.
- **Not run, and why:** `pnpm test` in full, `test:int`, e2e and the browser
  walk — this branch adds one Node script, its test, one `package.json` script
  entry and prose. It touches no product code, no route, no schema and no user
  flow, so there is no flow to walk and nothing for the integration or e2e lanes
  to cover. `scripts/__tests__/**` is inside root `pnpm test`, so CI runs this
  test regardless.
- **One incidental robustness gap, recorded here rather than filed**, because it
  is small and inflating a 79-entry backlog is the opposite of C1's advice.
  `scripts/check-lint-wall.mjs` writes its fixtures into the real tree
  (`lintFixture()`, line ~32) and removes them afterwards. Interrupt it — this
  session did, with a `timeout 45` while probing which test was slow — and
  `apps/web/e2e/__test_quality_e2e_fixture__.ts` is left behind, so the **next**
  `pnpm lint` fails with two `playwright/*` errors in a file nobody wrote. That
  reads exactly like a real lint regression and is not, which is the same trap
  `KI-2026-09-08-b` records for this script's other failure mode. A `try/finally`
  or a trap on SIGTERM would close it. On this branch it was diagnosed, the stray
  file deleted, and `pnpm lint` re-run green.
- **F1/F2/F3/F7 were NOT re-run** — the corpus is not reachable from a cloud
  container. See *What could not be measured here*. This is the one part of the
  request that is outstanding, and it is one command on the right machine.
