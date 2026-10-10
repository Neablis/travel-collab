# ADR-068: One way to do each thing — the command palette runs the page's own actions

**Status:** **Accepted — 2026-10-10.** Mitchell, in M41's scoping session.
**Deciders:** Mitchell (product); Claude — drafted
Related: **RULES.md 4** (*challenge to simplify*: never show or do the same thing twice),
**RULES.md 5** (*few things, made easy*), **ADR-013** (one batch is one History entry),
**ADR-012** (trip client-state architecture), milestone
`docs/milestones/M41-planning-without-friction.md` (D9, D11).

## Context

M41 adds a ⌘K command palette: type *map*, *plan*, *new* or *ask* and go there or start it without
the mouse. A palette is a second door to everything, and the easy way to build one is to write
each command as its own small handler: push the lens's URL, open the editor with some options,
open the assistant panel. Each such handler is a copy of what a button or gesture already does,
and copies drift. The palette's *New stop* ends up skipping the focused day that the river
respects, or its *Go to Calendar* forgets the query string that the lens switcher keeps.

Mitchell's direction on 2026-10-10 was wider than the palette: *"we can use this as a opportunity
to confirm we don't have multiple ways of doing things, the command pallet should always use the
same functionality the page does to navigate and open things and look for duplication and drift
as we develop"*. M41 is also removing controls on the same principle: the rack card's *Add to
day…* select gives way to the editor's Day field, and the header's *Add stop* gives way to the
gestures where a stop lives.

## Decision

1. **A palette command holds a reference to an existing action; it never re-implements one.** The
   action is the function the page's own control or gesture calls: the lens switcher's navigate,
   `openCreate`, the assistant's open, undo and redo, the share sheet's open. Where that function
   is inline in a component today, it is lifted into a named function or a context value that
   the control and the palette both call. The palette's registry module only imports and lists
   them.
2. **A test asserts the identity.** For each command, the test checks that it calls the same
   function the page control calls (the same reference, or the same mocked context value), not
   merely that the same thing appears to happen. A command whose page control is removed fails
   the test instead of quietly living on.
3. **One move function serves every move.** A drag in Plan or Calendar, a day or city-block drag,
   a rack drop and the editor's Day field all build their commands through one shared function,
   which produces `MoveActivity` (and `SetTripDates` when a drop grows the trip) as one batch.
4. **Every part of a milestone reports the duplicates it finds.** In its self-review, a part lists
   any second path it found to an existing action. It either removes the second path or records
   why both stay (a phone and a desktop form of the same action, for example). The milestone's
   gate PR keeps the running list. This applies beyond M41: it is part of `stacked-prs.md` §3a's
   self-review from now on.
5. **The palette does not talk to the model in v1.** Text that matches no command shows *No
   match*. Handing it to the assistant would make the palette a second chat box, and the
   assistant already has one.

## Consequences

- Adding a palette command is cheap only when the action already exists as a named function.
  When it does not, the command's cost includes lifting it, which is the point.
- The phone keeps its `⋯` menu item for *Add stop* beside ⌘K's *New stop*. Both call
  `openCreate`, so this is one action with two doors for two kinds of device, recorded under
  decision 4, not a duplicate.
- A future command with no page control (an action only the keyboard can reach) is allowed, but
  it is a decision to record, not a default.
