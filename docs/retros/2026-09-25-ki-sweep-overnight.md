# KI sweep, overnight 2026-09-25 — triage and the decisions taken without asking

Mitchell's brief: *"Take on a larger KI cleanup over night, don't ask for
decision, document decisions, and I'll review the pr and the decisions made in
the morning."* This file is that record. Every choice made on his behalf is
listed under **Decisions to review**, with the alternative that was rejected,
so any one of them can be reversed on its own.

Starting point: `main` at `cdb3582`, **84** entries in `docs/known-issues/open/`.

## How the sweep was run

- `/ki-sweep`, with its two approval stops (step 3 plan, step 6 landing shape)
  answered by the brief rather than by asking.
- One `ki-fixer` subagent per KI, each in its own worktree, **four at a time**
  (the box has 4 cores; KI-13's history is component tests timing out under
  exactly this kind of parallel load, so the batch never exceeded the core
  count).
- Each fixer fast-forwarded its worktree to this branch's head first — agent
  worktrees are seeded from a stale local `main` (KI-2026-08-30-c), and moving
  local `main` was not permitted in this session.
- Landing: **one branch, one PR** (`/ki-sweep` step 6b), because every fix here
  is small and the point of the morning is one review pass. Each fix is its own
  commit(s) with the KI id in the subject, so any one can be reverted alone.

## Scope: every one of the 84 entries is either fixed or re-validated

Mitchell, mid-sweep: *"make sure you are taking on a pretty big chunk of the
ki … whether that means fix or validate it's no longer true."* So the sweep
has two halves:

- **Fix** (~30 entries): buckets D and B below, plus KI-3 / KI-48 item by item.
- **Validate** (the other ~54, including the milestone-owned ones): a
  first-hand check of every claim against today's code. Each ends as
  **closed** (no longer true — evidence in the entry), **narrowed** (struck in
  place), or **re-verified 2026-09-25** (still true — evidence, stale line
  numbers and counts corrected). Validation never fixes; a still-true entry
  with a small, obvious fix becomes a fixer candidate for a later wave, unless
  a milestone owns it.

## Triage

### A — owned by a milestone; not touched

The 2026-09-24 KI pass assigned these to a milestone, each with a
`Milestone:` line. Clearing them here would be doing that milestone's scope
out of order (TODO.md: M24 → M14 → M19, M9 paused).

- **M9 (paused), every open AI entry:** KI-9, KI-10, KI-15, KI-24, KI-79,
  KI-80, KI-82, KI-2026-09-05-ad, 09-08-c, 09-12-f, 09-14-b,
  09-16-a (truncated tool input), 09-17-b, 09-17-c, 09-20-a.
- **M24 (current):** KI-2026-08-30-g.
- **M14 (next):** KI-2026-09-20-g, 09-20-h, 09-22-c, 09-22-d, 09-24-d,
  09-24-h, 09-24-n, 09-24-o, 09-24-p, 09-24-q, 09-24-s.
  Two M14-carried entries **were** taken — see Decisions.

### B — touch `packages/contracts/src`; serialized after the parallel waves

Run one at a time, each followed by a full `pnpm check` (AGENTS.md invariant 5).
Listed with their outcome under *Results*.

### C — not closable by a worktree agent, or unbounded; left

| Entry | Why left |
|---|---|
| KI-2026-08-30-c, 09-12-b | Harness worktree behaviour, not repo code. |
| KI-2026-09-05-n | Dependabot triage needs GitHub Security access. |
| KI-2026-09-16-d | Vercel Preview environment config. |
| KI-2026-09-23-a | Next.js's own vendored proxy; nothing in this repo to change. |
| KI-2026-09-01, 09-07-d | Process records, not defects with an end state. |
| KI-2026-09-06-d, 09-20-d, 08-30-f | Need live web research / geocoder egress to verify content. |
| KI-2026-09-24-o | A privacy disclosure — the entry says the wording is Mitchell's. |
| KI-3, KI-48 | Area is "`apps/web/src` (various)" — conflicts with everything in flight. |
| KI-46, 09-24-i, 09-24-j | Phone/tablet layout — the entries themselves say "a milestone, not a fix". |
| KI-2026-09-20-f, 09-23-c, 09-23-b | Architecture moves across dozens of files; would conflict with every other fix and deserve their own review. |
| KI-2026-09-20-i, 09-22-a, 09-02-b, 09-05-v | Repo-wide comment/lint backlogs (hundreds of sites). |
| KI-2026-09-05-j | Event upcaster — a design, not a fix. |
| KI-2026-09-02-d | The entry's own fix path is "opportunistic, not a project"; it has no end state to close. |
| KI-52 | A recorded design delta, deliberately kept. |
| KI-2026-09-15-a, 09-16-a (refund) | Cross-module data / a new cash ledger — design work, not cleanup. |
| KI-2026-09-19-f | Mitchell chose "option A" knowing the window; option B is a contract change he did not ask for. |

### D — parallel waves (Area fields pairwise disjoint within a wave)

| Wave | Entries | File scopes |
|---|---|---|
| 1 | 08-30-d · 09-24-u · 09-16-b · 09-24-a | `scripts/` + `.claude/` · `test-support/networkGuard*` · `server/entitlements/accountPlan.ts` + `components/account/` · `server/public-api/` |

(Later waves are appended as they are dispatched.)

## Results

| Entry | Outcome | Proof |
|---|---|---|
| KI-2026-08-30-d | RESOLVED | `check-ki-filenames.mjs` now fails on an entry in two status dirs; reproduced with three copied entries (two passed the old wall, one was misreported as a shared id); two new tests seen red; 10/10 green. |

## Decisions to review

- **KI-2026-08-30-d closed, not narrowed**, though the wall cannot catch the loud form (add/add conflicts after a squashed base, 2026-09-11) — git reports that one itself, and `/ki-sweep` 6b now points at the recovery recipe. Rejected: keeping it open for that form.
- **KI-2026-08-30-d: extended `check-ki-filenames.mjs`** instead of adding a new `check-ki-duplicates.mjs`, matching by basename not id (the allowlists hide the id form). Rejected: a second walk of the same directories.
