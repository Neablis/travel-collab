# TODO — high-level roadmap for agents

**How to use this file.** **The unticked milestone rows, top down, are the
execution order** (Mitchell, 2026-09-24): a reorder MOVES THE ROWS, and the
first unticked row is the current work, which also carries
`← current milestone`. A row marked **PAUSED** keeps its place but is skipped —
it is neither current nor next until the word comes off. Ticked rows can sit
anywhere. `pnpm milestone close` and `pnpm state` both read this order, so a
reorder that moves only the marker shows up as DRIFT (KI-2026-09-21-a). Read that milestone's
file in `docs/milestones/` before planning anything. Check items off only when the milestone's exit gate passes
(not when code merges), via the gate-close checklist — `pnpm milestone close`
runs it. Never start an item while an earlier one is unchecked without
Mitchell's explicit say-so.

**Faster than reading this file:** `pnpm state` prints the current milestone,
its gate tally, the first unchecked item and any drift between the four places
that record it, each with a `file:line` citation. `pnpm milestones` prints the
whole table. Neither is a summary — both are extracted, so neither can be
stale in the way this paragraph can.

**Scope lives elsewhere, on purpose.** The milestone table is
`docs/milestones/README.md`; the detail and exit gate are in each milestone's
own file; where the work actually stands is `docs/STATUS.md`; unscheduled
ideas are `docs/candidates.md` (`pnpm candidates`). This file is the checklist
only — deliberately not a second copy of any of them, because two copies
drift.

## Phase 1 — Full single-player product

*Phase gate: Mitchell plans a real trip end-to-end and needs no other tool.*

- [x] **M0 Walking skeleton** → `docs/milestones/M0-walking-skeleton.md`
- [x] **M1 Planning core** → `docs/milestones/M1-planning-core.md`
- [x] **M2 History & time travel** → `docs/milestones/M2-history-time-travel.md`
- [x] **M3 Place & time** → `docs/milestones/M3-place-and-time.md`
- [x] **M4 Money & lenses** → `docs/milestones/M4-money-and-lenses.md`
- [x] **M5 Design foundations** → `docs/milestones/M5-design-foundations.md`
- [x] **M6 Atomic changes** → `docs/milestones/M6-atomic-changes.md`
- [x] **M7 Solo delight** — gate closed 2026-07-21 → `docs/milestones/M7-solo-delight.md`
- [x] **M8 Make it real** — gate closed 2026-08-08 → `docs/milestones/M8-make-it-real.md`
- [x] **Phase 1 gate review with Mitchell** — done 2026-08-08. The 2026-07-28
      review had deferred this behind M8 (a trip could not be renamed or
      deleted); M8 closed that floor and the dogfood review passed.

## Phase 2 — A product worth using

