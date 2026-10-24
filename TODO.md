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
- [x] **M40 A big change is reviewed whole, taken whole, and undone whole** (proposed 2026-10-06 from `docs/candidates.md`, scoped 2026-10-09 with every decision as recommended: Accept all as one batch, named snapshots, assistant writes suggestions; plan `docs/plans/2026-10-09-M40-big-change.md`, removed at close, in git history) → `docs/milestones/M40-a-big-change-is-one-change.md`
- [x] **M41 Moving and adding stops takes one gesture wherever you are** (proposed 2026-10-06 from `docs/candidates.md`, scoped and re-framed 2026-10-10 with Mitchell: gestures over buttons — Calendar city-block drag, the editor's Day field moves any stop, a drawer of just cards, Plan day drag, Option-drag copy, top-edge resize, paste-to-add, parked origin, a ⌘K palette on the page's own actions) → `docs/milestones/M41-planning-without-friction.md` (closed 2026-10-11, gate 13 of 13)
- [x] **M42 The front door shows more than one trip, and what it costs** (proposed 2026-10-06 from `docs/candidates.md`, scoped 2026-10-11 with Mitchell and widened with richer activity tags, ADR-070: demo picker, landing pricing, SEO leftovers, thirteen tags, trip descriptions, tag pages, tag widgets; plan `docs/plans/2026-10-11-M42-front-door-and-tags.md`, (deleted at close; in git history)) → `docs/milestones/M42-the-front-door-shows-more.md`
- [x] **M45 The assistant answers about all your trips, and can take you places** (proposed 2026-10-06 from `docs/candidates.md`, not scoped: account-wide assistant, ClientAction navigation, approved edit mode) → `docs/milestones/M45-the-assistant-beyond-one-trip.md`
- [x] **M46 A trip has a conversation, with the people taking it** (proposed 2026-10-06 from `docs/candidates.md`, scoped 2026-10-13: trip chat, ADR-073; all six parts and part 0 merged 2026-10-14, gate closed 2026-10-17) → `docs/milestones/M46-a-trip-has-a-conversation.md`
- [x] **M47 The operator console shows tiers over time, and paid flows can be tested in production** (proposed 2026-10-06 from `docs/candidates.md`, scoped 2026-10-17, ADR-076: tier history rollup, Stripe livemode) → `docs/milestones/M47-the-business-over-time.md`
- [x] **M50 A stranger can find a day, make it their trip, and bring people in** (proposed and scoped 2026-10-19 from Mitchell's go-to-market plan: copy fixes, first-touch signup attribution (ADR-079), place-page JSON-LD, one step from a playbook day to a new trip, an editorial landing, publishing a lived trip, the referral nudge; the plan is deleted) → `docs/milestones/M50-strangers-find-a-day.md`
- [x] **M51 The front door tells the story** (proposed and scoped 2026-10-20 with Mitchell from the top entry of `docs/candidates.md`, after a design review: the homepage becomes a sea of the library's real day cards with moments rising out of it, plus names on stops (`addedBy`), a day picker over `startingAt`, and the landing's own path into onboarding; placed ahead of M49; closed 2026-10-22, gate 11 of 11, the plan deleted) → `docs/milestones/M51-the-front-door-tells-the-story.md`
- [x] **M52 The trip comes with you: a notebook for today, and an assistant the group can ask** (proposed 2026-10-22 by Mitchell, placed after M51; scoped 2026-10-23: a *During the trip* notebook that Overview swaps to from 3 days before, with a notebook `dateScope` setting and new widgets; a flight number on flight legs; an assistant that knows the time, with a near-me-now tool only during the trip and `@assistant` in the trip chat) → `docs/milestones/M52-the-trip-comes-with-you.md`
- [ ] **M48 A planned trip starts from trips that already exist** (proposed 2026-10-11 from a PM brief, on Mitchell's ask: retrieve example playbook days into plan turns to cut their cost; its serving code merged 2026-10-16 off the row order with Mitchell's approval, behind a flag, on in production from 2026-10-17 so it can prove itself on real plan turns (PRs 459-467, ADR-075); decisions and the remaining gate are in its file) → `docs/milestones/M48-plans-start-from-examples.md` — **PAUSED 2026-10-19** for M50: its open boxes wait on plan-turn traffic
- [ ] **M49 A cover can come from anywhere, and be framed where you want it** (proposed 2026-10-12 on Mitchell's ask, not scoped: the public API sets, reads and clears a trip's cover from any image URL, referenced and never stored; a cover's crop can be repositioned, in the API and on the Unsplash covers in the UI) → `docs/milestones/M49-covers-from-anywhere.md` — waits for M51 (2026-10-20, Mitchell) ← **current milestone**
- [ ] **M43 A trip's notebooks keep up with their templates** (proposed 2026-10-06 from `docs/candidates.md`, moved last 2026-10-12, by Mitchell: nothing is hurting today; shrunk 2026-10-17, since seed back-fill and reset are already built; not scoped: the Overview's identity, its derived title, the open widget's design and filters) → `docs/milestones/M43-notebooks-keep-up.md`
- [ ] **M44 A stop knows what was booked, and what it sits inside** (proposed 2026-10-06 from `docs/candidates.md`, moved last 2026-10-12 with M43; not scoped: booking fields, containment rule) → `docs/milestones/M44-a-stop-knows-what-was-booked.md`
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

## Deferred work, still live

Not a milestone and not a candidate: work paused behind a trigger that has already fired. The
closed-out history of this section moved to `docs/retros/2026-10-16-status-archive.md` §3.

- **Test-suite overhaul task 7.5 — close out the plan.** Write the testing-strategy ADR (the
  number `ADR-021` it was once given is taken) recording the three rejected levers:
  `isolate: false`, a coverage-percentage gate, a permanent mutation-testing CI job. Then remove
  `docs/plans/2026-08-23-test-suite-overhaul.md` and `docs/plans/test-overhaul/` in the same
  commit, as its own PR; never the directory without the ADR.
- **The Dependabot alerts.** Per-advisory triage against actual usage, not a bulk bump;
  deferred deliberately since 2026-09-11.

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
