# Kickoff — Test suite overhaul, Phases 0–4

Handoff brief for the agent executing the first half of the test suite
overhaul. Written to be readable with **zero context** from the session that
produced it.

**You are not writing a plan. The plan exists and is detailed.** Your job is to
execute it, one phase file at a time, starting at Phase 0 and **stopping after
Phase 4**.

## Where everything lives

**Repo:** `https://github.com/Neablis/travel-collab`
**Branch:** create a fresh one from current `main`.

```bash
git clone https://github.com/Neablis/travel-collab.git
cd travel-collab
git fetch origin main && git checkout -b claude/test-overhaul-p0-p4 origin/main
pnpm install
```

Do **not** branch from `claude/next-phases-work-vni3iz` (the planning branch —
it carries only these docs) or from any merged `claude/*` branch. Check
`git ls-remote --heads origin` for a sibling branch already doing this work
before you start; `AGENTS.md`'s Workstreams section explains what that check
cost the project once already.

All commands run from the **repo root** unless a task says otherwise.

### Documents

| What | Path |
| ---- | ---- |
| **The plan index** — evidence, principles, sequencing, phase order. **Read first.** | `docs/plans/2026-08-23-test-suite-overhaul.md` |
| **The inventory** — every test file, with a verdict and the evidence. Phase 0 Tasks 0.2/0.3 are already done. **Read second.** | `docs/testing-inventory.md` |
| **The phase files you execute** — 5 of 8 | `docs/plans/test-overhaul/phase-{0..4}-*.md` |
| Repo operating manual — invariants, boundaries, definition of done | `AGENTS.md` |
| Where the project's work stands | `docs/STATUS.md` |
| Known breakage — **read KI-13, KI-19, KI-21, KI-25 before you trust any red run** | `docs/known-issues.md` |
| How to run and believe the suites | `docs/guidelines/quality-enforcement.md` |
| Stack constraints (incl. the new-dependency rule) | `docs/guidelines/stack-and-constraints.md` |

Read the index first, then **only** your current phase file.

## What you're doing

The test suite has become a drag: 864 test cases, 11,341 lines of test against
13,369 lines of source in `apps/web`, four open test-reliability known issues,
and a unit suite that spends **more time constructing jsdom worlds than running
assertions** (`environment 58.7s` vs `tests 22.5s` on a 43.1s run).

Phases 0–4 fix speed and trust **without touching component test bodies**.
Phases 5–7 (pruning, de-brittling, guidelines) are deliberately **not yours** —
they are gated on M10 Wave 2's gate closing, because M10 Phases 5–8 rewrite
eight of the components whose tests those phases would otherwise prune twice.
The index's Sequencing section has the file-by-file collision table.

| Phase | File | Tasks | Gate |
|---|---|---|---|
| 0 | `phase-0-baseline.md` | **2 left of 4** | Timings (0.1) + domain coverage floor (0.4). 0.2/0.3 are done — see `docs/testing-inventory.md` |
| 1 | `phase-1-config.md` | 5 | Unit suite measurably faster; zero test content changed |
| 2 | `phase-2-factories.md` | 6 | `@tc/factories`; four duplicate data vocabularies collapse to one |
| 3 | `phase-3-e2e.md` | 5 | **KI-19, KI-21, KI-25 closed** |
| 4 | `phase-4-ki13.md` | 4 | **KI-13 closed or honestly re-scoped** |

**Stop after Phase 4.** Do not start Phase 5. Report back.

## Decisions already made — do not relitigate

| Question | Decision | Where the reasoning lives |
|---|---|---|
| Sequencing vs M10 Wave 2 | Phases 0–4 now, 5–7 after M10's gate | index → Sequencing |
| Where factories live | `packages/factories` (`@tc/factories`), a fifth workspace package | phase-2, top block |
| Deletion authority | **No target.** Phase 5 applies criteria and reports the number. Not your phase anyway. | phase-5, top block |
| `isolate: false` | Rejected — **measured 248 failures** on this tree | phase-1 Task 1.2 |
| Coverage-percentage gate | Rejected — it is what produces the tests this plan deletes | phase-7 Task 7.1 |
| Permanent mutation-testing CI job | Rejected — Stryker is a one-off instrument for Phase 5 | phase-5 Task 5.3 |

## Things that will bite you

1. **Do not trust a single red run.** KI-13 means the unit suite can fail with
   a different random subset each run under load. `ps aux --sort=-%cpu | head`
   before believing a failure. KI-21 means two e2e specs fail intermittently
   inside `dragCardTo`. Both are *in scope* for you to fix — but while you are
   working on Phases 0–2, treat them as known noise, not as your regression.
2. **`pnpm --filter web test:e2e` runs against `pnpm dev`, not what CI runs.**
   Use `pnpm --filter web test:e2e:ci-like` before believing any e2e result.
   This is KI-27 and it produced two false signals in one session already.
3. **New dependencies need one sentence of justification in the PR**
   (`stack-and-constraints.md`, constraint 3). This plan adds several
   (fishery, `@faker-js/faker`, `@vitest/coverage-v8`, two ESLint plugins,
   StrykerJS as a one-off). All are dev-only. Write the sentences.
4. **Do not read `docs/testing-inventory.md`'s coverage tables as a delete
   list.** In 16 of 66 subsumption pairs the "subsumed" file is the cheap
   pure-function test at the *correct* layer and the subsumer is an expensive
   component test — the cut goes the other way. The inventory's Method section
   documents this and two cases where coverage alone gives the wrong answer
   outright (`formatMoney.test.ts`, `equality.test.ts` both read as 100%
   redundant and are neither). You are not executing any of it in Phases 0–4
   anyway; this matters when you report.
5. **The event store is append-only** and `packages/domain` is off-limits
   except where a phase says otherwise. Phase 2 Task 2.3 may need a rollup
   computation extracted into `packages/domain` — that is a real contract-
   adjacent change; flag it rather than duplicating the math.

## Definition of done for this handoff

- [ ] Phases 0–4 complete, each committed as its own logical change
      (conventional commits, per `AGENTS.md`).
- [ ] Unit suite `environment` time down ≥30% against the Phase 0 baseline.
- [ ] KI-19, KI-21, KI-25 moved to Resolved in `docs/known-issues.md`.
- [ ] KI-13 closed with a recorded root cause, or kept open with new evidence
      per phase-4's decision-rule table. Both are acceptable outcomes.
- [ ] `pnpm check` green 3× and full `test:e2e:ci-like` green 2×.
- [ ] `docs/testing-baseline.md` committed with before/after numbers.
- [ ] `docs/STATUS.md` updated — this is an off-roadmap insert during an open
      M10 gate and `AGENTS.md` requires it be called out. State plainly that it
      **does not** move M10's gate. Follow the pattern the 2026-08-19 feature-
      flags insert used (see STATUS.md's "Where we are").
- [ ] PR opened, **and only then** report back. Do not start Phase 5.

## What you do NOT do

- Do not start Phases 5, 6 or 7.
- Do not delete any test. Phase 0 produces verdicts; Phase 5 executes them, and
  Phase 5 is gated on M10.
- Do not rewrite component test bodies. Phase 2 changes their *imports and
  setup blocks*; that is the extent of it.
- Do not set `isolate: false`, add a coverage threshold, or add a mutation-
  testing CI job. All three were considered and rejected; see the table above.
- Do not change `AI_LIVE`'s override semantics (KI-24 is an open product
  decision). Phase 3 Task 3.5 adds an endpoint that *reports* the mode; that is
  all it does.
