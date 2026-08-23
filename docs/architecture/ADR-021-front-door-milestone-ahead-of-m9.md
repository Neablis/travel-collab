# ADR-021: M15 "Front door" executes ahead of M9

**Status:** Accepted — 2026-08-23
**Deciders:** Mitchell (product/eng), Claude (architect)
Review: `docs/design-feedback/2026-08-23-design-sync-review.md` §6, §8
Design source: `.design-sync/handoff/design/Trip Planner Redesign.dc.html`,
`.design-sync/handoff/SPEC.md` §6 (decisions D2, D3), `DRIFT.md` D2, D3

## Context

The 2026-08-23 design sync (committed at `.design-sync/handoff/`) introduced a
set of surfaces the product has never had: a **landing page**, custom
**sign-in / sign-up** screens replacing NextAuth's default page, a **first-run**
screen, and a header **account menu**. They are designed in full, with copy.

They have nothing to do with M10. M10's scope is *"a coherent restyle of
Home/Trip-plan against the design handoff"* — an authenticated-user visual pass.
Absorbing a new unauthenticated surface into it is exactly the scope creep
`AGENTS.md` asks to be surfaced rather than silently taken on, and M10's gate has
already been reopened once.

They also have nothing to do with M9, M11, M12, M13 or M14, none of which own a
front door. Left unrouted, the work would have arrived as a third off-roadmap
insert — after the flags/kill-switch insert (2026-08-19) and the test-suite
overhaul (2026-08-23) — which is a pattern worth stopping rather than extending.

Three facts push it early rather than to the end of the queue:

1. **There is no way to sign out.** `server/auth.ts` exports `signOut`; nothing
   in `apps/web/src` calls it. That is a capability gap on the deployed app, not
   a polish item.
2. **The app is about to be shared publicly.** That was the driving need behind
   the AI kill switch three days earlier (ADR-019). A visitor currently meets a
   bare `<Heading>travel-collab</Heading>` and a link to NextAuth's default page.
   The kill switch made public sharing *safe*; this makes it *presentable*.
3. **It is small and it is fully specified.** No new domain rules, no new
   commands. The account menu needs only what NextAuth's session already carries.
   The one designed element with no field behind it — the first-run "Roughly
   when?" chips — is already settled as a `<Preview>` shell (`SPEC.md` D4), since
   `CreateTrip` carries only a name.

## Decision

**Add M15 "Front door" to the roadmap, and execute it immediately after M10's
gate closes and before M9.**

New execution order:
`M8 ✓ → [Phase 1 gate review ✓] → M10 → M15 → M9 → M11 → M12 → M13 → M14`.

Milestone **numbers are unchanged** — this is an execution-order placement, not a
renumbering. That is deliberately the same shape as ADR-018, which moved M10
ahead of M9 without renumbering anything, and for the same reason: the renumber
of 2026-07-28 cost forward-pointer edits across the ADRs, the foundation spec and
the guidelines, and closed milestone files could not be rewritten. Numbers are
cheap to leave alone; order is what actually governs.

## Scope boundaries

The milestone owns the unauthenticated surface and the account control, and
nothing beyond it:

- **In:** landing page; sign-in and sign-up screens; the first-run screen; the header account menu; the empty and error states those surfaces need.
- **Out — M11:** the landing hero's "Look around a real trip" CTA. It drops an unauthenticated visitor into a real trip, which is public read access to trip data. M11 owns share links with read access; `share-button` is already a `<Preview>` registered to M11. **Build the landing page without it, or `<Preview>`-wrap it.** Do not build a bespoke public-read path to satisfy one button.
- **Out — already in M10:** the Caesura rename and a working sign out, both approved into M10 Phase 8b the same day. M15 inherits them rather than redoing them.
- **Out — not designed:** anything behind "Your account". The design's own handler is a toast reading *"Account settings aren't built yet"*. Ship the menu item as a `<Preview>` or not at all; a button that apologises is what the Preview treatment exists to replace.

## Consequences

- **M9 slips by the length of M15.** Accepted: M9 is the largest remaining
  interaction lift and is not blocked by anything M15 touches.
- **A second reorder makes the roadmap's numbers weaker as an ordering signal.**
  `docs/milestones/README.md`'s "Current milestone" line is now the only reliable
  statement of what is next, and both reorders are recorded above it.
- **The first-run screen re-opens a scope trim.** M8 deliberately trimmed
  first-run state on 2026-08-07 on the grounds that a future design pass would
  reshape it. That is what happened; M15 is where it returns, with a design.
- **Two open questions ride with the milestone** rather than blocking it — see
  `docs/milestones/M15-front-door.md`: whether the one-field first-run screen is
  intentionally different from M10 Phase 7's four-step new-trip wizard, and
  whether the landing copy may sell M11/M12 capabilities before they exist.
