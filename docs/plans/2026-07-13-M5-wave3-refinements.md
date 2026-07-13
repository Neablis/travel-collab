# M5 Wave-3 Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the deferred Group-4 PR #11 comments — board wrapped-grid layout, Map lens cleanup + re-render fix, Schedule toggle restyle, header budget meter, timeline time-axis — plus two folded-in fixes (MoneyInput grouped display, silent no-op commands).

**Architecture:** All changes are UI-layer only in `apps/web/src`, on the existing `m5-design-foundations` branch (stacks onto PR #11). A short **F-track** lands the three shared primitive/context changes first (EditorHost callback stabilization, MoneyInput format-on-blur, TripProvider silent no-op), then independent **area tracks** (Board, Map, Header, Schedule/Timeline, misc) run in isolated worktrees and merge back sequentially, then **Integration** verifies.

**Tech Stack:** Next.js 15 (App Router, client components), React 19, TypeScript strict, Tailwind v4 (`@theme` tokens in `globals.css`), Vitest + Testing Library (unit), Playwright (e2e), maplibre-gl (Map), pragmatic-drag-and-drop (Board DnD).

## Global Constraints

- **UI-layer only.** Zero diff to `packages/`, `apps/web/src/server`, `apps/web/src/app/api`, `docs/contracts`. No contract change. Verify with: `git diff origin/main --stat -- packages/ apps/web/src/server apps/web/src/app/api docs/contracts` → empty.
- **ADR-012 spine invariants:** `TripProvider` is server-cache + dispatch, never a store (trip state changes only via `dispatch()` → `load()` refetch); `LensRouter` is URL-as-truth, no `useState` mirror; overlays open via owned state, never a Radix `*Trigger`.
- **Enforcement walls:** no raw color hex/rgb/hsl outside `globals.css`; no inline `style={{…}}` outside the allowlist (drag transforms, maplibre container, TimelineLens computed geometry — **BudgetMeter fill width is added to this allowlist** with an `eslint-disable-next-line no-restricted-syntax` + reason, same pattern as TimelineLens); no raw `<button>/<input>/<h1-6>/<table>` etc. outside `components/ui/`; no arbitrary Tailwind values (`[240px]`, `[#hex]`).
- **Preserve** existing `data-testid` and `aria-label` where the element still exists.
- **Commands:** `pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter web test -- --no-file-parallelism` (single fork avoids the documented sandbox parallel-load flakiness). Full gate before "done": `pnpm check` + `pnpm --filter web test:e2e` (needs `POSTGRES_PORT=<free> docker compose -p <name> up -d` + `drizzle-kit migrate` + `apps/web/.env.local` with `AUTH_DEV_LOGIN=true`).
- **Do NOT** merge the branch or tick milestone gate boxes. Push to `origin/m5-design-foundations`; Mitchell demos the deployed preview and resolves the Vercel comments.
- **Worktrees:** each parallel track works in its own git worktree under `.claude/worktrees/` (branch from the current `m5-design-foundations` tip), merged back sequentially — never a shared working tree. Always `git -C <abs-path>` for mutating git ops; verify `pwd`/branch before each commit.

## File Structure

| File | Responsibility | Track |
|---|---|---|
| `components/trip/context/EditorHost.tsx` | Stabilize `openCreate/openEdit/close` identities (map re-render fix) | F1 |
| `components/board/MoneyInput.tsx` | Format-on-blur grouped display; raw digits while editing | F2 |
| `components/lenses/formatMoney.ts` | Reuse `formatAmount` (already grouped) from MoneyInput | F2 |
| `components/trip/context/TripProvider.tsx` | Treat `"no-op"` command result as benign (no alert) | F3 |
| `components/board/Board.tsx` | Wrapped-grid columns, capped width, backlog strip, retire pager/edge-shadow | B |
| `components/board/Column.tsx` | Min-height, whole-card drop target | B |
| `components/board/TripBoardScreen.tsx` | Move Board from `width="full"` to `width="content"` | B |
| `components/lenses/MapLens.tsx` | Remove located list, "no location" affordance, fill height | M |
| `components/ui/budget-meter.tsx` (new) | Spent-vs-budget meter composite | H |
| `components/trip/TripHeader.tsx` | Use `BudgetMeter` for the money glance | H |
| `components/lenses/TimelineLens.tsx` | Hour-axis ticks/labels + gridlines | T |
| `components/lenses/ScheduleLens.tsx` | Restyled (subordinate) view switch | T |
| `components/ui/segmented-control.tsx` | Add a `variant="subtle"` (or new lighter control) | T |
| `components/board/AnchorEditor.tsx` | Align "Add anchor" button to input baseline | X |
| `docs/guidelines/design-system.md` | Inventory: `BudgetMeter`; board-grid + drop convention; MoneyInput display note | in owning tasks |

---

## F-track — shared foundation (sequential, one worktree)

### Task F1: Stabilize EditorHost callbacks (Map re-render fix, #24/#25)

**Files:**
- Modify: `apps/web/src/components/trip/context/EditorHost.tsx`
- Test: `apps/web/src/components/trip/context/context.test.tsx` (extend)

**Interfaces:**
- Produces: `useEditor()` → `{ state, openCreate, openEdit, close }` where `openCreate/openEdit/close` keep a **stable identity across editor-state changes** (only `state` changes between renders).

- [ ] **Step 1: Write the failing test** — the action callbacks are referentially stable across an open/close cycle.

```tsx
// in context.test.tsx
import { act, render } from "@testing-library/react";
import { EditorHost, useEditor } from "./EditorHost";

it("openCreate/openEdit/close keep a stable identity across editor-state changes (F1)", () => {
  const seen: Array<ReturnType<typeof useEditor>> = [];
  function Probe() {
    const api = useEditor();
    seen.push(api);
    return null;
  }
  render(
    <EditorHost>
      <Probe />
    </EditorHost>,
  );
  const first = seen[seen.length - 1]!;
  act(() => first.openEdit("a-1")); // changes state → re-render
  const second = seen[seen.length - 1]!;
  expect(second.state).toEqual({ mode: "edit", activityId: "a-1" });
  expect(second.openCreate).toBe(first.openCreate);
  expect(second.openEdit).toBe(first.openEdit);
  expect(second.close).toBe(first.close);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --no-file-parallelism context.test`
Expected: FAIL — `second.openCreate` is a new reference (currently rebuilt each render).

- [ ] **Step 3: Implement** — wrap the actions in `useCallback` (empty deps; they only call `setState`), keep `state` out of their closures.

```tsx
"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ActivityPrefill = {
  dayId?: string;
  location?: { name: string; lat?: number; lng?: number };
  timeWindow?: { start: string; end: string };
};
type EditorState = { mode: "create" | "edit" | null; prefill?: ActivityPrefill; activityId?: string };
type EditorCtx = {
  state: EditorState;
  openCreate: (prefill?: ActivityPrefill) => void;
  openEdit: (activityId: string) => void;
  close: () => void;
};

const Ctx = createContext<EditorCtx | null>(null);
export const useEditor = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside EditorHost");
  return v;
};

export function EditorHost({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EditorState>({ mode: null });
  // Stable identities: setState is stable, so these never need to change.
  // Consumers that depend on the actions (e.g. MapLens's mount effect) must
  // not re-run just because editor state changed — otherwise the map is torn
  // down and rebuilt on every open (#24/#25).
  const openCreate = useCallback((prefill?: ActivityPrefill) => setState({ mode: "create", prefill }), []);
  const openEdit = useCallback((activityId: string) => setState({ mode: "edit", activityId }), []);
  const close = useCallback(() => setState({ mode: null }), []);
  const api = useMemo<EditorCtx>(() => ({ state, openCreate, openEdit, close }), [state, openCreate, openEdit, close]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 4: Run tests** — `pnpm --filter web test -- --no-file-parallelism context.test` → PASS. Also run the full board/editor suites to confirm no regression: `pnpm --filter web test -- --no-file-parallelism EditorHost context board TripBoardScreen`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/trip/context/EditorHost.tsx apps/web/src/components/trip/context/context.test.tsx
git commit -m "fix(editor): stabilize EditorHost callbacks so the Map stops rebuilding on open (#24/#25)"
```

### Task F2: MoneyInput format-on-blur grouped display (#22 inputs)

**Files:**
- Modify: `apps/web/src/components/board/MoneyInput.tsx`
- Test: `apps/web/src/components/board/MoneyInput.test.tsx` (extend)

**Interfaces:**
- Consumes: `formatAmount(amountMinor: number): string` from `@/components/lenses/formatMoney` (grouped, e.g. `1,111,106.00`).
- Produces: `MoneyInput` unchanged prop API `{ value, currency, onChange }`; now renders a **text** input showing the grouped amount when blurred, raw digits while focused.

Notes: HTML `<input type="number">` cannot render commas, so switch to `type="text"` with `inputMode="decimal"`. Keep the existing commit-on-blur/Enter model, Escape-revert, and unmount-flush. `parseMoney` must strip grouping commas before `Number()`.

- [ ] **Step 1: Write the failing tests**

```tsx
// in MoneyInput.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoneyInput } from "./MoneyInput";

afterEach(cleanup);

it("shows a grouped amount when not focused (#22)", () => {
  render(<MoneyInput value={{ amountMinor: 111110600, currency: "USD" }} currency="USD" onChange={vi.fn()} />);
  expect((screen.getByLabelText("cost (USD)") as HTMLInputElement).value).toBe("1,111,106.00");
});

it("commits parsed minor units from a comma-grouped entry on blur", () => {
  const onChange = vi.fn();
  render(<MoneyInput value={null} currency="USD" onChange={onChange} />);
  const input = screen.getByLabelText("cost (USD)");
  fireEvent.change(input, { target: { value: "4,332,212" } });
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledWith({ amountMinor: 433221200, currency: "USD" });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter web test -- --no-file-parallelism MoneyInput` → FAIL (value is `1111106.00`, and `"4,332,212"` parses to NaN today).

- [ ] **Step 3: Implement** — reuse `formatAmount`, strip commas in `parseMoney`, switch to a text input.

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { Money } from "@tc/contracts";
import { Input } from "@/components/ui/input";
import { formatAmount } from "@/components/lenses/formatMoney";

// Grouped display when idle (e.g. 1,111,106.00); raw digits are still accepted
// while typing. Uses the shared formatAmount so grouping matches the lenses.
function formatMoney(value: Money | null): string {
  return value ? formatAmount(value.amountMinor) : "";
}

function moneyEqual(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}

function parseMoney(raw: string, currency: string): Money | null {
  const trimmed = raw.replace(/,/g, "").trim(); // strip grouping separators
  if (trimmed === "") return null;
  const amountMinor = Math.max(0, Math.round(Number(trimmed) * 100));
  return Number.isFinite(amountMinor) ? { amountMinor, currency } : null;
}
```

Then change the `<Input>` element (keep the rest of the component body — display state, prev-value sync, unmount flush, blur/Enter/Escape handlers — exactly as-is):

```tsx
    <Input
      type="text" inputMode="decimal" aria-label={`cost (${currency})`} placeholder={`0.00 ${currency}`}
      value={display}
      onChange={(e) => setDisplay(e.target.value)}
      onBlur={(e) => {
        if (cancelingRef.current) { cancelingRef.current = false; return; }
        onChange(parseMoney(e.target.value, currency));
        setDisplay(formatMoney(parseMoney(e.target.value, currency))); // re-group after commit
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); cancelingRef.current = true; setDisplay(formatMoney(value)); e.currentTarget.blur(); }
      }}
    />
