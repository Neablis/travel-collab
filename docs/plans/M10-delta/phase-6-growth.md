# Phase 6 — Growing the trip

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first.
>
> **Phases 0, 1 and 3 must be merged** — the empty-day copy references dropping
> onto a day, which is Phase 3's drag work.

**Goal:** a trip can grow. "Add a day" is real, every view renders an empty day
honestly, and "Add a saved day" moves out of the header into the plan flow.

**Gate for this phase:** adding a day appends it, scrolls to it, and it renders
correctly in Timeline, Day columns, Calendar and Map.

---

## Copy, verbatim from the design — do not paraphrase any of these

| where | string |
|---|---|
| end-of-trip title | `End of the trip` |
| end-of-trip body | `Add another day, or drop in a day you have already planned — the times reflow to fit.` |
| trailing day column | `One more day?` |
| timeline empty day (the day's route line) | `No stops yet — add one, or drop a saved day onto it` |
| timeline empty day (the day's summary) | `Nothing planned yet` |
| calendar empty day | `Nothing planned yet` |
| map rail empty day | `Nothing planned yet` |
| map focus card, empty day | `No stops yet` |
| add-at-end row, day with stops | `Add a stop after {last end time}` |
| add-at-end row, empty day | `Add the first stop` |
| gap fill row | `Add something at {time}` |
| day-columns add button, near the rack | `or drop a stop from Unscheduled` |

**Design values:** the trailing "One more day?" column is 15px/600 `--color-ink`
in a dashed column matching the day columns' 268px width. The per-day add row is
`1px dashed --color-border-strong`, `border-radius: 8px`, `padding: 8px`, 13px
`--color-slate` — the same treatment as the existing per-column `+ Add` button
(`Column.tsx:125-135`), which is already correct and should be the reference.

---

## What is real and what is Preview

- **`AddDay` is a real command** — `TripBoardScreen.tsx:192` already dispatches it
  (`{ type: "AddDay", tripId, dayId: crypto.randomUUID() }`). Adding a day is a
  genuine build. (Corrected 2026-08-22: this cited `Board.tsx:158`, which is
  past that file's end and never held the dispatch — `Board.tsx` only takes an
  `onAddDay` callback, typed at line 20 and wired to the button at line 148.)
- **Days holding zero stops are already valid** in the projection. The empty-day
  renderings are honest, not shells.
- **"Add a saved day" and the three Playbook shortcuts are M11.** The
  `insert-playbook` Preview id already exists in the registry (Wave 1 created it
  and the Wave-1 retro notes nothing currently opens it). This phase finally
  gives it a trigger — inside a `<Preview>`, still inert.

---

## Task 6.1: End-of-trip block, real "Add a day", and empty days everywhere

**Files:**
- Create: `apps/web/src/components/trip/EndOfTrip.tsx`, `EndOfTrip.test.tsx`
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx`
- Modify: `apps/web/src/components/board/Board.tsx`, `Column.tsx`
- Modify: `apps/web/src/components/lenses/CalendarLens.tsx`
- Modify: `apps/web/src/components/lenses/MapRail.tsx`, `MapFocusCard.tsx` (if Phase 2 is merged)
- Modify: `apps/web/src/components/trip/TripHeader.tsx` (remove `AddSavedDayButton`, if Phase 1 did not)

**Interfaces:**

```tsx
<EndOfTrip onAddDay={() => void} />
```

`EndOfTrip` renders the title, the body, a real "Add a day" button, and — inside
`<Preview id="insert-playbook" size="container">` — an "Add a saved day" button
and up to three Playbook shortcut cards fed from the existing
`components/playbooks/preview-fixtures.ts`.

- [ ] **Step 1: Write the failing tests**

```tsx
// EndOfTrip.test.tsx
it("offers a real Add a day and an inert Add a saved day", async () => {
  const onAddDay = vi.fn();
  render(<EndOfTrip onAddDay={onAddDay} />);

  expect(screen.getByText("End of the trip")).toBeTruthy();
  expect(
    screen.getByText("Add another day, or drop in a day you have already planned — the times reflow to fit."),
  ).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Add a day" }));
  expect(onAddDay).toHaveBeenCalledTimes(1);
});
```

```tsx
// TimelineLens.test.tsx
it("ends the plan with the end-of-trip block", () => {
  renderTimeline(detailWithTwoDays);
  expect(screen.getByText("End of the trip")).toBeTruthy();
});

it("renders an empty day honestly rather than as a gap", () => {
  renderTimeline(detailWithEmptyDay);
  expect(screen.getByText("No stops yet — add one, or drop a saved day onto it")).toBeTruthy();
  expect(screen.getByText("Nothing planned yet")).toBeTruthy();
});

it("offers to add a stop after the day's last one", () => {
  renderTimeline(detailWithDayEndingAt("21:00"));
  expect(screen.getByRole("button", { name: "Add a stop after 9 pm" })).toBeTruthy();
});

it("offers to add the first stop on an empty day", () => {
  renderTimeline(detailWithEmptyDay);
  expect(screen.getByRole("button", { name: "Add the first stop" })).toBeTruthy();
});
```

```tsx
// CalendarLens.test.tsx
it("says nothing is planned on an in-trip day with no stops", () => {
  renderCalendar(detailWithEmptyDay);
  expect(screen.getByText("Nothing planned yet")).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

1. `EndOfTrip.tsx` — to the copy table above. `onAddDay` is wired in
   `TripBoardScreen` to the same `AddDay` dispatch `TripBoardScreen.tsx:192`
   already uses,
   followed by scrolling the new day into view (the timeline already keeps
   `headerRefs`; append and scroll the last one).
2. Render `<EndOfTrip>` after the last day in `TimelineLens`.
3. Per-day add row: a dashed button at the end of each day's stops, labelled from
   the table, calling `openCreate({ dayId, timeWindow: nextSlot(row) })` — the
   existing `nextSlot` helper (`TimelineLens.tsx:76-80`) already computes exactly
   this. On an empty day it prefills 09:00.
4. Gap fill row: where a leg already carries the "Nothing planned" pill (Phase 8
   Task 8.1 introduces that threshold), add an inline
   `Add something at {gap start}` button calling `openCreate` with that time.
   **If Phase 8 has not landed yet, skip this bullet and do it there** — do not
   invent a second threshold.
5. Empty-day renderings in all four views, using the copy table. In `Board`, add
   the trailing dashed "One more day?" column with the same two actions and
   **delete** the loose `+ Add day` button (`Board.tsx:148-150`).
6. In `Column.tsx`, add the `or drop a stop from Unscheduled` hint beside the
   `+ Add` button.
7. If Phase 1 left `<AddSavedDayButton />` in `TripHeader`, remove it now — the
   design moved it here. Keep the component file; `EndOfTrip` uses the same
   `insert-playbook` Preview id.

- [ ] **Step 4: Run tests; verify in the browser**

Add a day on the seeded trip: it appends, dated the day after the last, and the
view scrolls to it. Check it renders in all four views. Confirm the registry↔usage
test still passes (`insert-playbook` now has a real trigger).

- [ ] **Step 5: Run the phase gate and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components docs/known-issues.md
git commit -m "feat(web): end-of-trip block, real add-a-day, and empty-day states in every view"
```

---

## Phase 6 exit checklist

- [ ] "Add a day" appends a real day and scrolls to it.
- [ ] An empty day renders with the design's copy in Timeline, Day columns,
      Calendar and Map — never as a blank gap.
- [ ] Every day offers "Add a stop after {time}" / "Add the first stop".
- [ ] The trailing "One more day?" column replaces the loose `+ Add day` button.
- [ ] "Add a saved day" is gone from the header and present in the plan flow,
      still inside `<Preview id="insert-playbook">`.
- [ ] All copy matches the table above **exactly**.
