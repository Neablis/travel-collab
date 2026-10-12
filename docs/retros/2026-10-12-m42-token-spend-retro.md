# M42 retro: where the tokens went, and what to change before M43

**Written 2026-10-12, after M42 closed** (part 0 merged as PR 404, `9625ac7`). Mitchell asked for it:
*"I felt like we had a very large usage (token) expense compared to past features of the same size
… I would like to look more into how we spent tokens this build."*

This file is written to be **the only context a fresh session needs** to make the fixes in
§6. Every number below was measured. §2 says how, and for what can't be measured again, it says why.
The milestone's own retro (scope, review, CI) is at the end of
`docs/milestones/M42-the-front-door-shows-more.md`. This file covers cost and the process behind it.

## 1. The answer, in five lines

1. **Confirmed.** M42's session cost **$334**, about **2.1× M41 ($159)**, for about the same
   amount of code (9,739 vs 10,479 lines added). Per 1,000 lines added it is **$34**, against
   $11–$16 for M37, M38, M40 and M41.
2. **The new build process is not the cause by itself.** M41 was built with the same
   orchestrator, `phase-implementer` and `part-reviewer` process (introduced in PR 389 on
   2026-10-10) and cost half as much.
3. **About 90% of the cost is input: every model call re-reads its whole context.** The
   cost of a session is roughly *number of calls × size of context*. Both grew in M42.
4. **Three habits drove it:**
   - The orchestrator sat at ~400k tokens of context and was woken **190 times by GitHub events,
     141 of them for nothing** (about $57, of which $34 bought no action).
   - **Follow-up work went to builders that were already 250k–480k tokens deep** (43 follow-up
     messages; about $106 was spent after them, about $50 of it just carrying the old context).
   - Resuming an idle agent after its **5-minute cache expired** re-wrote the whole context at the
     write price (41 full rewrites, about $37).
5. **The fixes are process rules in four skills plus two bot settings** (§6). Together they should
   take a milestone like M42 back towards M41's cost. M43 is the test.

## 2. Data and method (read before trusting a number)

**Sources:**
- **Session totals and the comparison with past milestones** come from each cloud session's
  recorded usage: `mcp__claude-code-remote__list_sessions` → `external_metadata.usage`
  (`cache_read_tokens`, `cache_write_tokens`, `input_tokens`, `output_tokens`, `cost_usd`). Anyone
  with the account can re-read these.
- **Everything inside M42** (per agent, per wake, per tool) comes from this session's transcripts:
  - `~/.claude/projects/-home-user-travel-collab/<session>.jsonl` for the orchestrator;
  - `<session>/subagents/agent-*.jsonl` plus `*.meta.json` (agent type and description) for the
    40 subagents.

  **The transcripts lived only in the M42 container** and are gone once it is reclaimed. The
  numbers here are the record. The script in §8 reproduces the analysis on any later session's
  transcripts.

**How a call is counted:**
- One API call is one assistant `message.id`, deduplicated, because a streamed message is logged
  once per content block.
- Input usage (`cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`) is exact.

**Output tokens are understated in the transcripts.** The logged `output_tokens` is the
stream-start value (often 2–20). Per-agent output was therefore estimated as visible content ÷ 4,
and thinking is redacted, so it is still low. Output is under 10% of cost (§3), so the per-agent
split rests on input.

**Units and dollars:**
- *units* = `input + 1.25×cache_write + 0.1×cache_read + 5×output`, the standard ratios between
  Anthropic's prices.
- Dividing the recorded `cost_usd` by the units gives **$2.59 per million units** for M42 and
  $2.52 for M41, so the ratios hold.
- Every dollar figure for a slice of M42 is *units × $2.59*. The slices add up to about $309 of the
  recorded $334; the gap is the understated output and this analysis itself.

**Baseline caveats:**
- The M37 to M40 sessions each also did other work (scoping the next milestone, the PR 389
  process rewrite), so their costs are, if anything, slightly high.
- Lines added are the merged diffs of each milestone's PRs, excluding `docs/`, `*.generated.json`
  and `pnpm-lock.yaml`.

## 3. Comparison with earlier milestones

