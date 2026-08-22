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
- Create: `apps/web/src/components/board/resolveDrop.ts`, `resolveDrop.test.ts`
- Create: `apps/web/src/components/trip/rackDisclosure.ts`, `rackDisclosure.test.ts`
- Create: `apps/web/e2e/m10-unscheduled-rack.spec.ts`
- **Not** `board.test.tsx` — see "Where this task's tests go" below.

**Drag-and-drop facts from the existing code** (`ActivityCard.tsx:31-50`):

- A card is `draggable({ element, getInitialData: () => ({ activityId }) })`.
- A card is also a `dropTargetForElements` returning
  `attachClosestEdge({ cardActivityId, dayId }, …)`.
- `Board.tsx:53-81` holds a single `monitorForElements({ onDrop })` that reads
  `location.current.dropTargets[0]` (innermost first) and calls
  `callbacks.onMove(activityId, toDayId, position)`.

So the rack needs: `dropTargetForElements` with `getData: () => ({ rack: true })`,
`draggable` on each card, and a new branch in Board's existing `onDrop`.

---

### Where this task's tests go, and why — read before writing any test

**An earlier draft of this task told you to reuse a drag simulation in
`board.test.tsx`. There isn't one, and there cannot usefully be one.** Corrected
2026-08-22 against the tree; the evidence, so you don't have to re-derive it:

- `board.test.tsx` is 199 lines and contains **zero** drag simulation. Its only
  `drop`-shaped lines are CSS assertions about a column's drop list.
- Repo-wide, the only drag simulation is `dragCardTo` in `apps/web/e2e/helpers.ts`
  — **Playwright, against real Chromium**. Six e2e specs use it. No jsdom drag
  harness exists anywhere.
- `@atlaskit/pragmatic-drag-and-drop@2.0.1`'s element adapter binds the **native**
  `dragstart` (`dist/es2019/adapter/element-adapter.js:31`), returns immediately
  if `!event.dataTransfer` (line 48), and then calls `event.dataTransfer.setData`
  (lines 173, 211) and reads `event.dataTransfer.types` (line 187).
- **jsdom 29.1.1 — the version this repo runs — has neither.** Verified:
  `window.DataTransfer` is `undefined`, `window.DragEvent` is `undefined`, and
  `new window.DragEvent(...)` throws `is not a constructor`.

So a jsdom drag test would mean hand-building `DragEvent` **and** a `DataTransfer`
stub with working `setData`/`getData`/`types` — fabricating the browser substrate
the library sits on, then asserting against the fabrication. `vitest.setup.ts`
already forbids exactly this, in its own words:

> *"The IntersectionObserver fixture this replaces did the opposite — it fed
> fabricated per-scroll positions that no real browser ever delivers, which is
> why the suite passed while the feature was broken. Do not reintroduce that."*

That is the map-rail retro's lesson, and it applies here unchanged: a green jsdom
drag suite would be **evidence of nothing**. This is not a judgement call between
two workable designs — one of them does not work — so no check-in is needed
before proceeding. **Split the task by layer instead:**

| What | Layer | Where |
|---|---|---|
| Which callback a drop resolves to (rack vs. day vs. card-edge, and the same-list index correction) | pure function, no DOM | `board/resolveDrop.ts` + `.test.ts` (unit) |
| Whether the drawer should re-close after a drag (auto-open ownership) | pure reducer, no DOM | `trip/rackDisclosure.ts` + `.test.ts` (unit) |
| Rendering, count, empty state, "Add to day…" | jsdom | `UnscheduledRack.test.tsx` (Task 3.2, already written) |
| The drag itself — into the rack, back out, auto-open, Escape-cancel | **real browser** | `e2e/m10-unscheduled-rack.spec.ts` (new) |

The two pure modules are where the actual bugs in this task will live. Extracting
them is not test-ceremony — it is what makes the logic checkable at all.

- [ ] **Step 1: Extract the drop routing, and unit-test it**

Move `listFor` (`Board.tsx:28-32`) and `containerOf` (`Board.tsx:34-37`) into a
new `apps/web/src/components/board/resolveDrop.ts` together with the body of the
existing `onDrop`, as one pure function. Board's `monitorForElements` then
becomes a thin adapter that calls it and dispatches the result.

```ts
// apps/web/src/components/board/resolveDrop.ts
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { TripDetail } from "@tc/contracts";

export type DropOutcome =
  | { kind: "unschedule"; activityId: string }
  | { kind: "move"; activityId: string; toDayId: string | null; position: number };

/**
 * Pure resolution of a pragmatic-drag-and-drop drop into the mutation it means.
 * `targetData` is `location.current.dropTargets[0].data` — innermost target
 * first. Returns null when the drop is a no-op (no activity, no target).
 *
 * This is separated from the monitor deliberately: pdnd is driven by native
 * HTML5 drag events that jsdom cannot produce (no DataTransfer, no DragEvent),
 * so the routing decision is only checkable if it does not need a drag to run.
 */
export function resolveDrop(
  trip: TripDetail,
  sourceData: Record<string, unknown>,
  targetData: Record<string, unknown> | undefined,
): DropOutcome | null;
```

