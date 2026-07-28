# M8 — Make it real

**Status:** Not started. Opened 2026-07-28 by the Phase 1 gate review.
Milestone files for M9/M10 exist because the review sequenced them together;
this one is next.

## Why this exists

Every M0–M7 milestone is ticked and the **Phase 1 gate has not been met** —
Mitchell was not ready to attempt a real end-to-end trip. The 2026-07-27 audit
found why, and it is not subtle: **a trip cannot be renamed or deleted by
anyone.** `SetTripName` does not exist as a command, `TripNameSet` does not
exist as an event, and there is no `DELETE` route. A trip's name is written once
at `CreateTrip` and is immutable forever.

This milestone is the hard floor under the gate — and under M9, which cannot
build "discuss the trip and shape it together" on a domain that can't name a
trip.

## Scope

- **Trip lifecycle.** `SetTripName` through the full pipeline (command + event +
  `decideTripCommand`/`evolveTrip` + contracts changelog), trip end date or
  duration, archive/delete, and duplicate. This is a genuine contract change and
  gets its own reviewed step before the UI work (AGENTS.md workstream rule).
  Closes **KI-12**.
- **Core loop ergonomics.** Adding an activity by searching for a place rather
  than typing a title; quick-add; moving activities within and between days.
  The drag-and-drop that already works is the thing to protect, not replace.
- **Anchors retired from the UI, kept dormant.** See the section below.
- **Notebook pulled back to plain notes.** Macros, the registry, and the default
  templates stay in the codebase but leave the primary surface; the ambitious
  version is M14's job. Seven macros is not an authoring vocabulary, and the
  block renderers were built after M5 closed so they never had a design pass.
- **First-run and empty states.** What a brand-new trip shows, what each surface
  says when it has nothing in it, and what the next action is. **Interaction
  design lives here** — flows, information architecture, and states, not
  palette. The visual craft pass is M10 and is deliberately separate: M5 proved
  that re-skinning a structure that is still moving gets redone.

## Anchors: dormant, not deleted

Decision (Mitchell, 2026-07-28): **remove the anchors UI, keep the domain.**
`AnchorEditor` and its entry points go; the contract, the anchor-violation
conflict rules, and their tests stay.

Two reasons this is the right shape rather than a deletion. Anchors were never
made legible to a user — the M3 gate proved the *rules* fire, never that anyone
could see or use them. And `publicHoliday` was worse than invisible: it is a
selectable option with a country picker whose oracle is a permissive stub
(`isPublicHoliday: () => true`), so it can never produce a conflict. A control
that cannot do anything is a lie in the UI, and shipping it was worse than not
having the feature.

**The tripwire, which is the point of keeping them:** `anchor-conflicts.test.ts`
and `anchors-state.test.ts` stay in the suite. A future change that breaks
anchors therefore **fails the build**, and the note at that code says: no UI
reaches this, it is dormant by decision — decide whether to revive or delete
rather than reflexively repairing it. A comment alone would never have surfaced;
a failing test will.

Also retire `ConflictContext.timezone` in the same pass or document why not — it
is injected from `TRIP_TIMEZONE`, documented in ADR-006, and read by no rule.

## Exit gate

- [ ] **You create a trip from scratch, name it, set its dates, build three days
      with activities including one added by searching for a place, reorder
      them, rename the trip, and delete a throwaway one — without asking how
      anything works.** That last clause is the gate; the rest is table stakes.
- [ ] No UI path reaches an anchor; the anchor domain tests are still green and
      carry the dormancy note.
- [ ] Contract changelog entry for the trip-lifecycle commands, all consumers
      updated in the same PR.
- [ ] M8 e2e script green, every prior milestone's e2e script still green.
- [ ] Retro appended at gate close.