| Milestone | Session | Cost | Cache read | Cache write | Output | PRs | Lines +/− | $ per 1k lines added |
|---|---|---|---|---|---|---|---|---|
| **M42** | `session_014dzZ2wh4tbvwzFkpqja9yC` | **$334.17** | 937.2M | 19.40M | 2.21M | 10 | +9,739 / −2,398 | **$34** |
| M41 | `session_01GgJXTL8yQerp6fidYaYqWV` | $159.01 | 490.5M | 6.01M | 1.27M | 9 | +10,479 / −1,007 | $15 |
| M40 | `session_01MDs37ZwhvCjUjjt5qD139b` | $121.15 | 371.6M | 5.25M | 0.70M | 8 | +10,877 / −351 | $11 |
| M39 | `session_016q92EVDVepFuTmH2kkpTyK` | $166.58 | 531.1M | 5.68M | 1.31M | 13 | +5,514 / −1,325 | $30 |
| M38 | `session_01LGRoRoKYGXVmgTmiEavzrt` | $121.93 | 322.0M | 6.04M | 1.05M | 7 | +7,591 / −1,097 | $16 |
| M37 | `session_01CS2VinqC4iyWBbhA8bwtyo` | $179.14 | 398.2M | 13.56M | 1.17M | 6 | +12,993 / −1,594 | $14 |

**M42 against M41:**
- Cache reads are **1.9×**, which is calls × context.
- Cache writes are **3.2×**: more fresh agents, and more expired caches re-written.
- Output is 1.7×.

**What M42's money bought:**

| Paid for | Share of $334 |
|---|---|
| Cache reads | ~73% |
| Cache writes | ~19% |
| Output | ~8% |

## 4. Where M42's money went

### 4.1 By agent type (40 subagents plus the orchestrator, 3,923 API calls)

| Who | Agents | Calls | Typical context per call | ≈ $ | Share |
|---|---|---|---|---|---|
| `phase-implementer` (builders) | 14 | 2,230 | 175k–315k (peak 498k) | $175 | 57% |
| Orchestrator (one session, ~21 h) | 1 | 757 | **416k average, 784k peak** | $94 | 30% |
| `part-reviewer` | 19 | 798 | 35k–135k | $34 | 11% |
| `Explore` and the `general-purpose` close | 6 | 138 | 60k–110k | $5 | 2% |

### 4.2 By part (builder plus its reviewers)

| Part | PR | Theme | ≈ $ |
|---|---|---|---|
| 1 | PR 406 | thirteen tags, picker | $15 |
| 2 | PR 408 | re-tag bundles | $12 |
| 3 | PR 409 | descriptions | $16 |
| 4 | PR 410 | four tag widgets | $30 |
| 5 | PR 412 | tag pages, Discover filter and pages | $38 |
| 6 | PR 411 | demo per trip | $20 |
| 7 | PR 405 | pricing, plus Mitchell's walk changes | $21 |
| 8 | PR 407 | paid reviews | $17 |
| 9 | PR 413 | real landing, Hanoi card, card widths | $41 |
| — | — | orchestrator | $94 |

### 4.3 Per-agent detail (the costliest)

| Agent (description) | Calls | Avg context | Peak context | ≈ $ | Wall time |
|---|---|---|---|---|---|
| Build M42 part 9 real landing | 316 | 315k | 498k | $36 | 197 min |
| Build M42 part 5 tag pages | 309 | 294k | 475k | $32 | 160 min |
| Build M42 part 4 tag widgets | 278 | 247k | 397k | $24 | 180 min |
| Build M42 part 6 demo per trip | 197 | 214k | 338k | $17 | 118 min |
| Build M42 part 8 paid reviews | 211 | 207k | 317k | $14 | 52 min |
| Build M42 part 3 descriptions | 224 | 220k | 344k | $14 | 44 min |
| Part 7: Mitchell's walk changes | 147 | 177k | 291k | $11 | 72 min |
| Build M42 part 1 tags | 184 | 175k | 278k | $10 | 29 min |
| Build M42 part 2 re-tag content | 108 | 241k | 327k | $9 | 25 min |
| Review M42 part 5 PR 412 | 84 | 133k | 223k | $6 | 141 min |
| Review M42 part 4 PR 410 | 104 | 121k | 191k | $6 | 138 min |
| Review M42 part 9 PR 413 | 86 | 129k | 213k | $5 | 96 min |

