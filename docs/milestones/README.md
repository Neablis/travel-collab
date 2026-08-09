# Milestones and gate discipline

Work proceeds through gates in order. A milestone is done when its **gate**
passes: a demo script runs clean, the test suite (including all prior
milestones' e2e scripts) is green, and a short retro note ("what we learned,
what changed") is committed. No building ahead of the current milestone.

Each milestone gets its own file here with an exit checklist before work on it
begins. Scope inside a milestone can flex; a gate definition changes only by
explicit decision from Mitchell, recorded in the file.

## Gate-close checklist (run in one commit when a milestone's gate passes)

A milestone's gate passing is the single trigger for flipping **every** status
flag, in **one commit** — never a trailing manual step (that is how M2 stayed
unticked). When the deployed gate demo passes:

1. Tick the milestone in `TODO.md`.
2. Check every exit-gate box in the milestone's own file (`docs/milestones/`).
3. Append the retro note to that milestone file.
4. Bump **Current milestone** at the bottom of this file — the single source of
   truth (`AGENTS.md` points here, so this is the *only* place the number
   changes).

The *next* milestone's plan opens with a preflight that re-checks this list
(`TODO.md` standing tasks), so a missed flag is caught at the next kickoff.

## Phase 1 — Full single-player product

**Phase gate: Mitchell plans a real upcoming trip end-to-end with the product
and needs no other tool.** Deliberate trade-off (decided 2026-07-07): Phase 1
has zero network effects — validation is personal utility only — in exchange
for collaboration later landing on a product people already want to join.

| # | Name | Scope |
|---|---|---|
| M0 | Walking skeleton | Monorepo, CI, Google auth, event store, one command→event→projection→UI thread, deployed to Vercel |
| M1 | Planning core | Trips, days, activities; drag-to-reschedule; soft-conflict engine (overlaps, impossible geography) |
| M2 | History & time travel | History UI, undo, revert-to-state — proves the event-sourcing bet before stakes rise |
| M3 | Place & time | Map view (MapLibre), timeline view, calendar views; date-anchored events whose anchors produce soft conflicts when dates shift. *(The anchor UI is retired in M8; the domain rules stay — see that file.)* |
| M4 | Money & lenses | Cost items on activities/days/flights with rollup to trip; output lenses: itinerary, daily, full-trip |
| M5 | Design foundations | Tailwind design system: tokens, documented palette, styled primitives and composites, then a re-skin of every existing surface. Answered "is it consistent" — not "is it obvious" (M8) or "is it beautiful" (M10) |
| M6 | Atomic changes | Client/generator-declared command groups committed as one atomic batch, so undo/redo/revert treat them as a single change. Optimistic updates added mid-milestone |
| M7 | Solo delight | Dynamic pages with typed macros, lazily-instantiated templates, a Notebook route outside time-travel, schema-derived constrained AI via Vercel AI Gateway |
| M8 | Make it real | **Done, gate closed 2026-08-08.** Trip lifecycle (name, dates, archive/delete, duplicate — `SetTripName` did not exist before this, PR #21); anchors retired from the UI but kept dormant; Notebook pulled back to plain notes; KI-5 sync indicator. **Interaction design lives here.** *(Core-loop ergonomics — search-to-add, quick add, moving activities — and first-run/empty states trimmed from scope 2026-08-07; see that milestone's file and `TODO.md`'s Candidate ideas.)* |

## Phase 2 — A product worth using

| # | Name | Scope |
|---|---|---|
| M10 | Visual craft pass | **Executes before M9 — see the 2026-08-08 reorder note below.** The "make it beautiful" pass: a coherent restyle of Home/Trip-plan against an external design handoff, plus inert `<Preview>` shells for M9/M11's not-yet-built surfaces |
| M9 | AI as a planning partner | Thread contract, streaming, propose→review→approve before commit, a refine turn, and the observability that does not exist today (persisted `meta`, replay harness, fixed eval set). The substrate from M7 is sound; the interaction is what is missing. **Conversation design lives here** |

## Phase 3 — Outward

| # | Name | Scope |
|---|---|---|
| M11 | Fork & remix | Clone-with-lineage, day- and trip-level templates, share links with read access. Moved ahead of Collaboration on 2026-07-28 — this is the "social" thing actually wanted, and it needs no realtime transport |
| M12 | Community | Public gallery, discovery, voting, reporting (all trust & safety scope quarantined here) |
| M13 | Collaboration | Invites, roles, revocation; near-real-time sync (transport ADR due here); concurrent-edit conflicts as resolvable data. Architecturally: swap the AccessPolicy implementation, broadcast events. The largest remaining architectural lift, so it waits until something needs it |
| M14 | Rich layer | Notion-style pages with embedded community objects (TipTap/Yjs ADR due here), external calendar sync, dogfood-backlog items. The macro vocabulary deferred out of M8 returns here |

- **Restructure (2026-07-28), from the Phase 1 gate review.** The gate had not
  been met and the reason was structural, not cosmetic: a trip cannot be renamed
  or deleted. **M8 "Make it real"** was inserted to close that floor, **M9 "AI as
  a planning partner"** and **M10 "Visual craft pass"** were added, and
  **Fork & remix moved ahead of Collaboration** — the wanted "social" feature is
  cloning and sharing, which needs no realtime transport, while Collaboration is
  the biggest remaining architectural lift. Renumbering:

  | was | is now |
  |---|---|
  | M8 Collaboration | **M13** |
  | M9 Fork & lineage | **M11** (Fork & remix) |
  | M10 Community | **M12** |
  | M11 Rich layer | **M14** |

  Forward pointers were updated in the ADRs, the foundation spec, the
  guidelines, and `known-issues.md` in the same change. **Closed milestone files
  and closed per-milestone design specs were deliberately NOT rewritten** — they
  were true when written, and this table is how to read them.

- **Reorder (2026-08-08), ADR-018.** M10 "Visual craft pass" executes *before*
  M9, not after, despite its higher number — an external design-team handoff
  specified M9's (and M11's) not-yet-built surfaces, removing the
  design-uncertainty reason the original M9-then-M10 ordering existed for. New
  execution order: `M8 ✓ → [Phase 1 gate review ✓] → M10 → M9 → M11 → M12 →
  M13 → M14`. Milestone *numbers* are unchanged — this is an execution-order
  swap, not a renumbering — see `docs/milestones/M10-visual-craft.md` and the
  ADR for the full argument.

Placement notes (decided 2026-07-07):
- The notes page appears twice on purpose: basic solo notes in M7; embeds and
  community objects in M11.
- Internal calendar UX (drag, holiday anchors) is M3; *external* calendar sync
  is M11 — the original vision bundled these, they are different features.
- M2 precedes M3–M7 deliberately: prove history/revert works before investing
  in breadth on top of it.
- **Renumbering (2026-07-10):** M5 "Atomic changes" was inserted before Solo
  delight; milestones formerly M5–M9 shifted +1. Forward milestone-pointers in
  the ADRs, foundation spec, and guidelines were updated to match in the same
  change.
- **Renumbering (2026-07-11):** M5 "Design foundations" was inserted after
  Money & lenses (decided by Mitchell mid-M4: base functionality first, then a
  design-system pass before further UI breadth, so the polished single-player
  baseline can guide collaboration UX). Milestones formerly M5–M10 shifted +1
  (Atomic changes is now M6, …, Rich layer M11). Phase 1 is now M0–M7. Forward
  milestone-pointers updated to match in the same change.

Current milestone: **M10** — Visual craft pass, brought forward ahead of M9
(see `M10-visual-craft.md` and ADR-018). M8's gate closed 2026-08-08 (see
`M8-make-it-real.md`'s retro) and the Phase 1 gate review with Mitchell
completed the same day; M9 resumes once M10's gate closes.