```

- [ ] **Step 4: Run tests** — `pnpm --filter web test -- --no-file-parallelism MoneyInput TripMoneySettings ActivityEditor` → PASS. (The removed `step`/`min` number attributes: confirm no test asserted on them.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board/MoneyInput.tsx apps/web/src/components/board/MoneyInput.test.tsx
git commit -m "feat(money): MoneyInput shows grouped amounts, parses comma-grouped entry (#22)"
```

### Task F3: Silent no-op commands (#7HuQy "This change would have no effect")

**Files:**
- Modify: `apps/web/src/components/trip/context/TripProvider.tsx`
- Test: `apps/web/src/components/trip/context/context.test.tsx` (extend) OR a focused TripProvider test — use whichever already mounts TripProvider with a mocked `sendTripCommand`. If none exists, add `apps/web/src/components/trip/context/TripProvider.test.tsx`.

**Interfaces:**
- Consumes: `sendTripCommand` result `{ ok: false, error: { code?: string } }` where the domain returns `code: "no-op"` for a change that would not alter state (`packages/domain/src/trip/decide.ts`).
- Produces: `dispatch` no longer sets `error` for a `"no-op"` result and skips the refetch (nothing changed).

- [ ] **Step 1: Write the failing test** — mock `sendTripCommand` to return a `"no-op"` error; assert `error` stays null.