A builder starts at about **25k** tokens: its system prompt, `CLAUDE.md`, and the preloaded
`build-a-part`, `write-a-test` and `minimal-check-subset`. A reviewer starts at about 19k, and the
orchestrator started at 85k.

## 5. Findings

### F1. The orchestrator paid ~$0.30 to read each GitHub event, and most needed nothing

**The orchestrator's spend, by what started each turn:**

| What woke it | Turns | ≈ $ | Share of orchestrator |
|---|---|---|---|
| GitHub or trigger notification | 190 | $57 | 66% |
| Subagent report (`SendMessage` hand-back) | 60 | $19 | 21% |
| **Mitchell** | 20 | $8 | 9% |
| Harness (hooks, compaction, restart, skill load) | 11 | $2 | 3% |
| Subagent finished | 14 | $1 | 1% |

**141 of the 190 GitHub wakes did nothing but read the notification** (no tool call beyond
`ReadNotifications` or `ToolSearch`). They cost about **$34**. The median wake cost about $0.29,
because each one re-read a ~400k context.

**The events behind those wakes:**

| Kind | From | Count |
|---|---|---|
| `issue_comment.edited` | `vercel[bot]` (the preview comment, edited on every deploy) | 69 |
| `check_suite.completed` | GitHub | 48 |
| `issue_comment.edited` | `coderabbitai[bot]` ("review skipped" / status comment) | 30 |
| `check_run.completed` | `ci-ok` | 16 |
| `subscription.created` | harness | 12 |
| `issue_comment.created` | `coderabbitai[bot]` | 10 |
| `check_run.completed` | `Vercel Preview Comments` | 10 |
| `pull_request.closed` (merges) | GitHub | 10 |
| `issue_comment.created` | `vercel[bot]` | 9 |
| `check_run.completed` | individual jobs (unit, lint, e2e, scripts, integration, CodeQL) | 17 |
| other (review comment from `github-advanced-security[bot]`, status, ready_for_review, trigger) | | 4 |

**128 of about 235 events were bot comment noise** from Vercel and CodeRabbit.

**Events per PR:**

| PR | Events |
|---|---|
| PR 405 | 48 (two walk rounds) |
| PR 404 | 29 |
| PR 410 | 29 |
| PR 413 | 28 |
| PR 407 | 25 |
| PR 408 | 17 |
| PR 412 | 16 |
| PR 406 | 15 |
| PR 409 | 15 |
| PR 411 | 12 |

**Why the orchestrator was subscribed at all.** It called `subscribe_pr_activity` itself only for
PR 404 and PR 407, and unsubscribed from PR 411 and PR 412. The other part PRs were watched
automatically, because the harness auto-subscribes a session to PRs created inside it, and the
implementers ran `gh pr create` inside the orchestrator's session. Nothing in the skills tells the
orchestrator to drop those subscriptions once the implementer has reported.

**Why each wake was expensive.** The orchestrator's context averaged **416k** and peaked at
**784k**, with two compactions in about 21 hours. Its context filled with:

| Content | Tokens | Share |
|---|---|---|
| Harness attachments and reminders | ~513k | 40% |
| Tool results | ~459k | 36% |
| — of which `ReadNotifications` | 265k | |
| — of which `get_job_logs` | 61k | |
| — of which `pull_request_read` | 54k | |
| User-side messages, mostly subagent reports | ~146k | 11% |

The skills say *"Routine notifications get no message"* (`build-a-milestone`), but reading them
silently is not free.

### F2. Follow-up work went to builders that were already deep

The orchestrator sent **43 follow-up messages** (`SendMessage`, received as *"The coordinator sent
a message while you were…"*) to existing subagents: review fixes, Mitchell's walk changes, CI
fixes. **About $106 of the $206 subagent spend came after a follow-up.** Of that, roughly **$50**
was only the cost of carrying the context already there, measured as calls after the follow-up ×
(context at the follow-up − 40k for a fresh agent with a brief) × 0.1.

| Builder | Follow-ups | Context at the first follow-up | $ after the first follow-up / total |
|---|---|---|---|
| part 5 | 3 | 323k | $20 / $31 |
| part 9 | 7 | 377k (growing to 479k) | $19 / $35 |
| part 4 | 10 | 267k (growing to 375k) | $15 / $23 |
| part 6 | 1 | 273k | $8 / $16 |
| part 8 | 5 | 243k | $8 / $14 |
| Part 7: walk changes | 7 | 178k | $6 / $10 |

**Part 9 is the clearest case.** Its review fixes, the switch to Mitchell's Hanoi playbook and the
card widths all went to the same builder, already at 377k–479k context.

**What fills a builder's context** (all 14 builders, measured as each item's tokens × the calls
that re-read it afterwards):

