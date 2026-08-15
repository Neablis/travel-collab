# Phase 3 — The unscheduled rack

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first — its
> **Global Constraints** section applies to every task here.
>
> **Phases 0 and 1 must be merged before starting this phase** — the rack's
> clearance offsets assume Phase 1's final header, and its drag behaviour
> assumes Phase 0's non-blocking scrim.

**Goal:** the design's sticky bottom "Unscheduled" drawer, replacing the
full-width Backlog strip that currently sits above the day columns.

**Gate for this phase:** a stop can be dragged out of a day into the rack and
back, times are stripped on the way out and fitted on the way in, and both
directions undo with the existing history controls.

---

## Background

This is a **real feature build on a real store**, not a shell. `trip.backlog`
already exists (`packages/contracts/src/detail.ts:35`), and
`MoveActivity(activityId, toDayId, position)` already moves in both directions —
`toDayId: null` means the backlog. `Board.tsx:116-127` already renders a Backlog
`<Column>`; this phase retires it.

**Design values, verbatim from `current/…dc.html:671-707`:**

| element | value |
|---|---|
| drawer (`data-bldrop="1"`) | `position: sticky; bottom: 0; z-index: 20; margin-top: auto`, `--color-surface`, `border-top: 1px solid --color-hairline`, upward shadow. Present in **every** view |
| toggle row | `display: flex; align-items: center; gap: 12px; padding: 9px 26px` |
| caret | 13px, `--color-slate`, `width: 11px` |
| toggle label | 11.5px `--color-slate` — "Show" / "Hide" |
| section label | 12px, weight 600, `letter-spacing: 0.04em`, uppercase, `--color-slate` — "Unscheduled" |
| count | a `Badge variant="neutral"` |
| hint | 12px `--color-slate`, beside the toggle |
| card row | `display: flex; gap: 10px; overflow-x: auto; padding: 0 26px 14px` |
| card (`data-blstop`) | `flex: 0 0 208px`, `cursor: grab`, `touch-action: none`, `border-radius: 12px`; inside it a DS `Card` with `rounded-lg p-3 flex flex-col gap-2 h-full` |
| card title | 13.5px, weight 600, `--color-ink`, `line-height: 1.3` |
| card area | 12px `--color-slate`, `margin-top: 2px` |
| card provenance | 11.5px `--color-slate` |
| card select | full-width `NativeSelect`, first option `"Add to day…"` with `value=""` |
| empty state | `flex: 1; min-width: 240px`, `1px dashed --color-border-strong`, `border-radius: 12px`, `padding: 16px`, 12.5px `--color-slate` |

**Empty-state copy, verbatim — do not paraphrase:**

> Nothing parked. Drag a stop down here to take it off the schedule without
> losing it.

**Collapsed by default.**

**Behaviour from the handoff's written notes:**

- The drawer is a **drop target and a drag source**.
- Dragging any scheduled stop **opens the drawer automatically**; a drawer opened
  that way closes again if the drag ends elsewhere. Escape cancels and closes.
- While a dragged stop is over the drawer, the drag proxy **cross-fades** into the
  compact card treatment (title, area, "No time yet") and back out on leave — a
  cross-fade, **not** a transform, because the proxy already owns its transform.
- Hit detection is a **full-rect test** against the drawer.
- **Scheduling from the rack sets real times:** 1 h default; a gap under 8 h gets
  30 min of air on each side; tighter gaps keep whatever is left, floor 15 min.
- **Unscheduling strips the times** and tags the card "Was on Day X".
- Both directions go through the same undo history as every other mutation.

**Provenance is not modelled.** There is no field recording who added a stop or
which day it came from. The provenance line and the "Was on Day X" tag both go
inside one `<Preview id="rack-provenance" size="compact">`.

---

## Task 3.1: `fitIntoDay` — the time-fitting rule

**Files:**
- Create: `apps/web/src/lib/time.ts`
- Create: `apps/web/src/components/trip/unscheduledRack.ts`, `unscheduledRack.test.ts`
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx` (import move only)

**Interfaces:**

```ts
// apps/web/src/lib/time.ts — moved verbatim from TimelineLens.tsx:55-67
export function toMinutes(time: string): number;
export function toTimeString(minutes: number): string;

