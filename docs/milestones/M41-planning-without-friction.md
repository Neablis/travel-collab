# M41 — Moving and adding stops takes one gesture wherever you are

**Status:** **Scoped 2026-10-10 by Mitchell, in session, and re-framed in the process.** The five
recommendations it was proposed with (2026-10-06) were checked against the code first, and most
had gone stale: they were written 2026-08-01 to 2026-09-22, before the time river (M29), the
Calendar redesign (M26/M27) and the phone layout (M39). Mitchell's direction for the re-frame,
2026-10-10: *"less buttons on the ui, more consolidation of functionality so it has a very
functional page with natural interactions, rather than tons of buttons"*. Built as a stack after a
phase-0 PR that tracks this gate (`docs/plans/2026-10-10-M41-gestures.md`). ADR-068 records D9.

## Why this exists

Adding and moving a stop with a mouse on Plan already works well. The time river (M29) gave it
double-click to add an hour, drag across empty time to add a length, drag to move a stop between
days or onto the rack, and the bottom edge to change when a stop ends. What is left is everywhere
else, and the controls that grew up around the gaps:

1. **Calendar cannot rearrange anything.** It draws one summary card per city per day, with no
   drag at all, and no rack.
2. **There is no way to move a stop except by dragging it**, so there is no keyboard path, and a
   phone has only a long-press.
3. **The river's gestures are invisible.** An empty day says nothing about how to fill it.
4. **The drawer is the least intuitive surface left** (Mitchell): every card carries Edit, Remove
   and an *Add to day…* select, and the only way to make a parked stop is the header's
   *Add stop*, which shows on every lens.
5. **A parked stop loses its context**: the rack says who parked it, not which day it left.
6. **Nothing can be reached without a mouse**: there is no way to jump to a lens, a trip or the
   assistant from the keyboard.

Candidates absorbed (each deleted by this gate):
- *Drag works in Calendar: from the rack onto a day, and a stop between days* (2026-08-23),
  replaced by D2's city-block drag: Calendar has drawn no individual stops since the redesign.
- *M8 Wave C/D trim*: C3 (*Move to…*) and the empty states, as D3 and D5. C1 quick-add and C2
  search-to-add are **cut** (D10).
- *The header's "Add stop" on desktop: where should creating an unscheduled stop live?*
  (2026-09-15), as D1.
- *A parked stop remembers which day it came from* (2026-09-22), as D6.

Returned to `docs/candidates.md` rather than built (D10): quick-add, search-to-add, and
*Duplicate and the undo-toast's Restore: no optimistic update yet* (a Home trip-list item).

## Decisions (answered 2026-10-10 by Mitchell)

1. **Making a stop is a gesture where it will live.** On Plan, double-click or drag across a
   day's empty time (as today). For a parked stop, **double-click empty space in the drawer**,
   which opens the editor set to *Unscheduled*. The header's *Add stop* is **removed on desktop**;
   the phone keeps its `⋯` menu item. ⌘K's *New stop* (D9) is the keyboard way in.
2. **Calendar rearranges by city block.** Dragging a city's card from one day onto another moves
   **the stops on that card** there, as one batch: one History entry, one undo. A card is a run of
   consecutive stops in one city (`calendarCityCards.ts`), so a day of Kyoto, Nara, Kyoto shows
   three cards, and the one grabbed is the one that moves. The stops with no city form one card
   too.
   - Dropped on a date **after the trip's end**, the trip grows to that date in the same batch:
     `AddDay` for each new day, then the moves. It does not use `SetTripDates`, because the trip
     page never sets an end date (`TripDateControl.tsx:10-18`).
   - Dropped **before the start** is not a drop target: the start date never moves.
   - Moving Day 1's block away leaves Day 1 empty; it does not move the start (Mitchell).
   - The rack is mounted in Calendar, and a rack card dropped on a day moves it there.
   - Every drop dispatches the same `MoveActivity` as Board, through one shared move function.