```tsx
// mock the api client
vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: /* minimal TripDetail fixture */ }),
    fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: /* minimal TripHistory */ }),
    sendTripCommand: vi.fn().mockResolvedValue({ ok: false, error: { status: 409, message: "This change would have no effect.", code: "no-op" } }),
  };
});
// Render TripProvider, read ctx via a probe, dispatch any command, assert:
// expect(probe.error).toBeNull();
```

(Use the existing `tripDetailFixture`/`tripHistory` fixtures from `@/mocks/fixtures` for the mocked reads.)

- [ ] **Step 2: Run to verify FAIL** — the error currently surfaces `"This change would have no effect."`.

- [ ] **Step 3: Implement** — in `dispatch`, branch on the code:

```tsx
  const dispatch = useCallback(
    async (command: BoardCommand) => {
      setError(null);
      setPending(true);
      try {
        const result = await sendTripCommand(command);
        if (!result.ok) {
          // A "no-op" (e.g. re-setting a value to what it already is) changed
          // nothing — surfacing it as a page alert alarms the user for a
          // harmless action (#7HuQy). Treat it as a benign no-op: no error,
          // no refetch.
          if (result.error.code === "no-op") return;
          setError(result.error.message);
        }
        await load();
        exit();
      } finally {
        setPending(false);
      }
    },
    [load, exit],
  );
```