// apps/web/src/components/trip/unscheduledRack.ts
export type Slot = { start: string; end: string };
export function fitIntoDay(existing: Slot[], preferredStart?: string): Slot;
```

**The rule, precisely.** `existing` is the day's already-scheduled windows (order
does not matter; sort internally). Find the first gap that can hold the new stop,
searching from `preferredStart` if given, else from the end of the last window,
else from 09:00 on an empty day. Then:

- Target duration is **60 min**.
- If the chosen gap is **< 8 h**, reserve **30 min of air on each side**, so the
  stop needs `gap >= 60 + 60 = 120` min to keep its full hour.
- If the gap is tighter than that, keep whatever is left after the air, with a
  **floor of 15 min**.
- Never return an inverted or zero-length window.

- [ ] **Step 1: Move `toMinutes` / `toTimeString`**

They live at `TimelineLens.tsx:55-67`. Move both verbatim into
`apps/web/src/lib/time.ts` and import them back. Phase 7 and Phase 5 both need
them too — this is why they move now rather than being copied.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { fitIntoDay } from "./unscheduledRack";

describe("fitIntoDay", () => {
  it("gives a full hour at the preferred start on an empty day", () => {
    expect(fitIntoDay([], "14:00")).toEqual({ start: "14:00", end: "15:00" });
  });

  it("defaults to 09:00 on an empty day with no preference", () => {
    expect(fitIntoDay([])).toEqual({ start: "09:00", end: "10:00" });
  });

  it("keeps a full hour with 30 minutes of air each side in a comfortable gap", () => {
    // 09:00-10:00 booked, then free until 20:00 — an 10h gap.
    const slot = fitIntoDay([{ start: "09:00", end: "10:00" }]);
    expect(slot.start).toBe("10:30");
    expect(slot.end).toBe("11:30");
  });

  it("shrinks toward the 15-minute floor when the gap is tight", () => {
    // 09:00-10:00 and 10:45-12:00 leaves a 45-minute gap.
    const slot = fitIntoDay([{ start: "09:00", end: "10:00" }, { start: "10:45", end: "12:00" }], "10:00");
    const minutes = Number(slot.end.slice(0, 2)) * 60 + Number(slot.end.slice(3)) -
                    (Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3)));
    expect(minutes).toBeGreaterThanOrEqual(15);
    expect(slot.start >= "10:00").toBe(true);
    expect(slot.end <= "10:45").toBe(true);
  });

  it("never returns an inverted window on a fully booked day", () => {
    const packed = Array.from({ length: 12 }, (_, i) => ({
      start: `${String(8 + i).padStart(2, "0")}:00`,
      end: `${String(9 + i).padStart(2, "0")}:00`,
    }));
    const slot = fitIntoDay(packed);
    expect(slot.end > slot.start).toBe(true);
  });

  it("is unaffected by the order of the existing windows", () => {
    const a = fitIntoDay([{ start: "09:00", end: "10:00" }, { start: "14:00", end: "15:00" }]);
    const b = fitIntoDay([{ start: "14:00", end: "15:00" }, { start: "09:00", end: "10:00" }]);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Run, implement, re-run**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/trip/unscheduledRack.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/time.ts apps/web/src/components/trip/unscheduledRack.ts apps/web/src/components/trip/unscheduledRack.test.ts apps/web/src/components/lenses/TimelineLens.tsx
git commit -m "feat(web): time-fitting rule for scheduling from the unscheduled rack"
```

---

## Task 3.2: The drawer

**Files:**
- Create: `apps/web/src/components/trip/UnscheduledRack.tsx`, `UnscheduledRack.test.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx`
- Modify: `apps/web/src/lib/preview-registry.ts`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