| Content | Share |
|---|---|
| `grep` | 21% |
| `Read` | 20% |
| `sed -n` | 16% |
| `cat` | 8% |
| **Reading code (the four above)** | **65%** |
| `Edit` / `Write` inputs | 10% |
| other tool inputs | 10% |
| `git show` / `git diff` / `git log` | 9% |
| vitest output | 3% |

A builder reads the code it needs once, then pays for it again on every later call. A follow-up
inherits all of it.

### F3. Resuming an idle agent re-writes its whole context

Subagents write the prompt cache with the **5-minute TTL** (17.65M of the 19.40M written tokens).
The orchestrator writes with the **1-hour TTL** (1.76M). After more than 5 idle minutes, the next
call re-writes the full context at 1.25× the input price.

**41 full re-writes** happened in subagents (27 in builders, 14 in reviewers). That is
**11.3M tokens, about $37**. What came just before each one:

| Before the re-write | Count | Tokens re-written |
|---|---|---|
| **A follow-up message from the orchestrator after an idle gap** | 24 | 6.48M |
| `test:e2e:ci-like` run | 3 | 1.28M |
| `tsc` / `lint` / `landing:verify` | 4 | 1.22M |
| other Bash | 6 | 1.61M |
| vitest / integration run | 3 | 0.58M |
| waiting on CI | 1 | 0.14M |

The gaps before a re-write ranged from 5.1 to 89.2 minutes, with a median of 8.5. **F2 and F3
compound:** a follow-up to an idle builder first re-writes 300k+ tokens, then carries them on
every call.

### F4. Scope grew mid-build

Scope grew in three steps:
- **At scoping:** Mitchell widened M42 with tags (decisions 5–11).
- **At his walk of part 7:** parts 8 and 9.
- **Then:** part 9 was later re-directed twice, once to his Hanoi playbook and once to whole-card
  width caps.

Parts 8 and 9, plus the part 7 art that part 9 replaced, cost about **$70**. That bought real
features, but it is part of the gap with M41.

### F5. Things that were cheap and worth it

- **Reviewers cost $34 in total**, 11% of the spend. They caught:
  - prices leaking into the landing's accessible names;
  - hidden phone claims that were still tappable and focusable (now `inert`);
  - a hydration check that could not fail;
  - the ADR-070 rule changes (`ea8d9bb`, `80e731d`) before parts 4–6 depended on them.
- **`Explore` surveys cost $3.3 for five.** A small, read-only agent with a narrow question is
  cheap.
- **The infra failures cost wall time, not tokens.** These were the Google Fonts build failure
  (KI-2026-09-27-a) and the ECR `toomanyrequests` image pull on PR 413's run 38184850349. Each
  re-run was one MCP call.
- **The usage limit (agents killed around 18:55 UTC on 2026-10-11, reset at 19:40)** cost about
  45 minutes and one `Resume M42 part 1 build` agent ($2). Nothing was lost, because each part
  pushed as it went.

## 6. What to change (the fix session's brief)

**Constraints for the fix session:**
- Work on a branch from `main` and open a PR (`main` takes no direct pushes).
- Under `.claude/**` and `docs/**` the branch is prose-only: run nothing locally; CI reports only
  `ci-ok` (CLAUDE.md rule 4).
- A change under `scripts/hooks/` is code. It needs a red-first test in
  `scripts/hooks/__tests__/` (CLAUDE.md rule 3) and puts the branch in the scoped-code tier.
- Write "PR 404", never "#404", in code and test names (rule 5).
- Mitchell merges.

### Fix 1: the orchestrator stops listening to part PRs (F1; ~$35–55 per milestone)