- [ ] **Step 4: Run tests** — the new test PASS; run `pnpm --filter web test -- --no-file-parallelism context TripProvider` for regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/trip/context/TripProvider.tsx apps/web/src/components/trip/context/*.test.tsx
git commit -m "fix(dispatch): treat no-op command results as benign, drop the confusing alert (#7HuQy)"
```

- [ ] **Merge F-track:** fast-forward F-track worktree branch into `m5-design-foundations`. Run `pnpm --filter web typecheck && lint && test -- --no-file-parallelism` on the branch tip — all green before opening area tracks.

---

## Track B — Board wrapped grid & width (#31/#23/#4/#10 + drop targets)

Worktree from the post-F-track tip.

### Task B1: Columns wrap into a grid; retire horizontal scroll

**Files:**
- Modify: `apps/web/src/components/board/Board.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx` (Board moves to `width="content"`)
- Test: `apps/web/src/components/board/board.test.tsx` (replace pager/edge-shadow/stack tests)

**Interfaces:**
- Consumes: `Column` (Task B2 adds min-height/whole-card drop — B1 may land first with the current Column and B2 refines).
- Produces: a `div` wrapper with class `flex flex-wrap gap-3` holding the day columns (no `overflow-x-auto`, no edge-shadow, no pager).

- [ ] **Step 1: Update tests** — remove the day-pager (`aria-label="Jump to day"`), edge-shadow, and `flex-col/lg:flex-row/lg:overflow-x-auto` assertions; add a wrap assertion.

```tsx
it("day columns lay out in a wrapping row (no horizontal scroll)", () => {
  renderBoard(fixture(), noopCallbacks());
  const row = screen.getByTestId("backlog-column").parentElement; // day grid wrapper
  // Backlog is now a full-width strip above the grid; the grid wrapper holds day columns.
  const dayGrid = screen.getAllByTestId("day-column")[0]!.parentElement;
  expect(dayGrid?.className).toContain("flex-wrap");
  expect(dayGrid?.className).not.toContain("overflow-x-auto");
  expect(screen.queryByLabelText("Jump to day")).toBeNull();
});
```

- [ ] **Step 2: Run FAIL** — `pnpm --filter web test -- --no-file-parallelism board.test`.

- [ ] **Step 3: Implement** — rework `Board.tsx`'s render. Remove `scrollRef`, `dayRefs`, `hasOverflowRight`, `updateOverflow`, `scrollToDay`, the pager block, and the edge-shadow block. Backlog renders as a full-width strip; day columns in a `flex flex-wrap` grid.

```tsx
  return (
    <div className="flex flex-col gap-3">
      <ConflictBanner
        conflicts={trip.conflicts}
        dismissedConflictIds={trip.dismissedConflictIds}
        onDismiss={callbacks.onDismissConflict}
      />
      {/* Backlog is the unscheduled pool — a full-width strip above the dated
          day grid, not a column in the wrap. */}
      <Column
        title="Backlog"
        dayId={null}
        activityIds={trip.backlog}
        activities={trip.activities}
        conflictIds={conflictIds}
        onEditActivity={openEdit}
        onRemoveActivity={callbacks.onRemoveActivity}
        fullWidth
      >
        <Button variant="primary" onClick={() => openCreate()}>+ Add activity</Button>
      </Column>
      {/* Day columns wrap into rows instead of scrolling horizontally
          (#31/#23/#4/#10). Adjacency for drag is dayId-based, not DOM order,
          so wrapping doesn't affect drop logic. */}
      <div className="flex flex-wrap gap-3">
        {trip.days.map((day, index) => (
          <Column
            key={day.dayId}
            title={dayLabel(trip.startDate, index)}
            dayId={day.dayId}
            activityIds={day.activityIds}
            activities={trip.activities}
            conflictIds={conflictIds}
            onEditActivity={openEdit}
            onRemoveActivity={callbacks.onRemoveActivity}
            onRemoveDay={() => callbacks.onRemoveDay(day.dayId)}
            onAddActivity={() => openCreate({ dayId: day.dayId })}
          />
        ))}
        <Button variant="secondary" onClick={callbacks.onAddDay} className="h-9 w-32 shrink-0">
          + Add day
        </Button>
      </div>
    </div>
  );