```tsx
export type RackItem = { activityId: string; title: string; area: string | null };

<UnscheduledRack
  items={RackItem[]}
  dayOptions={{ value: string; label: string }[]}   // value = dayId
  open={boolean}
  onToggle={() => void}
  onAssign={(activityId: string, dayId: string) => void}
/>
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnscheduledRack } from "./UnscheduledRack";

afterEach(cleanup);

const items = [
  { activityId: "a1", title: "Souvenir shopping", area: "Rochester" },
  { activityId: "a2", title: "Second breakfast", area: null },
];
const dayOptions = [{ value: "d1", label: "Day 1 · Sep 5" }, { value: "d2", label: "Day 2 · Sep 6" }];

function renderRack(over: Partial<React.ComponentProps<typeof UnscheduledRack>> = {}) {
  return render(
    <UnscheduledRack items={items} dayOptions={dayOptions} open={false} onToggle={vi.fn()} onAssign={vi.fn()} {...over} />,
  );
}

describe("UnscheduledRack", () => {
  it("is collapsed by default, showing the label and the count", () => {
    renderRack();

    expect(screen.getByText("Unscheduled")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("Souvenir shopping")).toBeNull();
  });

  it("toggles when the bar is clicked", async () => {
    const onToggle = vi.fn();
    renderRack({ onToggle });

    await userEvent.click(screen.getByRole("button", { name: /unscheduled/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("lists one card per parked stop when open", () => {
    renderRack({ open: true });

    expect(screen.getByText("Souvenir shopping")).toBeTruthy();
    expect(screen.getByText("Second breakfast")).toBeTruthy();
  });

  it("shows the design's empty state when nothing is parked", () => {
    renderRack({ open: true, items: [] });

    expect(
      screen.getByText("Nothing parked. Drag a stop down here to take it off the schedule without losing it."),
    ).toBeTruthy();
  });

  it("assigns a stop to the chosen day", async () => {
    const onAssign = vi.fn();
    renderRack({ open: true, onAssign });

    const selects = screen.getAllByRole("combobox", { name: "Add to day" });
    await userEvent.selectOptions(selects[0], "d2");

    expect(onAssign).toHaveBeenCalledWith("a1", "d2");
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement the component** to the values in the table above.

The `flex: 0 0 208px` card width and the sticky bottom offset are computed
geometry — inline `style` plus the standard eslint-disable comment. The
provenance line goes inside `<Preview id="rack-provenance" size="compact">`;
register it:

```ts
  'rack-provenance': { milestone: 'M11', wiredUpBy: 'Who parked a stop, and which day it came from — no field models either' },
```

Match the registry's existing value shape exactly — read the file first.

- [ ] **Step 4: Mount it and wire `onAssign` for real**

In `TripBoardScreen.tsx`, mount the rack once, outside the lens switch (like
`ActivityEditorSheet`), so it is present in every view. `items` comes from
`activeTrip.backlog` mapped through `activeTrip.activities`; `area` is
`activity.location?.city ?? activity.location?.name ?? null`.

`onAssign` is **two dispatches**, in this order:

```tsx
const assignFromRack = (activityId: string, dayId: string) => {
  const day = activeTrip.days.find((d) => d.dayId === dayId);
  if (day === undefined) return;

  const existing = day.activityIds
    .map((id) => activeTrip.activities[id]?.timeWindow)
    .filter((w): w is { start: string; end: string } => w !== null && w !== undefined);

  void dispatch({ type: "MoveActivity", tripId, activityId, toDayId: dayId, position: day.activityIds.length });
  void dispatch({ type: "UpdateActivity", tripId, activityId, timeWindow: fitIntoDay(existing) });
};
```

Both go through `dispatch`, so both land in the existing undo history — which is
the design's "same undo history as every other mutation" requirement, for free.

- [ ] **Step 5: Run tests, verify in the browser**

On the seeded trip, "Souvenir shopping" appears in the rack. Assign it to Day 2:
it lands with a real time window, and the existing Undo control reverses it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/trip/UnscheduledRack.tsx apps/web/src/components/trip/UnscheduledRack.test.tsx apps/web/src/components/board/TripBoardScreen.tsx apps/web/src/lib/preview-registry.ts apps/web/src/app/globals.css
git commit -m "feat(web): sticky unscheduled rack backed by trip.backlog"
```

---

## Task 3.3: Drag both ways; retire the old backlog strip

**Files:**
- Modify: `apps/web/src/components/trip/UnscheduledRack.tsx`
- Modify: `apps/web/src/components/board/Board.tsx`, `Column.tsx`
- Test: `apps/web/src/components/board/board.test.tsx`

**Drag-and-drop facts from the existing code** (`ActivityCard.tsx:31-50`):

- A card is `draggable({ element, getInitialData: () => ({ activityId }) })`.
- A card is also a `dropTargetForElements` returning
  `attachClosestEdge({ cardActivityId, dayId }, …)`.