- [x] **M10 Visual craft pass** — gate closed 2026-08-27 → `docs/milestones/M10-visual-craft.md`
- [x] **M18 A stop knows what kind of thing it is** — gate closed 2026-08-29 → `docs/milestones/M18-stop-kind.md`
- [x] **M18b Tag focus** — gate closed 2026-08-30 → `docs/milestones/M18b-tag-focus.md`
- [x] **M16 The assistant answers questions** — gate closed 2026-08-29 → `docs/milestones/M16-assistant-read-agent.md`
- [x] **M9 Phase 0 — the assistant kernel** — complete 2026-09-11 (#162, #163; ADR-043), ticked on completion rather than a gate → `docs/specs/2026-09-10-assistant-kernel-design.md`
- [x] **M17 Account preferences** — gate closed 2026-09-11 → `docs/milestones/M17-account-customization.md`

## Phase 3 — Outward

- [x] **M11 Sharing, invites, and a trip you can hand to someone** — gate closed 2026-08-28 → `docs/milestones/M11-sharing-and-invites.md`
- [x] **M11a An invite gate on the front door** — gate closed 2026-08-31 → `docs/milestones/M11a-invite-gate.md`
- [x] **M11b Playbooks becomes a public library** — gate closed 2026-08-31 → `docs/milestones/M11b-playbooks-public-library.md`
- [x] **M27 The simplify pass** — gate closed 2026-09-23 → `docs/milestones/M27-simplify-pass.md`
- [x] **M12 Reviews and moderation** — gate closed 2026-09-23 → `docs/milestones/M12-reviews-and-moderation.md`
- [x] **M13 Collaboration** — gate closed 2026-09-22 → `docs/milestones/M13-collaboration.md`
- [x] **M24 A leg knows where it goes and by what** — gate closed 2026-09-25 → `docs/milestones/M24-travel-legs.md`
- [x] **M28 Three kinds** — gate closed 2026-09-26 → `docs/milestones/M28-three-kinds.md`
- [x] **M14 Rich layer** — gate closed 2026-10-01 → `docs/milestones/M14-rich-layer.md`
- [x] **M19 A cost knows who and what it is for** — gate closed 2026-10-02 → `docs/milestones/M19-cost-model.md`
- [x] **M29 The time river** — gate closed 2026-10-04 → `docs/milestones/M29-time-river.md`
- [x] **M30 Notebooks with one job each, and links between them** — gate closed 2026-10-04 → `docs/milestones/M30-notebooks-and-links.md`
- [x] **M31 We can see what the assistant costs, step by step and tool by tool** — gate closed 2026-10-05 → `docs/milestones/M31-assistant-ledger.md`
- [x] **M32 The assistant can say which day is free, in one call** — gate closed 2026-10-05 → `docs/milestones/M32-free-day.md`
- [x] **M33 We can see whether an assistant change works before it ships** — gate closed 2026-10-05 → `docs/milestones/M33-evals.md`
- [x] **M34 Adding a stop suggests what other travellers did nearby** — gate closed 2026-10-06 → `docs/milestones/M34-nearby-stops.md`
- [x] **M36 The operator console is four tabs, and an account has a page** — gate closed 2026-10-06 → `docs/milestones/M36-operator-console.md`
- [x] **M35 You can say who on a trip is actually going** (minted 2026-10-05 by Mitchell, **built before minting** on PR #335 while M34 was current, and not restacked, by his call; per-person costs count travellers rather than members (ADR-065), and Trip settings → People replaces the Travelers panel; migration `0039`) →
      `docs/milestones/M35-travellers-and-people.md`
- [x] **M37 A trip looks like somewhere before it has a plan** (proposed 2026-10-06 from `docs/candidates.md`, scoped the same day, decisions as recommended: home cards, Unsplash covers, trip length) → `docs/milestones/M37-trips-look-like-somewhere.md`
- [x] **M38 You can tell people apart, and see a trip before you join it** (proposed 2026-10-06 from `docs/candidates.md`, scoped 2026-10-07 with every decision as recommended: avatars, colours, display names; invite page from notebook widgets) → `docs/milestones/M38-people-you-can-tell-apart.md`
- [x] **M39 The phone layout is decided once, and Caesura installs like an app** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: design critique, phone conflict state, PWA install) → `docs/milestones/M39-the-phone-is-decided.md`
- [ ] **M40 A big change is reviewed whole, taken whole, and undone whole** (proposed 2026-10-06 from `docs/candidates.md`, scoped 2026-10-09 with every decision as recommended: Accept all as one batch, named snapshots, assistant writes suggestions; plan `docs/plans/2026-10-09-M40-big-change.md`) → `docs/milestones/M40-a-big-change-is-one-change.md` ← **current milestone**
- [ ] **M41 Moving and adding stops takes one gesture wherever you are** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: Calendar drag, Move to…, quick-add, drawer add, parked origin) → `docs/milestones/M41-planning-without-friction.md`
- [ ] **M42 The front door shows more than one trip, and what it costs** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: demo picker, landing pricing, SEO leftovers) → `docs/milestones/M42-the-front-door-shows-more.md`
- [ ] **M43 A trip's notebooks keep up with their templates** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: seed back-fill and reset, pages.kind, the open widget's design and filters) → `docs/milestones/M43-notebooks-keep-up.md`
- [ ] **M44 A stop knows what was booked, and what it sits inside** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: booking fields, containment rule) → `docs/milestones/M44-a-stop-knows-what-was-booked.md`
- [ ] **M45 The assistant answers about all your trips, and can take you places** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: account-wide assistant, ClientAction navigation, approved edit mode) → `docs/milestones/M45-the-assistant-beyond-one-trip.md`
- [ ] **M46 A trip has a conversation, with the people taking it** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: trip chat) → `docs/milestones/M46-a-trip-has-a-conversation.md`
- [ ] **M47 The operator console shows tiers over time, and paid flows can be tested in production** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: tier history rollup, Stripe livemode) → `docs/milestones/M47-the-business-over-time.md`
- [x] **M15 Front door** — gate closed → `docs/milestones/M15-front-door.md`
- [x] **M9 The assistant cites what it plans** — gate closed 2026-10-06 → `docs/milestones/M9-ai-planning-partner.md`