```

Remove now-unused imports (`useEffect`, `useRef`, `useCallback` if no longer used; `dayLabel` still used). Keep the drag `monitorForElements` effect. In `TripBoardScreen.tsx`, change `const isFullLens = lens === "Board" || lens === "Map";` to `const isFullLens = lens === "Map";` so Board renders inside `PageContainer width="content"` (capped width, #31).

Because B1's backlog `<Column>` uses a new `fullWidth` prop, **add it to `Column.tsx`'s props in this task** (typecheck depends on it): add `fullWidth?: boolean` to the props type (default false) and apply `fullWidth ? "w-full" : "w-64 shrink-0"` to the `<section>` width classes. B2 then refines the section's min-height and the drop-area fill on top of this.

- [ ] **Step 4: Run tests** — `pnpm --filter web test -- --no-file-parallelism board.test TripBoardScreen`. Fix fallout (e.g. the `board.test.tsx` "backlog-column parentElement" structure changed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board/Board.tsx apps/web/src/components/board/TripBoardScreen.tsx apps/web/src/components/board/board.test.tsx
git commit -m "feat(board): wrap day columns into a grid, cap board width, retire horizontal scroll (#31/#23/#4/#10)"
```

### Task B2: Whole-card drop target + minimum day height

**Files:**
- Modify: `apps/web/src/components/board/Column.tsx`
- Test: `apps/web/src/components/board/board.test.tsx` or `Column`-focused test

**Interfaces:**
- Consumes: `Column` props including the `fullWidth?: boolean` added in B1.
- Produces: the day-card `<section>` gets a min height and the drop-target `<ul>` fills the card (`flex-1`, min height), so dropping anywhere in the day card targets that day.

- [ ] **Step 1: Write test** — the day column's droppable list has a min-height class and grows to fill.

```tsx
it("a day column's drop area fills the card with a minimum height", () => {
  renderBoard(fixture(), noopCallbacks());
  const day = screen.getAllByTestId("day-column")[0]!;
  const dropList = day.querySelector("ul");
  expect(dropList?.className).toContain("flex-1");
  expect(dropList?.className).toMatch(/min-h-/);
});
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** — in `Column.tsx`: make the `<section>` a flex column with a min height (day columns only), and the `<ul>` `flex-1` with a min-height so the whole card is comfortably droppable. Add the `fullWidth` prop for the backlog strip.

```tsx
    <section
      ref={sectionRef}
      data-testid={dayId === null ? "backlog-column" : "day-column"}
      className={cn(
        "flex flex-col rounded-md bg-moss p-2",
        fullWidth ? "w-full" : "w-64 shrink-0",
        dayId !== null && "min-h-44", // dated day cards get a comfortable min height
      )}
    >
      <header className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">{title}</span>
        {onRemoveDay && (
          <Button variant="ghost" size="icon" onClick={onRemoveDay} aria-label={`Remove ${title}`}>
            <X className="size-3.5" aria-hidden />
          </Button>
        )}
      </header>
      <ul
        ref={ref}
        className={cn("m-0 flex-1 list-none rounded-sm p-1", dayId !== null ? "min-h-24" : "min-h-12", isOver && "bg-brand-tint")}
      >
```

Add `fullWidth?: boolean` to the props type (default false). Backlog keeps its own compact min-height; day cards get the taller drop area. The empty-day prominent add button (Wave-3 fix #20) stays.

- [ ] **Step 4: Run tests** — `pnpm --filter web test -- --no-file-parallelism board.test Column`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board/Column.tsx apps/web/src/components/board/board.test.tsx
git commit -m "feat(board): day cards get a min height and a full-card drop target (#DEgwPqo7)"
```

- [ ] **Track B docs:** add the board-grid + whole-card-drop convention to `design-system.md` (Overflow policy section — the board now wraps rather than scrolls). Commit with the doc change.

---

## Track M — Map lens (#24 done in F1 · #25 · #26)

### Task M1: Remove located list, add "no location" affordance, fill height

**Files:**
- Modify: `apps/web/src/components/lenses/MapLens.tsx`
- Test: `apps/web/src/components/lenses/MapLens.test.tsx` (if present) or add focused assertions; note maplibre is dynamically imported and won't mount in jsdom — test the non-map DOM (affordance, absence of located list).

**Interfaces:**
- Consumes: `activityPins(detail)`, `unlocatedActivities(detail)` from `./mapData` (unchanged).
- Produces: MapLens renders the map container (fills height) + a compact "N activities have no location" affordance; the located-pin `<ul>` is removed.