**Where:** `.claude/skills/build-a-milestone/SKILL.md` (*Your own rules*),
`.claude/skills/review-a-part/SKILL.md`, and `docs/guidelines/building-a-milestone.md`
(*Standing rules*).

**Rule:**
- When a part's implementer reports its push and PR, the orchestrator calls
  `unsubscribe_pr_activity` for that part's PR.
- CI results then come from the implementer's report or from `review-a-part`'s re-check.
- One safety-net check-in per open part (`send_later`) re-reads the PR's checks and mergeability.
  If that is not wanted, the orchestrator re-reads all open part PRs in one pass whenever any
  report arrives.
- The orchestrator stays subscribed only to part 0.
- Re-subscribe to a part PR only while waiting on Mitchell to merge it, to catch
  `pull_request.closed`. Or let the check-in catch the merge instead.

**Also cut the bot noise at its source** (it hits every session watching any PR):
- **CodeRabbit:** set `reviews.review_status: false` in `.coderabbit.yaml` (currently
  `review_status: true`, line 43). CodeRabbit then stops posting and editing the "review skipped"
  status comment. Check the option against CodeRabbit's configuration reference first, since the
  file notes the repo is below CodeRabbit's auto-review threshold.
- **Vercel:** in `apps/web/vercel.json`, either turn the preview comment off (`"github":
  { "silent": true }`) or leave it on and accept the 69 + 9 events. Mitchell's call: he uses the
  preview comment's link for walks. Check the current key name in Vercel's docs, because
  `github.silent` may have been superseded.

**How to check it worked:** in the next milestone, GitHub wakes per merged part fall from about
21 (190 ÷ 9) to 3–5.

### Fix 2: a fresh agent for every follow-up (F2 and F3; ~$50–70 per milestone)

**Where:**
- `.claude/skills/build-a-milestone/SKILL.md` (*Your own rules*);
- `.claude/skills/review-a-part/SKILL.md` steps 1 and 5;
- `.claude/skills/build-a-part/SKILL.md`'s last paragraph (*"A fix after review is the same loop
  on the same branch…"*);
