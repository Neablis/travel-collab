# M41 — Moving and adding stops takes one gesture wherever you are

**Status:** **Proposed 2026-10-06, placed after M40. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).

## Why this exists

Several small planning-ergonomics entries have waited since M8, and each was deferred for the same
reason: none closes a capability gap. M8's scope trim (2026-08-07) said to revisit them once M10's
direction was set, and that direction has been set for weeks. Together they describe one
experience: moving a stop and adding a stop each work the same way in every lens, and take one
gesture.

Candidates absorbed (each deleted by this gate):
- *Drag works in Calendar: from the rack onto a day, and a stop between days* (2026-08-23)
- *M8 Wave C/D trim*: what is left of it is C1 quick-add, C2 search-to-add, C3 a *Move to…* menu for
  a scheduled stop, and empty states for the day column, the rack and History (2026-08-07)
- *The header's "Add stop" on desktop: where should creating an unscheduled stop live?*
  (2026-09-15)
- *A parked stop remembers which day it came from* (2026-09-22)
- *Duplicate and the undo-toast's Restore: no optimistic update yet* (2026-08-01)

## Decisions it needs (recommendations; none answered)

1. **Creating an unscheduled stop belongs to the Unscheduled drawer.** *Recommended:* the drawer
   gets its own *+ Add*, and the header's bare `openCreate()` is removed on desktop. That button
   is the only way to make an unscheduled stop today (`Board.tsx`), so it can only go once the
   drawer has a replacement. RULES.md 2 and 4 are both satisfied that way.
2. **Calendar accepts drops with the same command as Board.** `MoveActivity` is the only command.
   `lensAcceptsDrops.ts` adds Calendar, and the 6-dot grip gets `cursor: grab` only when the drop
   target exists.
3. ***Move to…* is a menu on the stop**, not an enabled Day select in the editor. The editor stays
   a form about the stop, and moving is an action on it.
4. **A parked stop's origin day is read from the log, not stored.** *Recommended:* the rack reads
   the stop's last `MoveActivity` whose `fromDayId` is set. That needs `MoveActivity` to carry
   `fromDayId`, an additive contract change; older events simply have no origin. Storing the
   origin as a field on the activity is the alternative, and replay would have to maintain it.
5. **Quick-add is the prototype's header input**: a single line that parses *"Lunch at Nishiki 12:30"*
   into a stop on the focused day, through the same command path as the editor. It does not call
   the model.

## Scope

- Drag in Calendar, both from the rack onto a day and between days.
- The drawer's *+ Add*, with the header button retired on desktop.
- *Move to…*, quick-add, and a search-to-add button.
- Empty states for the day column, the rack and History.
- Parked-stop origin on the rack card.
- Optimistic Duplicate and Restore.

## Out of scope

- Contained activities, a contract question that lives in M44.
- The phone's own layout decisions (M39).

## Exit gate

- [ ] **Decisions 1–5 are answered and recorded here.**
- [ ] **A stop can be dragged from the rack onto a Calendar day and between Calendar days**, and
      the Calendar move dispatches the same `MoveActivity` as Board. An e2e covers both.
- [ ] **An unscheduled stop can be created on desktop from the drawer**, and a test asserts the
      capability survives the header button's removal.
- [ ] **A scheduled stop can be moved with *Move to…* without dragging**, which also gives a
      keyboard path.
- [ ] **Quick-add creates a stop on the focused day**, with a parser unit-tested over its examples
      and each test seen red.
- [ ] **A parked stop shows the day it left**, and a stop parked before the contract change shows
      none, rather than a wrong day.
- [ ] **Duplicate and Restore update the list before the network returns**, with a test that
      delays the response.
- [ ] **The e2e specs pass on `pnpm --filter web test:e2e:ci-like`.**
- [ ] **[walk]** The PR preview is walked with a mouse and with the keyboard only.
- [ ] A retro is appended at gate close.