- [ ] **Step 1: Write test** — located list gone; unlocated affordance shows a count and opens the editor.

```tsx
it("shows no located-activities list; unlocated activities get a compact affordance", () => {
  // fixture with 1 located + 2 unlocated activities
  render(<EditorHostWrapper><MapLens detail={fixture} onSelectActivity={vi.fn()} /></EditorHostWrapper>);
  expect(screen.queryByTestId("map-lens-pin-list")).toBeNull();
  expect(screen.getByRole("button", { name: /2 activities have no location/i })).toBeTruthy();
});
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** — in `MapLens.tsx`: delete the `map-lens-pin-list` `<ul>` block entirely. Replace the fixed `height: 400` with a viewport-fill height (computed geometry stays in the maplibre inline-style allowlist). Replace the verbose "Not on the map" list with a single compact affordance button showing the count (opens the first unlocated activity, or a small popover listing them — keep it to a count + click for now).

```tsx
  return (
    <div data-testid="map-lens" className="map-lens flex flex-col gap-3">
      {pins.length > 0 ? (
        // eslint-disable-next-line no-restricted-syntax -- maplibre needs a sized container; height is geometry, filling the viewport below the header/tabs
        <div ref={containerRef} className="map-lens-canvas grow overflow-hidden rounded-md border border-hairline" style={{ width: "100%", minHeight: 480, height: "70vh" }} />
      ) : (
        <Text variant="secondary" className="map-lens-empty">
          No located activities yet — add a place to see it on the map.
        </Text>
      )}
      {unlocated.length > 0 && (
        <Button
          variant="ghost"
          className="self-start text-slate"
          onClick={() => onSelectActivity?.(unlocated[0]!.activityId)}
        >
          {unlocated.length} {unlocated.length === 1 ? "activity has" : "activities have"} no location — add a place
        </Button>
      )}
    </div>
  );
```

Remove the now-unused `Heading` import if it's no longer referenced. Keep the map mount effect, the marker click → `onSelectActivity`, and the dblclick → `openCreate` wiring unchanged. With F1 merged, `openCreate` is now stable so the effect no longer re-runs on editor open.

- [ ] **Step 4: Run tests** — `pnpm --filter web test -- --no-file-parallelism MapLens`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lenses/MapLens.tsx apps/web/src/components/lenses/MapLens.test.tsx
git commit -m "feat(map): drop the pin list for a quiet no-location affordance, fill height (#25/#26)"
```

---

## Track H — Header budget meter (#30)

### Task H1: BudgetMeter composite

**Files:**
- Create: `apps/web/src/components/ui/budget-meter.tsx`
- Test: `apps/web/src/components/ui/budget-meter.test.tsx`
- Modify: `docs/guidelines/design-system.md` (inventory + inline-style allowlist note)
- Modify: `eslint` inline-style allowlist config if it enumerates files (mirror the TimelineLens exception for BudgetMeter's fill width)

**Interfaces:**
- Produces: `<BudgetMeter cost={number} budget={number} currency={string} />` — a fill bar (brand under budget, warning over) + `formatAmount(cost) of formatAmount(budget) currency` label; over-budget label portion in `text-warning-ink`.

- [ ] **Step 1: Write tests**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetMeter } from "./budget-meter";

afterEach(cleanup);

it("shows spent-of-budget and stays brand under budget", () => {
  render(<BudgetMeter cost={5000} budget={10000} currency="USD" />);
  expect(screen.getByText(/50\.00 of 100\.00 USD/)).toBeTruthy();
  expect(screen.getByTestId("budget-meter-fill").className).toContain("bg-brand");
});

it("turns warning and clamps the fill when over budget", () => {
  render(<BudgetMeter cost={20000} budget={10000} currency="USD" />);
  expect(screen.getByTestId("budget-meter-fill").className).toContain("bg-warning");
});
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement**

```tsx
import { DataText } from "./data-text";
import { cn } from "../../lib/cn";
import { formatAmount } from "@/components/lenses/formatMoney";

// Read-only spent-vs-budget glance for the header (#30). Fill is brand under
// budget, warning-amber over (over budget is a warning, not a failure).
export function BudgetMeter({ cost, budget, currency }: { cost: number; budget: number; currency: string }) {
  const over = cost > budget;
  const pct = budget > 0 ? Math.min(100, (cost / budget) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-moss">
        <div
          data-testid="budget-meter-fill"
          className={cn("h-full rounded-full", over ? "bg-warning" : "bg-brand")}
          // eslint-disable-next-line no-restricted-syntax -- computed geometry (fill %), not a tokenable color
          style={{ width: `${pct}%` }}
        />
      </div>
      <DataText size="sm" className={cn(over && "text-warning-ink")}>
        {formatAmount(cost)} of {formatAmount(budget)} {currency}
      </DataText>
    </div>
  );
}
```

