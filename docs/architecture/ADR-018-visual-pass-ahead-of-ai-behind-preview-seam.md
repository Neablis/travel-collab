# ADR-018: The visual craft pass (M10) moves ahead of M9, behind a Preview seam

**Status:** Accepted — 2026-08-08
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-08-08-M10-redesign-incorporation-design.md`

## Context

An external design team delivered a high-fidelity redesign of the whole product
(handoff bundle: `~/Downloads/design_handoff_trip_planner/`). It is built on this
repo's own M5 design system — the component and token names are ours — so it is a
visual-arrangement problem, not an adoption one. But it is *idealized*: it draws
surfaces for functionality that does not exist yet — the AI Assistant rail and
proposals (M9 scope), and Playbooks / "keep a day" / share (M11 scope).

The roadmap deliberately placed **M10 "Visual craft" after M9** with a stated
argument (`docs/milestones/M10-visual-craft.md`): M9 adds a whole new interaction
surface — conversation, streaming, a proposal diff — and M5's history showed that
polishing before the surface inventory is stable means polishing twice (Wave 1's
re-skin was partly redone in Waves 2–3). That same file **considered and rejected**
slotting M10 right after the Phase 1 gate "where the single-player structure is
settled but M9's surfaces do not exist yet."

Two facts have changed since that rejection:

1. **M9's surfaces now exist as a design.** The precise objection — "M9's
   surfaces do not exist yet" — was about *design uncertainty*. The handoff
   removes it: it specifies the rail, the proposal/ghost pattern, and the
   proactive-suggestion surfaces, drawn from the same intent as M9's own
   exit-gate language. The surface inventory is stable because it is now
   *specified*, not because it is *built*.
2. **The Phase 1 gate review is done** (2026-08-08, Mitchell) — the single-player
   structure is settled, which was the *precondition* the rejected alternative
   was waiting on.

## Decision

**Bring M10 forward, ahead of M9, and execute it as one coherent visual pass over
the full specified surface inventory** — real restyle for existing working
surfaces, and inert shells for the M9/M11 surfaces — **gated by a single
`<Preview>` seam** that guarantees the shells carry no behavior.

New milestone order:

```
M8 ✓ → [Phase 1 gate review ✓] → M10 (visual craft, brought forward) → M9 → M11 → …
```

The `<Preview>` seam (`apps/web/src/components/ui/preview.tsx` + a
`preview-registry.ts`) wraps every not-yet-functional surface: it renders the
real visual, marks it `Preview · <milestone>`, and inerts all interactive
controls. A registry maps each shell to its owning milestone, and a sync test
keeps registry and usage in lockstep. Shells are **real components with real prop
contracts**, fed sample data + no-op handlers now; M9/M11 replace the data source
and handlers and delete the wrapper.

## Consequences

- **The visual pass is done once, not three times.** Restyling home and trip-plan
  now and then re-restyling as M9 bolts on a rail and M11 bolts on Playbooks is
  the exact "polish twice" cost M10's file warned about. Building the shells in
  the same pass avoids it — the whole point of the reorder.
- **M10's "presentational only" exit rule still holds, verbatim.** M10 already
  requires zero diff to `packages/`, `src/server`, and API routes. Inert shells
  are presentational, so the six invariants are untouched and nothing "builds
  ahead" of M9/M11 *behavior* — only their *pixels*, which are now specified.
- **M9/M11 become wiring jobs, not rebuilds** — provided they honor the shell
  prop contracts and context shapes M10 establishes. If M9's real interaction
  diverges from the handoff (the two known gaps: move/modify diffs, streaming
  progress), those specific shells get reworked. The registry bounds that blast
  radius: each divergence is one grep-able `id`.
- **The reorder must be recorded in the roadmap, not just here.** `docs/
  milestones/README.md` (table + Current milestone), `TODO.md`, `docs/STATUS.md`,
  and the `M10-visual-craft.md` scope/exit-gate are updated to this order as the
  M10 kickoff's first step. Closed milestone files are not rewritten (the
  standing convention).
- **A live risk is deferred, not erased:** if M9's conversation design departs
  materially from the handoff, part of the AI shell is wasted work. Accepted
  because the shell is small relative to a second full visual pass, and because
  the shell is drawn from M9's own gate language, making large divergence
  unlikely.

## Alternatives rejected

- **Keep the original order (M10 after M9).** Safest against AI-surface
  divergence, but pays the "polish twice/thrice" cost the reorder exists to
  avoid, and leaves the product visually unsatisfying through M9 — the very cost
  M10's file flagged as the accepted-but-regretted downside of the old order.
  The handoff's arrival is precisely the new information that flips the trade.
- **Build the M9/M11 surfaces now with real (or fake-but-live) behavior.**
  Violates "do not build ahead of the current milestone" and M10's
  presentational-only rule, and would mean a dishonest UI (e.g. a "link copied"
  toast that copies nothing). The `<Preview>` seam exists specifically so the
  surfaces can be *seen* without being *live*.
- **Restyle existing surfaces only; add no M9/M11 shells.** Honors discipline
  most literally but throws away the redesign's main value — showing the whole
  intended product as one composition — and reintroduces the polish-twice cost
  as each future milestone adds its surface against a design that never accounted
  for it.
- **Feature flags instead of a `<Preview>` seam.** More infrastructure, and
  flag-off UI does not read as *deliberately incomplete* to the eye; the point
  here is a visible "coming in M9/M11" marker plus a single grep seam, which a
  small component + registry gives more directly.
