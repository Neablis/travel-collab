# Stop kind and tags

Two fields on every activity ("stop"), shipped in M18 (kind + tags chips) and
M18b (tag focus). Set them from the stop editor; they drive badges, chips, a
few counts, and a cross-lens focus control.

## Kind — what the stop is, and how firm

One of five values: `booked`, `hold`, `idea`, `transit`, `planned` (the
default — every stop starts here and it renders no badge at all).

- **Set it:** the stop editor's "Kind" dropdown — *"What this stop is, and how
  firm. It shows as the badge on the card."*
- **See it:** the card badge — **Booked** / **Holding** / **Idea** / **Travel**.
  `planned` shows nothing.
- **It drives:**
  - Calendar's **`N to book`** count per city card — every stop whose kind is
    neither `booked` nor `transit`.
  - The home hero's **"N not booked"** tile.

## Tags — what kind of stop it is

Four values, multi-select: `meal`, `lodging`, `ticketed`, `outdoors` (labels:
Meal / Lodging / Ticketed / Outdoors). The design handoff specifies six; two
were deliberately dropped because they'd restate kind (`considering` ≈
`kind: idea`, `travel` ≈ `kind: transit`) — see
[KI-52](../known-issues/open/KI-052-tag-chip-row-ships-four-tags.md).

- **Set them:** the stop editor's tag chips — click to toggle any number on.
- **See them:** chips on the stop card.

## Tag focus — click a chip to spotlight it

One tag can be **focused** at a time, from any stop's chip, across all four
lenses:

- **Timeline, Day columns, Map:** every stop not carrying the focused tag dims
  to 32% opacity. Nothing is hidden — the shape of the day/trip stays visible.
- **Calendar:** a city card instead shows `N of M match`; a card with **no**
  matching stop dims to 0.28 (the card, not individual stops).
- A line beside the view tabs names the active focus with a **Clear** control.
- Clicking the same chip again clears focus. Only one tag is ever focused —
  there's no multi-select for focus (there is for setting tags themselves).

There's no filter row and no "show everything" toggle — those were removed by
design; the chip **is** the control.

## Where this lives in code

- Contract: `ActivityKind` / `ActivityTag` enums —
  [`packages/contracts/src/activity.ts`](../../packages/contracts/src/activity.ts)
- Editor pickers: [`ActivityEditor.tsx`](../../apps/web/src/components/board/ActivityEditor.tsx)
- Card badge/chips: [`ActivityCard.tsx`](../../apps/web/src/components/board/ActivityCard.tsx)
- Tag focus state: `FocusProvider`; per-lens dimming in each lens component
- Full build history and the decisions behind the details above:
  [`docs/milestones/M18-stop-kind.md`](../milestones/M18-stop-kind.md),
  [`docs/milestones/M18b-tag-focus.md`](../milestones/M18b-tag-focus.md)
- Contract changelog entry: `docs/contracts/CHANGELOG.md`, 2026-08-27 —
  "M18: activity kind & tags"