3. **Moving a stop without dragging is the editor's Day field**, enabled for every stop, not
   only on create (Mitchell: *"two ways, long press or open activity and add to day when on
   mobile"*). Changing it dispatches the same `MoveActivity` a drag does; a timed stop keeps its
   time on the new day. An edit that changes the day and other fields is one batch
   (`UpdateActivity`, then `MoveActivity`): one History entry. The editor also gains **Remove**,
   which the rack card loses (D4). This replaces both the *Move to…* menu and the keyboard shortcuts that
   were considered, and the rack card's *Add to day…* select.
4. **The drawer is just cards.** A card is tapped to open its editor and dragged to place it.
   Its Edit, Remove and *Add to day…* controls go; Remove lives in the editor. The drawer stays a
   drop target, and double-click on its empty space makes a parked stop (D1).
5. **An empty day says how to fill it**, in a line of text in the river (*"Double-click or drag
   to add a stop"*; on touch, *"Hold to add a stop"*). It is text, not a control.
6. **A parked stop shows the day it left, read from the log, not stored.** The event
   `ActivityMovedV1` gains `fromDayId` (optional, nullable; no migration), which `decide` stamps
   from state, so a client cannot send one and `MoveActivity` is unchanged. The detail read
   carries it as `parkedFrom` (optional), and the public API's version takes a minor bump (1.12.0)
   with it. The rack card reads the stop's last move: *"from Day 3"*. Stops moved before the
   change, and moves made by revert or clone without an origin, show nothing rather than a wrong
   day. *(Corrected at build time, part 3: this said `MoveActivity` gained the field and there
   was no version bump.)*
7. **Plan gets the same direct gestures** (Mitchell agreed 2026-10-10):
   - drag a **day** from Plan's day rail onto another day, which moves that day's stops with the
     same function as D2 (a city block is a subset of a day);
   - **Option/Alt-drag** a stop to drop a copy;
   - drag a stop's **top edge** to change when it starts, beside the bottom edge's end;
   - **Delete/Backspace** on a focused stop removes it, undone as any removal is (⌘Z, History).
     *(Corrected at build time, part 5: no removal has an undo toast.)*
8. **Paste onto a day makes a stop.** With a day focused, ⌘V of a Google Maps link or a line of
   text, or dropping either onto a day, opens the editor on that day prefilled with the title and
   place. It goes through the editor and `AddActivity`, never the model. This is what replaces
   quick-add and search-to-add.
9. **⌘K opens a command palette that runs the page's own actions** (ADR-068). v1:
   - **Go to** a lens, another trip, Playbooks, Settings;
   - **New stop** (the focused day, else parked), **New trip**, **Undo**, **Redo**, **Share**;
   - **Ask the assistant**, which opens the assistant exactly as its own control does (Mitchell);
   - loose matching as you type; Enter runs the top match.

   Every command calls the **same function** its page control or gesture calls, so the palette
   is never a second way of doing anything. Text that matches nothing does not go to the model
   in v1.
10. **Cut:** quick-add (D8 and the river's gestures replace it; the prototype never had the
    header input the proposal described), search-to-add (the editor's place search and M34's
    nearby suggestions cover it), and optimistic Duplicate/Restore (a Home trip-list item, off
    this theme). All three go back to `docs/candidates.md`.
11. **One way to do each thing, checked as we go** (Mitchell: *"look for duplication and drift
    as we develop"*). Each part's self-review lists any second path it finds to an action that
    already exists, and either removes it or records why both stay. The tracker in part 0 keeps
    the running list. ADR-068 records the rule.

## Scope

- Calendar: the rack, city-block drag, and growing the trip past its end (D2).
- The editor's Day field for every stop (D3); the drawer as just cards, with double-click to
  create (D1, D4); the header's *Add stop* removed on desktop (D1).
- The empty-day hint (D5).
- `fromDayId` on the `ActivityMovedV1` event, `parkedFrom` on the detail read, and *"from Day N"* on the rack card (D6).
- Plan's day drag, Option-drag to copy, top-edge resize, Delete to remove (D7).
- Paste-to-add (D8).
- ⌘K v1 (D9), and the duplication check (D11).

## Out of scope

- Contained activities, a contract question that lives in M44.
- The phone's own layout decisions (M39).
- Multi-select drag, pinch-to-zoom the river, resize by keyboard, and ⌘K handing unmatched text
  to the assistant: each goes to `docs/candidates.md`.

## Exit gate

- [ ] **Decisions 1–11 are answered and recorded here**, and ADR-068 is written.
- [ ] **Any stop can be moved from its editor's Day field**, and the move is the same
      `MoveActivity` a drag dispatches (a test asserts the command, seen red).
- [ ] **A parked stop can be created on desktop by double-clicking the drawer**, the header's
      *Add stop* is gone on desktop, and the drawer's cards carry no controls of their own.
- [ ] **An empty day shows how to fill it.**
- [ ] **A parked stop shows the day it left**, and a stop parked before the contract change, or
      by a revert, shows none rather than a wrong day.
- [ ] **In Calendar, a city block dragged to another day moves all its stops in one batch**, one
      History entry and one undo; a drop past the end grows the trip; moving Day 1's block leaves
      the start date alone; a rack card drops onto a day. An e2e covers the block drag.
- [ ] **In Plan, a day can be dragged onto another, Option-drag copies a stop, the top edge moves
      its start, and Delete removes a focused stop**, each with a test seen red.
- [ ] **Pasting a Maps link or a line of text onto a day opens the editor prefilled**, with the
      parser unit-tested over its examples and each test seen red.
- [ ] **⌘K reaches every lens, another trip, Playbooks, Settings and the assistant, and makes a
      stop**, and a test asserts each command calls the same function as its page control.
- [ ] **No second way to do a thing was added**: part 0's duplication log lists every one found
      and what was done about it.
- [ ] **The e2e specs pass on `pnpm --filter web test:e2e:ci-like`.**
- [ ] **[walk]** The PR preview is walked with a mouse and with the keyboard only.
- [ ] A retro is appended at gate close.
