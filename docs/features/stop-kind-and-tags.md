# Stop kind and tags

Two fields on every activity ("stop"). **Kind** says where the stop is in the
workflow; **tags** say what the stop is. They are separate on purpose
(ADR-054): a fact one of them carries is never restated by the other. Both are
set from the stop editor and drive badges, chips, counts, charts and a
cross-lens focus control.

## Kind: is it settled, and is it travel

One of three values (ADR-054, M28):

| Kind | Label | Means |
|---|---|---|
| `planned` | Planned | You intend to do it. The default, and it shows no badge. |
| `pending` | Pending | Not locked in yet. Carries a reason: `book` (still needs booking) or `maybe` (ADR-055). |
| `transit` | Travel | Moving between the stops either side. Carries a mode: walk, bus, train, flight, ferry, car or bike (ADR-053). |

- **Set it:** the stop editor's three-way kind control, then one second row for
  the kind that has a detail (the pending reason, or the travel mode).
- **See it:** the badge on the stop's block (**Pending**, or its reason, and
  **Travel** with its mode). `planned` shows nothing.
- **It drives:** every *to book* count, the Calendar's per-city count and the
  home hero's tile among them. They all read `needsBooking`, which is
  `kind === "pending"`.

A stored stop may carry a kind M28 retired (`booked`, `hold`, `idea`). It is
translated as it is read (`StoredActivityKind`), so nothing past the parse sees
more than the three.

## Tags: what the stop is

Thirteen values, any number per stop (ADR-070). Twelve are **categories**, what
a stop IS. One is a **modifier**, what it NEEDS.

| Key | Label | Role | Covers |
|---|---|---|---|
| `meal` | Food | category | restaurants, street food, food halls |
| `drinks` | Drinks | category | bars, cafés, wineries, tastings |
| `nightlife` | Nightlife | category | clubs, late venues, night markets after dark |
| `museum` | Museum | category | museums and galleries |
| `sight` | Sight | category | landmarks, temples, monuments, viewpoints |
| `outdoors` | Outdoors | category | hikes, parks, gardens, viewpoints you walk to |
| `beach` | Beach | category | beaches, swimming, coast |
| `shopping` | Shopping | category | shops and markets |
| `show` | Show | category | performances, sport, events |
| `tour` | Tour | category | guided tours and classes |
| `wellness` | Wellness | category | spa, onsen, yoga |
| `lodging` | Lodging | category | where you sleep |
| `ticketed` | Ticketed | modifier | needs a ticket or booking to enter |

- **The vocabulary is closed.** No free-text tags: a closed set is what lets a
  chart, a filter or a page be built on it.
- **Keys never change.** Stored events, trip documents and saved days parse
  with the strict enum, so a key is never renamed or removed; only a label can
  change (`meal` reads *Food*). New keys are appended to the contract's order,
  which is `meal, lodging, ticketed, outdoors`, then the nine ADR-070 added.
- `considering` and `travel`, from the design handoff, are not tags: they would
  restate `kind: pending` and `kind: transit` (KI-52, resolved by ADR-070).
- The contract exports the split: `ActivityTagCategory` and
  `ActivityTagModifier`. Code that needs one or the other reads those, never
  its own list.

### Setting and seeing them

- **Set them:** the stop editor's tag picker, in two labelled groups: *What it
  is* (the twelve categories, in the table's order) and *Needs* (Ticketed).
  Click to toggle any number on. However they are clicked, the saved array is in
  contract order, because stop equality compares tags in order.
- **See them:** a chip per tag on the stop's block, each in its own colour
  (`TAG_CHIP_CLASS` in `lib/activityTags.ts`; the nine new tags have their own
  `tag-<key>` tokens, see `docs/guidelines/design-system.md` "Tag colours").

### Spend charts

*Spend by tag* (a pie) and *Spend by day* (stacked bars) split money by
**category only**. A stop with several categories is counted once, under its
first in contract order. Ticketed is never a slice or a stack: a stop tagged
Ticketed and Museum is counted under Museum, and a stop tagged only Ticketed is
counted as **Untagged**. *Spend by day* filtered to Ticketed stacks those stops
by category.

## Tag focus: click a chip to spotlight it

One tag can be **focused** at a time, from any stop's chip, across the lenses:

- **Plan and Map:** every stop not carrying the focused tag dims to 32%
  opacity. Nothing is hidden: the shape of the day and the trip stays visible.
- **Calendar:** a city card instead shows `N of M match`; a card with **no**
  matching stop dims to 0.28 (the card, not individual stops).
- A line beside the view tabs names the active focus with a **Clear** control.
- Clicking the same chip again clears focus. Only one tag is ever focused;
  there is no multi-select for focus (there is for setting tags).

There is no filter row and no "show everything" toggle: the chip **is** the
control.

## Where this lives in code

- Contract: `ActivityKind`, `ActivityTag`, `ActivityTagCategory`,
  `ActivityTagModifier`:
  [`packages/contracts/src/activity.ts`](../../packages/contracts/src/activity.ts)
- Labels: `KIND_LABEL`, `TAG_LABEL`:
  [`packages/pages/src/enumLabels.ts`](../../packages/pages/src/enumLabels.ts)
- Picker groups, chip colours, toggling and focus dimming:
  [`apps/web/src/lib/activityTags.ts`](../../apps/web/src/lib/activityTags.ts)
- Editor: [`ActivityEditor.tsx`](../../apps/web/src/components/board/ActivityEditor.tsx);
  chips: [`StopTagChips.tsx`](../../apps/web/src/components/board/StopTagChips.tsx)
- Spend series and their colours:
  [`spendSeries.ts`](../../packages/pages/src/macros/primitives/spendSeries.ts),
  [`spendColors.ts`](../../apps/web/src/components/pages/blocks/spendColors.ts)
- Tag focus state: `FocusProvider`; the line beside the tabs: `TagFocusLine.tsx`
- Decisions: ADR-054 (three kinds), ADR-055 (pending reason), ADR-070 (the
  thirteen tags); history in
  [`docs/milestones/M18-stop-kind.md`](../milestones/M18-stop-kind.md) and
  [`docs/milestones/M18b-tag-focus.md`](../milestones/M18b-tag-focus.md)
- Contract changelog: `docs/contracts/CHANGELOG.md`, 2026-08-27 (*M18: activity
  kind & tags*) and 2026-10-11 (*`ActivityTag` has thirteen values*)