- [x] **M20 An account knows what it may do** — gate closed 2026-09-14 → `docs/milestones/M20-account-tiers-and-entitlements.md`
- [x] **M21 An account can pay for itself** — gate closed 2026-09-19 → `docs/milestones/M21-subscriptions-and-billing.md`
- [x] **M22 An account can build on the API** — gate closed 2026-09-19 → `docs/milestones/M22-public-api-and-tokens.md`
- [x] **M25 A trip is a file you can take with you** — gate closed 2026-09-19 → `docs/milestones/M25-a-trip-is-a-file.md`
- [x] **M23 A playbook can be more than one day** — gate closed 2026-09-19 → `docs/milestones/M23-multi-day-playbooks.md`

- [x] **M26 The build looks like the design again** — gate closed 2026-09-21 → `docs/milestones/M26-design-parity.md`

## Candidate ideas (unscheduled)

**Moved to `docs/candidates.md` on 2026-09-21** — 27 entries, and they were 39KB
of this file. `pnpm candidates` lists them; that file carries the placement
lifecycle and the rule that a gate close deletes what it absorbed.

## Deferred work with a resume condition that has already fired

Not a milestone, and not a candidate idea — work that was consciously paused
behind a named trigger, where the trigger has since happened. Listed here
because the only thing that recorded it was a paragraph in `docs/STATUS.md`
marked "history", so nothing live surfaced it and nobody resumed.

- **Test-suite overhaul, Phases 5-7 — CLOSED OUT 2026-08-31.** Phases 0-4
  landed 2026-08-23; 5-7 were gated on M10 Wave 2's gate, which closed
  2026-08-27 with nothing resuming. The required Phase 0 re-inventory was run
  (`docs/plans/test-overhaul/phase-5-inventory-2026-08-30.md`) and the verdict
  is per phase, not wholesale:
  **Phase 5 superseded** — the suite is 138 files / 1,908 tests against the
  overhaul's 95/569 baseline, but reading the candidates rather than ranking
  them, category (c) is empty, (a) is 7 assertions, (b) is 60, and (d), the big
  lever at a claimed 152 tests, is nine false positives. The suite tripled
  because the product tripled; volume is real, waste is not.
  **Phase 6 absorbed** — 6.4 was `check-sleep-wall.mjs` (since 2026-09-25 the ESLint rules `playwright/no-wait-for-timeout` and `no-restricted-properties` on `waitForTimeout`, fixtured in `check-lint-wall.mjs`), 6.5 is AGENTS.md's
  property-test rule plus `witness.ts`, whose last gap (three `fast-check`
  files with no floor) was closed 2026-08-30 with measured, non-vacuity-proven
  floors.
  **Phase 7 is NOT closed** — see the two live items below.

- **The activity-field descriptor refactor — unattached since 2026-08-31.**
  Project review §6.1. Scheduled 2026-08-29 "alongside" M11a and M11b; both
  gates closed 2026-08-31 and it did not happen, so it belongs to no milestone
  and nothing surfaced it. **Recorded here 2026-09-11** because the only thing
  carrying it was `docs/STATUS.md`'s "Next action" — the precise failure this
  section exists for, repeated. It is **not blocked**: its stated prerequisite
  is already met (§1.6 / KI-54 resolved, `equality.ts:55-56` compares `city`
  and `countryCode`). `AGENTS.md` reserves the contracts step as **its own
  reviewed PR**, which Mitchell scheduled it knowing — so keep it separate from
  any milestone PR.
- **The 19 Dependabot alerts.** Per-advisory triage against actual usage, not a
  bulk bump. Deferred deliberately; recorded here 2026-09-11 for the same
  reason as the item above.

## Live, and previously hidden inside a closed-out plan