- [ ] **Step 4: Run tests** → PASS. Add `BudgetMeter` to the `design-system.md` Composites inventory and note the inline-style allowlist addition. If the color-wall/inline-style check enumerates allowed files, add `budget-meter.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/budget-meter.tsx apps/web/src/components/ui/budget-meter.test.tsx docs/guidelines/design-system.md
git commit -m "feat(ui): BudgetMeter composite for the header spent-vs-budget glance (#30)"
```

### Task H2: Use BudgetMeter in TripHeader

**Files:**
- Modify: `apps/web/src/components/trip/TripHeader.tsx`

- [ ] **Step 1:** Replace the inline `{formatAmount(cost)} / {formatAmount(budget)} {currency}` `DataText` with `<BudgetMeter cost={trip.tripCostTotal} budget={trip.budget.amountMinor} currency={trip.currency} />` (only when `trip.budget !== null`). Keep the date `DataText` as-is.

```tsx
            {trip.budget !== null && (
              <BudgetMeter cost={trip.tripCostTotal} budget={trip.budget.amountMinor} currency={trip.currency} />
            )}
```

Remove the now-unused `formatAmount` import from TripHeader if it's no longer referenced. Import `BudgetMeter`.

- [ ] **Step 2: Run** `pnpm --filter web test -- --no-file-parallelism TripHeader` (and typecheck).
- [ ] **Step 3: Commit** `feat(header): show spent-vs-budget as a BudgetMeter (#30)`.

---

## Track T — Timeline axis (#28) & Schedule toggle restyle (#27)

### Task T1: Timeline hour axis

**Files:**
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx`
- Test: `apps/web/src/components/lenses/TimelineLens.test.tsx` or extend the lens test

**Interfaces:** uses the existing `DAY_START_MIN`/`DAY_END_MIN` (06:00–22:00) and `clampPercent`.

- [ ] **Step 1: Write test** — the timeline renders hour labels so the scale is legible.

```tsx
it("renders an hour axis so block times are readable (#28)", () => {
  render(<TimelineLens detail={fixtureWithTimedActivity} onSelectActivity={vi.fn()} />);
  expect(screen.getAllByText("6a").length).toBeGreaterThan(0);
  expect(screen.getAllByText("12p").length).toBeGreaterThan(0);
  expect(screen.getAllByText("9p").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** — add a labeled axis row above each day's bar with ticks at 6a/9a/12p/3p/6p/9p positioned by `clampPercent`, plus light gridlines. Add a small helper:

```tsx
const AXIS_TICKS = [6, 9, 12, 15, 18, 21].map((h) => ({
  minute: h * 60,
  label: h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`,
}));
```

Render an axis strip (position each label absolutely by `clampPercent(tick.minute)`), and optional gridlines inside the bar. Ticks use `DataText size="xs"` / `text-slate`; gridlines use `border-hairline`. Geometry (`left: ...%`) stays under the TimelineLens inline-style allowlist with the existing reason comment.

- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(timeline): add an hour axis so block times are readable (#28)`.

### Task T2: Restyle the Schedule view switch

**Files:**
- Modify: `apps/web/src/components/ui/segmented-control.tsx` (add `variant`) OR `apps/web/src/components/lenses/ScheduleLens.tsx`
- Test: `segmented-control` test / `ScheduleLens` test

**Interfaces:** keep `SegmentedControl`'s controlled API (`value`, `onValueChange`, `options`, `aria-label`) and its `role="radiogroup"`/`role="radio"` semantics (so `fireEvent.click` works — ADR-012 invariant 3). Add an optional `variant?: "pill" | "subtle"` (default `"pill"` = today's moss-pill look). `"subtle"` renders a lighter, non-track switch (text/underline, no moss background) so it doesn't mirror the tab strip.

- [ ] **Step 1: Write test** — subtle variant has no moss track; selected option is visually marked; clicking switches.

```tsx
it("subtle variant switches without a moss pill track (#27)", () => {
  const onValueChange = vi.fn();
  render(<SegmentedControl variant="subtle" value="Timeline" onValueChange={onValueChange} options={[{value:"Timeline",label:"Timeline"},{value:"Calendar",label:"Calendar"}]} aria-label="Schedule view" />);
  const group = screen.getByRole("radiogroup", { name: "Schedule view" });
  expect(group.className).not.toContain("bg-moss");
  fireEvent.click(screen.getByRole("radio", { name: "Calendar" }));
  expect(onValueChange).toHaveBeenCalledWith("Calendar");
});
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** — parameterize the container + item classes by `variant`; `"subtle"` drops `bg-moss p-0.5` and the raised selected pill, using an underline/weight marker instead. Then in `ScheduleLens.tsx` pass `variant="subtle"` and place the switch in the lens header (e.g. right-aligned).

- [ ] **Step 4: Run tests** — `pnpm --filter web test -- --no-file-parallelism segmented ScheduleLens`.
- [ ] **Step 5: Commit** `feat(schedule): restyle the Timeline/Calendar switch so it isn't a nested tab strip (#27)`.