Tests — these are the real coverage for this task:

```ts
import { describe, expect, it } from "vitest";
import { resolveDrop } from "./resolveDrop";

// Build with this file's existing fixture style; day-1 holds a1,a2 and day-2 holds a3.
const trip = fixture();

describe("resolveDrop", () => {
  it("routes a drop on the rack to unschedule", () => {
    expect(resolveDrop(trip, { activityId: "a1" }, { rack: true })).toEqual({
      kind: "unschedule",
      activityId: "a1",
    });
  });

  it("appends when dropped on a day column", () => {
    expect(resolveDrop(trip, { activityId: "a3" }, { dayId: "day-1" })).toEqual({
      kind: "move", activityId: "a3", toDayId: "day-1", position: 2,
    });
  });

  it("inserts before a card when the closest edge is the top", () => {
    const target = { cardActivityId: "a2", dayId: "day-1", ...topEdge() };
    expect(resolveDrop(trip, { activityId: "a3" }, target)).toMatchObject({ position: 1 });
  });

  it("corrects the index when moving down within the same list", () => {
    // a1 (index 0) dropped below a2 (index 1): naive insert is 2, but removing
    // a1 first shifts everything left, so the correct position is 1.
    const target = { cardActivityId: "a2", dayId: "day-1", ...bottomEdge() };
    expect(resolveDrop(trip, { activityId: "a1" }, target)).toMatchObject({ position: 1 });
  });

  it("does not correct the index when moving between lists", () => {
    const target = { cardActivityId: "a2", dayId: "day-1", ...bottomEdge() };
    expect(resolveDrop(trip, { activityId: "a3" }, target)).toMatchObject({ position: 2 });
  });

  it("is a no-op without an activity id or without a target", () => {
    expect(resolveDrop(trip, {}, { rack: true })).toBeNull();
    expect(resolveDrop(trip, { activityId: "a1" }, undefined)).toBeNull();
  });

  it("prefers the rack over a day id on the same target", () => {
    // Guards the branch order: the rack check must come first, so a rack
    // target that also carries a stale dayId still unschedules.
    expect(resolveDrop(trip, { activityId: "a1" }, { rack: true, dayId: "day-1" })).toMatchObject({
      kind: "unschedule",
    });
  });
});
```

`topEdge()`/`bottomEdge()` must produce whatever `attachClosestEdge` writes onto
the data object, so that `extractClosestEdge` reads it back. Build them by
calling `attachClosestEdge` itself rather than hand-writing its internal symbol
key — that key is private and will change under you.

- [ ] **Step 2: Extract the drawer's auto-open ownership, and unit-test it**

The rule "auto-open on drag start; re-close afterwards **only if the drag opened
it**" is a state machine, and it is the part most likely to be wrong. Keep it out
of the component:

```ts
// apps/web/src/components/trip/rackDisclosure.ts
export type RackDisclosure = { open: boolean; openedByDrag: boolean };
export type RackEvent = { type: "toggle" } | { type: "dragStart" } | { type: "dragEnd" };

export function rackDisclosure(state: RackDisclosure, event: RackEvent): RackDisclosure;
```

```ts
const shut = { open: false, openedByDrag: false };

it("opens on drag start and records that the drag opened it", () => {
  expect(rackDisclosure(shut, { type: "dragStart" })).toEqual({ open: true, openedByDrag: true });
});

it("re-closes a drawer the drag opened", () => {
  const dragged = rackDisclosure(shut, { type: "dragStart" });
  expect(rackDisclosure(dragged, { type: "dragEnd" })).toEqual(shut);
});

it("leaves a drawer the user opened alone", () => {
  const byUser = rackDisclosure(shut, { type: "toggle" });
  const dragged = rackDisclosure(byUser, { type: "dragStart" });
  expect(rackDisclosure(dragged, { type: "dragEnd" })).toEqual({ open: true, openedByDrag: false });
});

it("hands ownership to the user if they toggle mid-drag", () => {
  const dragged = rackDisclosure(shut, { type: "dragStart" });
  const kept = rackDisclosure(dragged, { type: "toggle" });
  expect(rackDisclosure(kept, { type: "dragEnd" }).open).toBe(true);
});
```

Escape needs no separate event: pragmatic-drag-and-drop fires its normal
`onDrop`/cancel path on Escape, so wire both to `dragEnd`. **Do not add a key
listener** — the third test above is what proves the cancel path re-closes
correctly.

