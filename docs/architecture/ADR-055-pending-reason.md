# ADR-055: A pending stop says why — `pendingReason`, the way a transit stop says `mode`

**Status:** **Accepted — 2026-09-26, Mitchell's decision, in chat.**
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-053** (transport mode is a closed enum, legal only on transit), **ADR-054**
(three kinds; `idea` and `hold` folded into `pending`), invariants 1, 2 and 5. Milestone:
`docs/milestones/M29-time-river.md`, part 1.

## Context

M28 (ADR-054) folded `idea` and `hold` into one kind, `pending`. The distinction did not
stop mattering; it stopped being stored. The design handoff's next pass
(`.design-sync/handoff/SPEC.md` §36.9) puts it back as a *second row* under the Kind
control: Pending asks **Why** — *To book* or *Maybe* — exactly as Transit asks **By** (the
seven modes). The card badge reads the answer (*To book*, *Maybe*), and the time river of
§36.9b draws the two differently (a dashed warning outline, a faint hatch).

Nothing stored could answer it. Mitchell, 2026-09-26:

> *"Add pending reason. It should be nearly identical as how travel has a type, and
> easily extendible."*

## Decision

1. **`PendingReason` is a closed enum, `book | maybe`**, and `pendingReason` is a field on
   the stop — on `ActivitySnapshot` (so both event payloads), `ActivityView`, `SavedStop`
   and `BundleStop`, `.nullable().default(null)` on every stored shape. Optional on
   `AddActivity`, nullable-optional on `UpdateActivity`. Exactly `mode`'s shape (ADR-053).
2. **Legal only on `kind: "pending"`.** M24's `travelLegFieldsOffTransit` becomes one
   table-driven rule, `KIND_DETAIL_FIELDS` (`mode` and `endLocation` → `transit`,
   `pendingReason` → `pending`) and `kindDetailFieldsOffKind`. It is asked where M24's was:
   the command unions (a command stating the contradiction), the decider (an update whose
   *result* would hold one — refused as `pending-reason-off-pending`, never silently
   cleared; M24's `travel-leg-off-transit` keeps its code) and the saved-day write path.
   Never on an event payload or a read model: replay and stored rows always parse.
3. **Null means "no reason given"** — every stop written before today and every one whose
   author did not say. It badges as plain **Pending**, as before.
4. **Extending it is one line in the contract.** Every display is an exhaustive
   `Record<PendingReason, …>` (the editor's icon and name, the badge's colour), so a third
   value fails to compile until it has all three. No stored row needs rewriting.
5. **The editor** asks it in the same shape as mode: a three-way segmented Kind, then one
   icon-radio row — *To book* (`Ticket`) and *Maybe* (`CircleHelp`) for pending, the seven
   modes for transit. Mitchell, 2026-09-26: *"I prefer the icon buttons so use that for
   both places it has a kind."* A stop **created** as pending starts on *To book* (the
   handoff's `addWhy || 'book'`); a stop being edited keeps what it has, including none.
   Moving the kind away clears the reason on save, as it clears a leg.
6. **Badges:** *To book* in the warning colour, *Maybe* neutral — a maybe is not a to-do.
   A transit stop with a mode badges as its mode (*Train*), per the same SPEC table.
7. **The assistant** sees the field in `read_day`, gets it on its planning tools through
   the command schema, and a kindless `AddActivity` that names a reason is taken to be
   `pending` (the same pre-parse default a leg gets for `transit`).
8. **The Japan fixture** reads its reasons off the design export: its `hold` rows are
   `book`, its `idea` rows `maybe` (SPEC §36.9's own mapping) — 2 and 6.

## Callers

The decider never clears a field on a caller's behalf; a **caller edge** may, because
there the caller is the one speaking. Where a person or a model says "make this
planned" and the edge builds the command, the edge states the clear:
`clearDetailFieldsForKind` (`@tc/contracts`, next to `KIND_DETAIL_FIELDS`) sets every
detail field the new kind cannot carry, and the patch did not name, to `null`. Two
edges use it — the assistant's pre-parse adapter (`writeTools.ts`, beside
`withDetailKind`) and `PATCH /v1/trips/{tripId}/activities/{activityId}`. A field the
patch *did* name is left for the contract to refuse. The web editor does not need it:
it always sends the whole form, and clears off-kind details itself on save (rule 5).
Found in review of #242: every stop the editor creates starts on `book`, so without
this the assistant and the public API could not mark one planned at all. M24 had the
same gap for a leg moved off transit; the helper closes both.

## Not changed, on purpose

- **`needsBooking` stays `kind === "pending"`** (ADR-054 rule 4). A *Maybe* stop is still
  listed under *Still to book*, labelled Maybe, which is what SPEC §36.9's table asks for.
  Whether a maybe should count toward "N to book" on the Calendar and the home hero is a
  real question, and it is a rule change: a follow-up for Mitchell, not a side effect of
  adding the field.
- **"Booked" is not modelled.** The design's *Booked* badge and block need a booking fact
  the contract does not have; Mitchell, 2026-09-26: skip it for now.

## Rejected

- **Reviving `hold` and `idea` as kinds.** ADR-054 retired them for being too much UI for
  the difference; the difference belongs *under* pending, not beside it.
- **A tag.** A tag says what a stop IS; this is why it is not settled, which is workflow.
  Two fields that can disagree (a `maybe` tag on a `planned` stop) is the M18 argument.
- **A free-text reason.** A value with no behaviour cannot draw a badge or a block style.
- **Clearing the reason in the decider** when the kind changes. That is the silent-drop
  class KI-2026-09-05-o is about; the caller sends `pendingReason: null` with the move.

## Consequences

- `travelLegFieldsOffTransit` and `TravelLegField` are gone from `@tc/contracts`, replaced
  by `KIND_DETAIL_FIELDS`, `KindDetailField`, `kindDetailFieldsOffKind` and
  `kindDetailFieldMessage`. The command refusal text is unchanged for the leg fields;
  the saved-day refusal, which used to stop at "transit stop", now ends
  `(kind "transit")` like the command one, because both are the same message.
- The OpenAPI document gains the field on every stop shape; v1 writes take it as they take
  `mode`.