---

## Track X — Add-anchor alignment (#XnJ5)

### Task X1: Align the "Add anchor" button

**Files:**
- Modify: `apps/web/src/components/board/AnchorEditor.tsx`

- [ ] **Step 1:** Inspect the "Add anchor" row (`div.flex items-center gap-1.5` per the comment context). Align the button to the input baseline/bottom (e.g. `items-end` on the row, or matching control heights). This is a small CSS alignment fix — verify visually in Integration (I2). If an existing `AnchorEditor.test.tsx` covers structure, keep it green; no new behavior.
- [ ] **Step 2:** `pnpm --filter web test -- --no-file-parallelism AnchorEditor` + typecheck.
- [ ] **Step 3: Commit** `fix(anchor): align the Add anchor button with the input (#XnJ5)`.

---

## Integration (single coordinating session, on `m5-design-foundations`)

Merge tracks back sequentially (`git -C <abs> merge`), resolving conflicts by hand; never concurrently.

### Task I1: Full check + e2e

- [ ] `pnpm typecheck` (all 3 packages) clean.
- [ ] `pnpm lint` clean (0 errors; color wall + lint wall + inline-style allowlist pass — confirm BudgetMeter's fill and any new geometry are allowlisted).
- [ ] `pnpm --filter web test -- --no-file-parallelism` — all files green.
- [ ] UI-only guarantee: `git diff origin/main --stat -- packages/ apps/web/src/server apps/web/src/app/api docs/contracts` → empty.
- [ ] Bring up Postgres (`POSTGRES_PORT=<free> docker compose -p m5w3e2e up -d`, migrate), then `pnpm --filter web test:e2e`. Fix any spec fallout from the board layout change (drag flows) and the money-input type change (`type="number"` → `type="text"`: any e2e using `fill()` still works; check no spec asserts a number spinner). Justify each e2e change in its commit.
- [ ] Commit the e2e/test updates.

### Task I2: Live visual verification (preview tools)

- [ ] Start the dev server, sign in (dev login), build a scenario trip (7+ days, activities with/without location, over-budget, timed activities). Verify each Area on the deployed-style preview:
  - Board wraps into rows at wide widths, no horizontal scrollbar, capped width; day cards are comfortably droppable (drag a card between two day cards in different rows).
  - Map: no located list, "N have no location" affordance, map fills height, **no re-render/fl?icker when opening the editor from a marker** (the F1 fix), controls no longer bleed over the sheet.
  - Schedule: the Timeline/Calendar switch reads as subordinate, not a second tab strip.
  - Header: BudgetMeter fills and turns amber when over.
  - Timeline: hour axis labels present and aligned to blocks.
  - Money inputs (activity cost, trip budget) show grouped commas when blurred.
  - Re-set a value to itself → no "This change would have no effect" alert.
- [ ] Screenshot the board grid + budget meter + timeline axis as evidence.

### Task I3: Verify + PR update

- [ ] Fresh `pnpm check` + `pnpm --filter web test:e2e` + `pnpm --filter web build`.
- [ ] design-system.md reflects all new/changed components (BudgetMeter; board grid convention; MoneyInput display note; Schedule subtle switch).
- [ ] Push `m5-design-foundations`; update PR #11's description with a Wave-3 Group-4 section + the comment→resolution map. **Do NOT merge; do NOT tick gate boxes.**
- [ ] Update `docs/known-issues.md` if any finding changes (e.g. KI-2 unchanged; note if the MoneyInput rework surfaced anything).

---

## Self-review notes (coverage)

- Spec Area 1 → Tasks B1, B2. Area 2 → F1 (re-render) + M1. Area 3 → T2. Area 4 → H1, H2. Area 5 → T1. Area 6 → F2 (money inputs) + F3 (no-op) + X1 (add-anchor).
- All 14 comment→resolution rows in the spec map to a task above.
- No contract/domain/server/api changes in any task (UI wall intact).
- Open items from the spec (board max-width, min-height value, subtle-switch form, no-op codes) are resolved inside their tasks (B1/B2 width & min-h, T2 switch, F3 code `"no-op"`).