- `.claude/agents/phase-implementer.md` (*Before you write anything*, step 3 already allows *"the
  part's existing branch for a fix"*).

**Rule:**
- Once a builder has reported its push, it is finished. Review fixes, CI fixes and Mitchell's walk
  changes go to a **new** `phase-implementer` with a brief that holds:
  - the part's branch and current head sha;
  - the findings or asks, verbatim, each with file:line;
  - the files to touch;
  - the red-first expectation;
  - what done means.
- Re-reviews are likewise a new `part-reviewer` with *"the fixes the last review asked for"* as the
  brief. `review-a-part` step 1 already says to list them.
- `SendMessage` to an existing agent is only for an answer it is blocked on while still running,
  within 5 minutes of its last call.

**Guard (optional, code):**
- a hook or a line in the orchestrator's checklist that flags `SendMessage` to an agent whose last
  activity is more than 5 minutes old;
- or make the `phase-implementer` report state *"context at finish: Nk"*, so the orchestrator can
  see that a follow-up would start deep.

**How to check it worked:**
- no builder's average context above ~250k;
- the costliest builder under ~$20, against $36 for part 9 now;
- subagent cache re-writes after a coordinator message fall from 24 to near 0.

### Fix 3: keep the orchestrator's context small (F1; compounds with Fix 1)

**Where:** `.claude/skills/build-a-milestone/SKILL.md` and
`.claude/skills/close-a-milestone/SKILL.md`.

**Rule:**
- **Clear routine reads from the orchestrator's context:**
  - read CI with `pull_request_read get_check_runs` (one call) rather than job logs;
  - send failing logs to a `ci-triage` subagent, never `get_job_logs` in the orchestrator;
  - ask subagents for short reports (the `phase-implementer` format is already short; keep the
    part-reviewer's posted comment out of the orchestrator's own context by having the reviewer
    hand back a summary under ~1k tokens).
- **Start the gate close in a fresh session** once every part is merged, seeded by the
  `next-prompt` skill. M42's close ran in a context of ~400k and could have started at about 85k.

**How to check it worked:** the orchestrator's average context stays under ~200k and its share of
the milestone falls from 30% to under 15%.

### Fix 4: plans name the files each part touches (F2; hard to size)

**Where:** `.claude/skills/plan-a-milestone/SKILL.md` step 4 (*"the plan in `docs/plans/` (per
part: its theme, files, and what to click on its preview)"*). Files are already asked for. Enforce
it, and add the entry points: the function or component and its test file. That lets a builder
open a short list instead of `grep`-ing the repo (reading was 65% of what builders carried). One
`Explore` survey per milestone at planning time ($0.20–$0.50 each in M42) can produce the list.

**How to check it worked:** a builder's first follow-up-free run stays under ~200 calls.

### Not worth changing

- **The reviewer after every push** ($34 across 19 reviews) paid for itself; see F5.
- **Local `test:e2e:ci-like` for the part's own spec** caused only 3 of the 41 re-writes. Keep it:
  CLAUDE.md rule 1 relies on it.

## 7. The rest of the M42 retro, with its facts

The full non-cost retro is in `docs/milestones/M42-the-front-door-shows-more.md` (*Retro*).

**In brief, what went well:**
- Nine parts plus part 0 merged between 17:00 UTC on 2026-10-11 and 00:57 UTC on 2026-10-12, with
  no stack to rebase.
- Red-first testing caught a vacuous e2e check (`api.unsplash.com`, PR 413) and a too-narrow
  `UNBUILT_SOCIAL` regex.
- Every review was posted on its PR (`review-a-part` step 4, `b935edc`).

**What could be better:**
- **Card width was misread once.** It was built as the inner panels in `ee8aa70` and corrected to
  the whole card in `97c4d9e`. Repeat a layout instruction back as the element it names.
- **Part 7's art was replaced by part 9 within hours.**
- **Leftovers with no home yet:**
  - the pricing section is 1140px wide against the 978px feature grid;
  - the notebook trip strip truncates "Osaka";
  - the `DRIFT.md` entry still waits on Mitchell;
  - a stale "D20" citation in `LandingHeroPanels`;
  - ¥ prices in the hero's fallback drawings;
  - an empty city-chip row on the compact card;
  - `tagMetadata`'s noindex has no direct test;
  - no known-issue entry for the ECR `toomanyrequests` pull.
- **The seeded "4.7 · 23 reviews" on the landing's Hanoi card is invented** (Mitchell's call, see
  M42 D3 part 9). Replace it when the day has real reviews.

## 8. Reproducing the measurement on a later milestone

Run this at the end of the next milestone's session, before the container is reclaimed. Put it in
the scratchpad, not the repo. It prints the per-type table of §4.1 in units; multiply by the
session's `cost_usd` ÷ total units for dollars.

```python
import json, glob, os, collections
S = os.path.expanduser('~/.claude/projects/-home-user-travel-collab/<session-id>')
def calls(path):
    seen = {}
    for line in open(path):
        d = json.loads(line); m = d.get('message')
        if isinstance(m, dict) and m.get('role') == 'assistant' and 'usage' in m:
            seen[m['id']] = m['usage']           # one entry per streamed block; keep one per id
    return seen.values()
def units(u):
    return (u.get('input_tokens', 0) + 1.25 * u.get('cache_creation_input_tokens', 0)
            + 0.1 * u.get('cache_read_input_tokens', 0))   # output excluded: understated in transcripts
by = collections.Counter(); n = collections.Counter(); ctx = collections.defaultdict(list)
for p in [S + '.jsonl'] + glob.glob(S + '/subagents/*.jsonl'):
    meta = p.replace('.jsonl', '.meta.json')
    kind = json.load(open(meta))['agentType'] if os.path.exists(meta) else 'orchestrator'
    for u in calls(p):
        by[kind] += units(u); n[kind] += 1
        ctx[kind].append(u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
                         + u.get('cache_read_input_tokens', 0))
for k in by:
    print(f"{k:20} calls {n[k]:5}  avg ctx {sum(ctx[k]) / len(ctx[k]) / 1e3:5.0f}k  units {by[k] / 1e6:6.2f}M")
```

Targets for M43, if the fixes land:
- under **$20 per 1k lines added**;
- the orchestrator **under 15%** of the spend;
- **no builder averaging over 250k** context;
- **GitHub wakes per merged part under 5**.