- `Board.tsx:53-81` holds a single `monitorForElements({ onDrop })` that reads
  `location.current.dropTargets[0]` (innermost first) and calls
  `callbacks.onMove(activityId, toDayId, position)`.

So the rack needs: `dropTargetForElements` with `getData: () => ({ rack: true })`,
`draggable` on each card, and a new branch in Board's existing `onDrop`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("unschedules a stop dropped on the rack, stripping its times", async () => {
  const { onMove, onUpdateActivity } = renderBoardWithRack();     // this file's helper style

  await dropOnRack("activity-1");

  expect(onMove).toHaveBeenCalledWith("activity-1", null, expect.any(Number));
  expect(onUpdateActivity).toHaveBeenCalledWith("activity-1", expect.objectContaining({ timeWindow: null }));
});

it("opens the drawer while a stop is being dragged", async () => {
  renderBoardWithRack();

  await startDrag("activity-1");

  expect(screen.getByText("Souvenir shopping")).toBeTruthy();
});

it("re-closes a drawer it opened itself when the drag ends elsewhere", async () => {
  renderBoardWithRack();

  await startDrag("activity-1");
  await dropOnDay("day-2");

  expect(screen.queryByText("Souvenir shopping")).toBeNull();
});
```

`board.test.tsx` already drives pragmatic-drag-and-drop in tests — **read how it
simulates a drag before writing `dropOnRack` / `startDrag`** and reuse that
mechanism. Do not invent a new one.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

1. Register the drawer as a drop target; each card as a `draggable` carrying
   `{ activityId }`.
2. In `Board.tsx`'s `onDrop`, add a branch before the existing ones: if the
   target's data has `rack === true`, call a new
   `callbacks.onUnschedule(activityId)` rather than `onMove`. Implement
   `onUnschedule` in `TripBoardScreen` as `MoveActivity(toDayId: null)` **plus**
   `UpdateActivity({ timeWindow: null })` — the design's "unscheduling strips the
   times".
3. Auto-open: in the same `monitorForElements`, add `onDragStart` to open the
   drawer, recording that *it* opened it; on `onDrop` and on cancel, close it
   again only if it was auto-opened. Escape cancels — pragmatic-drag-and-drop
   already fires its cancel path on Escape, so hook that rather than adding a
   key listener.
4. Cross-fade the drag proxy over the drawer: swap the proxy's rendered content
   with a CSS opacity transition. **Do not add a transform** — the library owns
   the proxy's transform and fighting it produces a jumping ghost.
5. **Delete** the full-width Backlog `<Column>` and its primary
   "+ Add activity" button (`Board.tsx:114-127`). The rack replaces it. Keep
   `openCreate()` reachable — the header's "Add stop" already calls it.
6. **Remove the drag target highlight**: `Column.tsx:103`'s
   `isOver && "bg-brand-tint"`, and the now-unused `isOver` state and its
   `onDragEnter`/`onDragLeave` handlers. The design keeps only the insertion line
   and the floating time chip.

- [ ] **Step 4: Run tests; verify in the browser**

Drag a stop from Day 1 into the rack — the drawer opens as the drag starts, the
proxy becomes a compact card over it, and dropping strips the times. Drag it back
onto a day. Undo reverses each.

- [ ] **Step 5: Run the phase gate and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components/trip/UnscheduledRack.tsx apps/web/src/components/board/Board.tsx apps/web/src/components/board/Column.tsx apps/web/src/components/board/board.test.tsx apps/web/src/components/board/TripBoardScreen.tsx
git commit -m "feat(web): drag stops into and out of the unscheduled rack"
```

---

## Phase 3 exit checklist

- [ ] The drawer is present in all four views, collapsed by default, with a live count.
- [ ] "Add to day…" schedules with a real fitted time window.
- [ ] Dragging a stop onto the rack unschedules it and clears its times.
- [ ] The drawer auto-opens on drag start and re-closes if the drag ends elsewhere.
- [ ] The old full-width Backlog strip and its primary button are gone.
- [ ] The day-column drag highlight is gone; only the insertion line remains.
- [ ] Both directions undo with the existing history controls.
- [ ] `rack-provenance` is registered and the registry↔usage test is green.
