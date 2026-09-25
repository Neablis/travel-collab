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
| KI-2026-09-24-a | RESOLVED | `route()` gains `trip: { body }`; confined token + own trip → 201 on `/v1/library` and `/v1/playbooks`, other trip / no trip → 403. Red first (`expected 403 to be 201`); both guards broken and seen red; 81/81 int across six public-api files. |
| KI-2026-09-16-b (account grants) | RESOLVED | `AccountPlanView.grants` + a `plan-grants` row: *"Granted to you: premium v1 (admin, permanent) and plus v1 (founder, until December 1)."* Reproduced (card named no grant); four breaks seen red; 263 unit + 1 int green. |

## Validation results

| Entry | Verdict | Evidence (short; full line in the entry) |
|---|---|---|
| KI-2026-09-20-g | NARROWED, and wider | Radius item struck (only Ledger theme left, `--radius-md: 0`); hand-rolled containers now **seven**, not four (Weather, CountryFacts, SpendByDay added). |
| KI-2026-09-20-h | NARROWED | `cost` takes five filters (person retired); the rest holds. |
| KI-2026-09-22-c | STILL TRUE | undo still skips page events; no marker for a backfilled genesis. |
| KI-2026-09-22-d | NARROWED | silent overwrite struck (`expectedUpdatedAt` + conflict UI); live update still absent. |
| KI-2026-09-24-d | STILL TRUE | no repair scan; `findWidgetError` refuses, not strips. |
| KI-2026-09-24-h | STILL TRUE | `ProposalCard.tsx:64`; Area path corrected to `packages/domain`. |
| KI-2026-09-24-n | NARROWED (count) | 57 of 244 countries have no numbers, not ~45. |
| KI-2026-09-24-o | STILL TRUE | no privacy/legal route exists. |
| KI-2026-09-24-p | STILL TRUE | three unchecked sums; new detail: `block.ts:88` vs `rows.ts:274` format in different currencies. |
| KI-2026-09-24-q | STILL TRUE | `person` absent from every filter list; `isRetired` drops it. |
| KI-2026-09-24-s | STILL TRUE | `useEditSession.ts:131` overtaking save sends no revision. |
| KI-2026-08-30-c | STILL TRUE | this sweep's own worktrees were seeded at `origin/main`, local `main` two commits stale; agent defs have no base check. |
| KI-2026-09-12-b | STILL TRUE | worktree had no `node_modules`; hook did not run. |
| KI-2026-09-05-n | NARROWED | drizzle-kit and `@types/node` skews struck (fixed upstream); next-auth caret, eslint-config-next@15 under next@16 remain. |
| KI-2026-09-16-d | STILL TRUE (code side) | `requireAdmin.ts:20-25`; Preview env not checkable here. |
| KI-2026-09-23-a | STILL TRUE (static) | next 16.3.3, vendored proxy unchanged. |
| KI-2026-09-01 | STILL TRUE | PR #228: CodeRabbit `success` with "Review skipped". Stale `.coderabbit.yaml` comment fixed on this branch. |
| KI-2026-09-07-d | NARROWED | draft-PR guard (#199) struck; the rest holds. `/ki-sweep` 6a now says *draft*. |
| KI-2026-09-20-i | **CLOSED** | decision implemented (#203: `.coderabbit.yaml`, `commenting.md`, docstring wall); backlog lives in 09-22-a. |
| KI-2026-09-22-a | STILL TRUE | 65.5% documented (was 52.6%), 435 grandfathered (was 470). |
| KI-2026-09-02-b | NARROWED | 165 directive lines (was 169); "can only shrink" struck — `DiscoverScreen.test.tsx` added 24 new ones on 2026-09-14. |
| KI-2026-09-05-v | STILL TRUE | 131 disables (was 128), 80 `style={{` (was 75). |
| KI-046 | **CLOSED** | every remaining claim contradicted by code (meta row hidden on phone, one-day board #196, 44px floor, stop editor stacks); residue owned by 09-24-i/j/k/l/m. |
| KI-2026-09-02-d | NARROWED | scenarios now have 8 consumers (`threeDayTrip`, `emptyTrip`); four scenarios still unused. |
| KI-2026-09-06-d | STILL TRUE | 8 bundles, 415 price fields still `origin: "ai"`. |
| KI-2026-09-20-d | STILL TRUE (counts) | fixtures 3/45 located; bundles now 146/148 days draw a map. |
| KI-2026-08-30-f | STILL TRUE | LocationIQ only; 8 venues still in `coordinateGaps.ts`. |
| KI-2026-09-24-i, -j | STILL TRUE (structure) | sticky header unchanged; `md:min-h-0` still drops the floor at 768px. |
| KI-2026-09-20-f | STILL TRUE | 17 route pages, all client-fetched; new constraint: lint forbids pages importing `@/server/*`. |
| KI-2026-09-23-c, -b | STILL TRUE | `pnpm arch` 7 cycle warnings; server root now 38 files (was 27). |
| KI-2026-09-05-j | STILL TRUE | `rebuildProjections` still test-only; no upcaster, no operator rebuild. |
| KI-52 | STILL TRUE | 4 tags vs 6. |
| KI-2026-09-15-a | STILL TRUE | `PlansScreen.tsx:773`. |
| KI-2026-09-16-a (refund) | STILL TRUE | `charge.refunded` not handled; no ledger. |
| KI-2026-09-19-f | STILL TRUE | two `runCommand`s at `v1/trips/route.ts:99,102`. |
| KI-2026-09-02-c | STILL TRUE | no ESLint under `packages/`. |

## Decisions to review

- **KI-2026-08-30-d closed, not narrowed**, though the wall cannot catch the loud form (add/add conflicts after a squashed base, 2026-09-11) — git reports that one itself, and `/ki-sweep` 6b now points at the recovery recipe. Rejected: keeping it open for that form.
- **KI-2026-08-30-d: extended `check-ki-filenames.mjs`** instead of adding a new `check-ki-duplicates.mjs`, matching by basename not id (the allowlists hide the id form). Rejected: a second walk of the same directories.
- **KI-2026-09-24-a: option (a)** — confined tokens may write the library from the trip they name, via a declarative `trip: { body: fn }` on `route()`. Rejected: (b) documenting that confined tokens cannot write the library. A function, not `trip: "body"`, because a Playbook's trip is nested and optional (`source.tripId`).
- **KI-2026-09-24-a side effect:** on `POST /v1/playbooks` a 403/404 about the source trip now happens *before* the `Idempotency-Key` is reserved (as on every trip-in-URL route), so that refusal is no longer stored and replayed. ADR-050's Consequences bullet got a dated *Superseded* note rather than a rewrite.
- **KI-2026-09-16-b wording:** `Granted to you: <plan> v<n> (<source>, <term>)`; source words are the operator console's (`admin`, `founder`, `referral`), except `trial` → `free week` to match the badge; term `permanent` or `until <date>`; the free week's date is dropped when the trial-ends line already shows it. Separate row under `plan-held`, absent when there are no grants. Rejected: softer customer words ("comped by us", "founding member") — the console and the sheet would name one grant two ways.
- **Found, left:** `plan-held` reads *"You bought free v1"* for an account that bought nothing (from #195). Worth a small follow-up.
- **KI-046 closed by validation** although the entry asked to wait for a real-phone walk: every claim it still made is contradicted by the code, and each remaining phone/tablet symptom has its own narrower entry (09-24-i/j/k/l/m). Rejected: keeping a broad umbrella entry open beside five specific ones.