- ~~**Seed content is code, so there is not much of it**~~ — **done 2026-09-06**,
  branch `claude/serialize-and-seed-data-66f8tb`, **ADR-041**. Mitchell asked for
  a JSON serialization for notebooks, activities and trips, an importer, and *"a
  lot of believable playbooks"*. `travel-collab/content-bundle/v1` +
  `pnpm --filter web content:import` + **148 playbook days over twenty regions**
  and four demo trips, all in `content/` — including San Francisco, Napa,
  Capitola/Monterey and the Finger Lakes, which Mitchell named on the night. `saved_days.author_kind` (migration `0017`)
  is the human-vs-AI flag he asked for, surfaced as an "AI starter" badge.
  **It closed a real gap**: Discover's budget filter had no occupant in three of
  its four bands anywhere in the seed — the thing `starterDays.ts`' own header
  flagged and said it was too small to fix. All four are populated now.
  What it left open, on purpose: **`KI-2026-09-06-c`** — imported stops carry no
  coordinates (a wrong pin is worse than none; KI-39 measured that once already),
  so the four demo trips read "N stops have no place yet" on the Map lens until
  somebody runs an offline geocoding pass on the model of
  `scripts/geocode-japan-seed.mts`. The playbook days are unaffected — Discover
  matches on `location.city` and all 1,375 stops carry one. And
  **`KI-2026-09-06-d`** — the later bundles were written without live web access,
  so their prices and opening hours need a verification pass; each says so in its
  own `bundle.sources`.

- ~~`docs/guidelines/testing.md` does not exist~~ (7.2) — **done 2026-09-02.**
- ~~No `write-a-test` skill~~ (7.4) — **done 2026-09-02.**
- ~~Task 7.1's lint rules~~ — **done 2026-09-02**, and the reason it was still
  live is worth keeping: 7.1's header had said *landed* since 2026-08-31 on the
  strength of four unrelated walls in `scripts/`. Five of its six rows had
  shipped as nothing. **A task marked done by substitution is worse than one
  marked open** — nothing was looking for it. Two of the six rows are now
  rejected in writing rather than left implied (`randomUUID` breaks the
  integration lane's row isolation; the `TripDetail` row needs type information
  ESLint does not have).
- **Task 7.5 — close out the plan.** The last live item in the test overhaul.
  `ADR-021-testing-strategy.md` does not exist, and it is the thing that stops
  a future session re-proposing the three levers already evaluated and
  rejected: `isolate: false` (248 failures), a coverage-percentage gate, and a
  permanent mutation-testing CI job. Then `docs/plans/2026-08-23-test-suite-overhaul.md`
  and `docs/plans/test-overhaul/` are removed in the same commit, per
  `docs/plans/README.md`. Own PR. **Do not delete the directory without writing
  the ADR first** — the rejected levers are the durable half.
- **DONE 2026-10-04 — `ci.yml` has a `changes` job and `ci-ok` is the one
  required check on `main`.** What it was: Convert `ci.yml`'s `paths-ignore` to a skip-job pattern BEFORE enabling
  branch protection. The repo went public 2026-08-31, so branch protection is
  now available (`gh api .../branches/main/protection` returns "Branch not
  protected", not the old "Upgrade to GitHub Pro"). The moment a path-filtered
  job is made a *required* status check, every prose-only PR is unmergeable
  forever — a required check that never runs never reports. A job that runs and
  skips does report, which is the fix. `docs/guidelines/ci-cost-and-capacity.md`
  carries the detail. **Do this before flipping required checks on, not after.**

## Standing tasks (every milestone)

- **Preflight (kickoff):** before the milestone's first task, reconcile the
  *previous* milestone's gate-close checklist (`docs/milestones/README.md`) — if
  any flag is unflipped, flip it first. This is the forcing function that catches
  a missed gate-close. Also check for sibling `claude/*` branches on the
  *current* milestone (`git branch -a`, `git ls-remote --heads origin`) that
  might be finished-but-unmerged before starting more independent work on top —
  see `AGENTS.md`'s Workstreams section for why this matters and what it cost
  once already (M10 Wave 2 Phase 3 sat unmerged and diverged while Phase 4 was
  built and merged independently, 2026-08-22).
- Write the milestone file (scope + exit gate) before its first commit.
- Keep every prior milestone's e2e script green.
- **At gate time, run the gate-close checklist** in `docs/milestones/README.md`
  (tick here, check the milestone file's exit-gate boxes, append the retro, bump
  Current milestone, update `docs/STATUS.md`, and remove the milestone's plan
  from `docs/plans/` after promoting anything durable out of it) — all in one
  commit, never a trailing manual step.
- Record any irreversible decision as an ADR before acting on it.
