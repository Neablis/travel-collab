# M13 — Collaboration

**Status:** Scoped 2026-09-01. Placed **after M12** in the order set the same day
(`M17 → M9 → M12 → M13 → M14 → M19`). It had no file and no exit gate until now
— a table row and nothing else.

**Narrowed twice, and both subtractions are load-bearing:**

- **2026-08-27 — invites, roles and revocation moved to M11**, because they are
  the same `AccessPolicy` change as share links and opening that boundary twice
  costs twice. M11 shipped them. Read the old scope with that removed.
- **2026-08-30 — it acquired per-stop attribution**, when M11b's shell sweep
  retagged `rack-provenance` to sit beside `add-stop-who`. **M19's link 3
  depends on this milestone landing that field**, which is the whole reason M19
  is placed after it.

**It needs an ADR before it opens** — the realtime transport. And it will need a
migration for per-stop attribution.

## Why this exists

Two people can already be on a trip. M11 shipped memberships, roles, invites and
revocation, so the access half is done. What is missing is that **the second
person's edits do not arrive.** A trip is fetched, folded and rendered; nothing
pushes. Two people editing the same trip today diverge silently until one of them
reloads.

This is the largest remaining architectural lift in the project, which is why it
waited until something needed it. Two things now do: M12's library is built out
of days people share with each other, and the optimistic-update loss class below
has three open entries against it.

### The loss class is already documented, and the fix is already named

`TripProvider`'s optimistic overlay predicts every mutation locally and drains a
send queue in the background. Three open known issues describe the same seam:

| KI | What is lost |
|---|---|
| **KI-5** | Commands still queued when the tab navigates away are lost, with no error surfaced |
| **KI-90** | A unit enqueued *while an undo/redo/revert is in flight* is discarded by the reconcile's unconditional `pending: []` |
| KI-90's second site | `enter` (the history preview) reads a render-time `pending`, so a preview can be entered in the same tick as an enqueue — nothing is lost, noted rather than filed |

**KI-90 names the fix and says why it was not done in a line:** widening
`confirmHead` into a general *"adopt this outcome, re-predict what is queued"*
reducer *"is the shape that would fix KI-77, KI-5's `applyOutcome` precondition
and this at once, and that is a design pass, not a line."*

**That design pass is this milestone.** A reducer that re-predicts queued work
against an authoritative outcome is exactly what a remote edit arriving mid-queue
also needs — which is why doing realtime first and the reconcile afterwards would
build the same machinery twice.

## Scope

Five links. Link 1 is an ADR and gates the rest.

1. **The transport ADR.** Server-Sent Events, WebSockets, or polling with a
   cursor — decided against this project's actual constraints, not in the
   abstract: Vercel's serverless runtime, an event log that is already an
   ordered sequence with a `global_seq`, and a client that already reconciles
   against a fetched head. **`events.global_seq` is the obvious cursor and the
   ADR should say why it is or is not.** ADR due here, per the roadmap table
   since 2026-07-28.
2. **Broadcast.** Committed events reach other viewers of the same trip. The
   command pipeline does not change — this is a read-side push, and
   `AccessPolicy` decides who receives, the same object that decides who reads.
3. **The re-prediction reducer.** `confirmHead` widened to "adopt this outcome,
   re-predict what is queued", per KI-90. **Closes KI-90, KI-5's precondition,
   and the same-tick preview read.** This is the link that makes a remote edit
   arriving mid-edit safe rather than lossy.
4. **Concurrent-edit conflicts as resolvable data.** Two people editing the same
   stop is not an error dialog — it is a conflict the domain can already
   express. The soft-conflict engine (M1) and `detectConflicts` are the shape to
   reuse; a concurrent edit is another kind of thing the trip knows is wrong,
   not a modal.
5. **Per-stop attribution — who a stop is for.** `add-stop-who` and
   `rack-provenance` in `preview-registry.ts`, both blocked on the same absent
   field: *"no field records who a stop is for"*, and *"who parked a stop, and
   which day it came from"*. Participation against the trip's existing members.
   **M19's link 3 builds splits on this field and must not add its own** — that
   is the drift `AGENTS.md` invariant 5 exists to stop.

## Exit gate

- [ ] **The transport ADR is written, accepted, and names what it rejected and
      why** — including whether `events.global_seq` serves as the cursor.
- [ ] Two browsers on the same trip: an edit in one appears in the other without
      a reload, **walked in a real browser as two real actors**, the same
      standard M11's gate held itself to.
- [ ] A viewer who loses access mid-session stops receiving updates — the
      broadcast path honours `AccessPolicy`, and there is a test that fails if
      it stops doing so.
- [ ] **A command enqueued while an undo/redo/revert is in flight survives it**
      — KI-90's reproduction fails before the change and passes after, and the
      entry is moved to `resolved/` with its proof line.
- [ ] Two people editing the same stop produce a **conflict the UI can show and
      a person can resolve**, not a lost write and not a modal.
- [ ] A stop records who it is for, set through the UI and read back off the
      API; `add-stop-who` and `rack-provenance` are wired up or deleted, and no
      M13-tagged entry remains in `preview-registry.ts`.
- [ ] **The attribution migration is written, applied locally, and its
      production dispatch is called out in the PR body.**
- [ ] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`.
- [ ] Retro appended at gate close.

## Deliberately not here

- **Invites, roles and revocation.** Shipped in M11 (link 3, ADR-025). If this
  milestone finds itself touching `AccessPolicy`'s membership rules, that is the
  drift signal `AGENTS.md` names, not a scope discovery.
- **Cost splits.** M19's, built on link 5's field. This milestone lands *who*; it
  does not divide money by them.
- **Presence, cursors, typing indicators.** Not designed. §8 of `SPEC.md` lists
  what is deliberately undesigned and the collaboration surface is not in the
  handoff at all — designing it is a separate ask.

## Prerequisites

**M11, and it is closed.** Memberships, roles and `AccessPolicy` all exist; this
milestone swaps the implementation behind them and adds a push.

**Nothing else.** It is placed after M12 because M12 is smaller and finishes a
surface that is already live, not because of a dependency.

**One thing it owes forward:** M19's link 3. If this milestone ships without
link 5, that link returns to M19 and M19's file says so.