- [ ] **Step 3: Run both unit suites and confirm they fail**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/board/resolveDrop.test.ts src/components/trip/rackDisclosure.test.ts
```

- [ ] **Step 4: Implement**

1. Register the drawer as a drop target; each card as a `draggable` carrying
   `{ activityId }`.
2. Reduce `Board.tsx`'s `onDrop` to a thin adapter over Step 1's
   `resolveDrop`: read `source.data` and `location.current.dropTargets[0]?.data`,
   call `resolveDrop`, and switch on the outcome — `move` to
   `callbacks.onMove`, `unschedule` to a new `callbacks.onUnschedule`. **No
   routing logic stays in the monitor**; that is the whole point of the
   extraction, and anything left behind is untestable. Implement `onUnschedule`
   in `TripBoardScreen` as `MoveActivity(toDayId: null)` **plus**
   `UpdateActivity({ timeWindow: null })` — the design's "unscheduling strips the
   times".
3. Auto-open: drive Step 2's `rackDisclosure` reducer from the same
   `monitorForElements` — `onDragStart` dispatches `{ type: "dragStart" }`, and
   `onDrop` (which pdnd also fires on an Escape cancel) dispatches
   `{ type: "dragEnd" }`. The rack's own toggle dispatches `{ type: "toggle" }`.
   **Do not add a key listener**, and do not reimplement the ownership rule in
   the component — the reducer already holds it.
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


- [ ] **Step 5: The e2e spec — this is the real gate for this task**

Create `apps/web/e2e/m10-unscheduled-rack.spec.ts`. This is where the drag
behaviour is actually proven. `dragCardTo(source, target)` takes two locators and
works against any target, so a rack drop needs no new helper.

```ts
import { expect, test } from "@playwright/test";
import { createMappedTrip, dragCardTo, signInAsDevUser } from "./helpers";

test("a stop can be dragged into the unscheduled rack and back onto a day", async ({ page }) => {
  // Drag sequences with settle waits at both ends run well past the 30s default.
  test.setTimeout(90_000);
  // Distinct prefix from other specs' trip names — parallel workers share a DB.
  const tripName = `Rack ${Date.now()}`;
  await signInAsDevUser(page, "alice");
  const tripId = await createMappedTrip(page, tripName, 3);

  await page.goto(`/trips/${tripId}`);
  const rack = page.getByTestId("unscheduled-rack");
  const card = page.getByTestId("activity-card").first();
  const title = await card.innerText();

  // -- the drawer auto-opens as the drag starts --
  await expect(rack).toBeVisible();
  await expect(page.getByTestId("rack-card")).toHaveCount(0);

  await dragCardTo(card, rack);

  // -- dropping on the rack unschedules and strips the time window --
  await expect(page.getByTestId("rack-card")).toHaveCount(1);
  await expect(rack.getByText(title, { exact: false })).toBeVisible();
  await expect(rack.getByText(/no time yet/i)).toBeVisible();

  // -- and back out onto a day --
  await dragCardTo(page.getByTestId("rack-card").first(), page.getByTestId("day-column").nth(1));

  await expect(page.getByTestId("rack-card")).toHaveCount(0);
});

test("undo reverses an unschedule", async ({ page }) => {
  test.setTimeout(90_000);
  const tripName = `RackUndo ${Date.now()}`;
  await signInAsDevUser(page, "alice");
  const tripId = await createMappedTrip(page, tripName, 2);

  await page.goto(`/trips/${tripId}`);
  await dragCardTo(page.getByTestId("activity-card").first(), page.getByTestId("unscheduled-rack"));
  await expect(page.getByTestId("rack-card")).toHaveCount(1);

  // Unscheduling is two commands (MoveActivity + UpdateActivity), so it takes
  // two undos unless they are dispatched as one batch — assert whichever the
  // implementation actually does, and say which in the commit message.
  await page.getByRole("button", { name: /undo/i }).click();

  await expect(page.getByTestId("rack-card")).toHaveCount(0);
});
```

Add whatever `data-testid`s these need as you implement — `unscheduled-rack`,
`rack-card`, and reuse the existing `activity-card` / `day-column` ids.

Run it:

```bash
pnpm --filter web test:e2e -- m10-unscheduled-rack
```

**Expect flakiness here, and do not chase it — KI-21.** `dragCardTo` fails
intermittently under load, on a *different* assertion each run, confirmed
unrelated to any branch's code. Before treating a failure as a regression:
re-run once, and check `ps aux` sorted by CPU for an external consumer.
`AGENTS.md`: if a suite fails differently each run, **stop before a third
attempt** and look for an environmental cause.


- [ ] **Step 6: Verify in the browser**

Drag a stop from Day 1 into the rack — the drawer opens as the drag starts, the
proxy becomes a compact card over it, and dropping strips the times. Drag it back
onto a day. Undo reverses each.

- [ ] **Step 7: Run the phase gate and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components/trip/UnscheduledRack.tsx \
        apps/web/src/components/trip/rackDisclosure.ts \
        apps/web/src/components/trip/rackDisclosure.test.ts \
        apps/web/src/components/board/Board.tsx \
        apps/web/src/components/board/Column.tsx \
        apps/web/src/components/board/resolveDrop.ts \
        apps/web/src/components/board/resolveDrop.test.ts \
        apps/web/src/components/board/TripBoardScreen.tsx \
        apps/web/e2e/m10-unscheduled-rack.spec.ts
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
- [ ] `resolveDrop` and `rackDisclosure` are pure, unit-tested, and hold **all**
      the routing and auto-open-ownership logic — none left inline in the monitor.
- [ ] `e2e/m10-unscheduled-rack.spec.ts` passes in a real browser. That spec, not
      the unit suite, is this task's proof: jsdom cannot drive
      pragmatic-drag-and-drop at all (no `DataTransfer`, no `DragEvent`).
