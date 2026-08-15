# Phase 2 — Map view

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first — its
> **Global Constraints** section applies to every task here.
>
> **Phases 0 and 1 must be merged before starting this phase.**

**Goal:** the Map lens becomes a per-day map — routes between a day's stops, a
floating day rail, a focused-day card and a legend — instead of a stock basemap
with undifferentiated pins.

**Gate for this phase:** on the seeded 4-day trip, each day's route draws in its
own accent, the rail scrolls the map from day to day, and the empty day holds the
camera instead of lurching.

---

## Background

The Map view **does have a design** — it arrived in the `previous/` generation of
the handoff (`current/…dc.html:630-668`), which PR #23 never saw. `MapLens.tsx`
took a 9-line diff in Wave 1 and is materially pre-M10 code: a stock maplibre
"liberty" basemap in a bordered rectangle with identical brand-green pins.

**Design values, verbatim from `current/…dc.html:630-668`:**

| element | value |
|---|---|
| wrapper (`data-r="mapwrap"`) | `position: relative`, `flex: 1 1 auto`, `min-height: 0`, `border-top: 1px solid --color-hairline`, `background: --color-paper` — full-bleed from the tabs down |
| rail (`data-r="maprail"`) | `position: absolute; left: 16px; top: 16px; bottom: 16px; z-index: 4; width: 268px; overflow-y: auto`, `--color-surface`, `1px solid --color-hairline`, `border-radius: 14px`, `shadow-overlay` |
| rail day button | full width, left-aligned, `border-bottom: 1px solid --color-hairline`, **`border-left: 3px solid <day accent>`**, tinted background, `padding: 11px 14px 12px`, `transition: background 160ms ease` |
| rail day line 1 | 11px, weight 700, `letter-spacing: 0.05em`, uppercase, day-ink — the day label; beside it mono 11px `--color-slate` date |
| rail day line 2 | 14px, weight 600, `--color-ink` — the city |
| rail day line 3 | mono 11px `--color-slate`, `margin-top: 7px`, `letter-spacing: -0.01em` — the totals |
| rail day bars | a 6px-tall row, `gap: 2px`, `margin-top: 8px`; each bar `height: 6px`, `border-radius: 3px`, `flex: <grow>` |
| rail day flag | `margin-top: 9px`, 11.5px, `--color-warning-ink` on `--color-warning-tint`, `border-radius: 7px`, `padding: 6px 8px` |
| focus card | `position: absolute; left: 300px; bottom: 18px; z-index: 3; width: 256px`, surface, hairline border, `border-radius: 12px`, `shadow-overlay`, `padding: 13px 15px 14px`, `riseIn 220ms` |
| focus card contents | a 9px accent dot + 13px/700 `--color-ink` title; mono 12px `--color-slate` stat at `margin-top: 7px`; 12.5px `--color-slate` note at `margin-top: 8px` |
| legend | `position: absolute; right: 18px; bottom: 18px; z-index: 45`, surface pill, hairline border, `border-radius: 999px`, `padding: 7px 14px`, `gap: 14px`, 11px `--color-slate` |
| legend keys | 16×3px solid bar "On foot"; 16px `3px dotted` "By train or taxi"; 16×3px grey at `opacity: 0.55` "Rest of trip" |

Two design behaviours that are **removals**, not additions:

- In map view the horizontal **day-chips row is hidden** — the rail serves the
  same purpose. (Phase 1 put the chips inside the sticky header; this task gates
  them on the lens.)
- Rail days **no longer grey out** when inactive. Background tint and the left
  spine alone signal the active day.

**Straight lines, not routed geometry** (decided 2026-08-14). Do not add a
routing call. See the index's "Deliberate deferrals".

---

## Contract facts you need

`Location` (`packages/contracts/src/activity.ts:32-45`):

```ts
{ name: string; lat?: number; lng?: number; countryCode?: string; city?: string }
```

`lat`/`lng` are **optional** — a manually-typed place has neither. Existing
helpers in `apps/web/src/components/lenses/mapData.ts`:

```ts
export type ActivityPin = { activityId: string; title: string; lat: number; lng: number; dayId: string | null };
export function activityPins(detail: TripDetail): ActivityPin[];
export function unlocatedActivities(detail: TripDetail): ActivityView[];
```

`useFocus()` (`components/trip/context/FocusProvider.tsx`) returns
`{ focusedDay: number | null; setFocusedDay: (i: number | null) => void }`.

---

## Task 2.1: Map data model

**Files:**
- Create: `apps/web/src/lib/geo.ts`
- Create: `apps/web/src/components/lenses/mapRailData.ts`, `mapRailData.test.ts`
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx` (import move only)

**Interfaces:**

```ts
// apps/web/src/lib/geo.ts
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;

// apps/web/src/components/lenses/mapRailData.ts
import type { AccentFamily } from "@/lib/dayAccent";

export type MapStop = { activityId: string; title: string; lat: number; lng: number };

export type MapDay = {
  index: number;
  dayId: string;
  label: string;             // "Day 1"
  date: string | null;       // raw ISO date, formatted by the component
  city: string | null;
  accent: AccentFamily;
  stops: MapStop[];          // located stops, in the day's activity order
  unlocatedCount: number;
  totalKm: number | null;    // summed straight-line legs; null with fewer than 2 located stops
  bars: { grow: number; color: AccentFamily }[];  // one per located stop, grow proportional to that leg's share
  flagText: string | null;   // "No stops yet" | "N stops have no place yet" | null
};

export function mapDays(detail: TripDetail): MapDay[];
export function routeLine(day: MapDay): [number, number][];  // [lng, lat] pairs, in stop order
```

`routeLine` returns `[lng, lat]` — **GeoJSON order**, the opposite of maplibre's
`setLngLat` argument order in some call sites. Getting this backwards puts every
route in the ocean off West Africa; if your line does that, this is why.

- [ ] **Step 1: Hoist `haversineKm` before anything else**

`TimelineLens.tsx:127-135` holds a local `haversineKm` with a comment explaining
why it is not imported from `@tc/domain` (the CI-enforced architecture boundary).
**Move the function and its comment verbatim** into a new
`apps/web/src/lib/geo.ts`, and import it in `TimelineLens.tsx`. Do not write a
second copy — that is the mistake the comment exists to prevent.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/components/lenses/mapRailData.test.ts`. Build a small local
fixture rather than reaching for a shared one — this module needs precise
coordinates:

```ts
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { mapDays, routeLine } from "./mapRailData";

function detailWith(days: { dayId: string; date: string | null; activityIds: string[] }[], activities: Record<string, unknown>): TripDetail {
  return {
    tripId: "t", name: "T", status: "active", currency: "USD", budget: null,
    members: [{ userId: "u", role: "owner" }],
    days, backlog: [], activities: activities as TripDetail["activities"],
    conflicts: [], dismissedConflictIds: [], tripCostTotal: 0, budgetRemaining: null,
  } as TripDetail;
}

const at = (name: string, lat?: number, lng?: number) => ({
  activityId: name, title: name, timeWindow: null,
  location: lat === undefined ? { name } : { name, lat, lng, city: "Rochester" },
  notes: null, anchors: [], cost: null,
});

describe("mapDays", () => {
  it("builds one entry per day, in order", () => {
    const d = detailWith(
      [{ dayId: "d1", date: "2026-09-05", activityIds: ["a"] }, { dayId: "d2", date: "2026-09-06", activityIds: [] }],
      { a: at("a", 43.15, -77.6) },
    );
    expect(mapDays(d).map((m) => m.label)).toEqual(["Day 1", "Day 2"]);
    expect(mapDays(d)[0].index).toBe(0);
  });

  it("sums straight-line legs across a day's located stops", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b", "c"] }], {
      a: at("a", 43.15, -77.60), b: at("b", 43.16, -77.62), c: at("c", 43.17, -77.64),
    });
    const [day] = mapDays(d);
    expect(day.stops).toHaveLength(3);
    expect(day.totalKm).toBeGreaterThan(0);
  });

  it("has no distance with fewer than two located stops", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a"] }], { a: at("a", 43.15, -77.6) });
    expect(mapDays(d)[0].totalKm).toBeNull();
  });

  it("excludes unlocated stops from the route but counts them", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.6), b: at("b"),
    });
    const [day] = mapDays(d);
    expect(day.stops).toHaveLength(1);
    expect(day.unlocatedCount).toBe(1);
  });

  it("flags an empty day", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: [] }], {});
    expect(mapDays(d)[0].flagText).toBe("No stops yet");
  });
});

describe("routeLine", () => {
  it("returns GeoJSON [lng, lat] pairs in stop order", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.60), b: at("b", 43.16, -77.62),
    });
    expect(routeLine(mapDays(d)[0])).toEqual([[-77.60, 43.15], [-77.62, 43.16]]);
  });

  it("returns an empty line for a day with no located stops", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: [] }], {});
    expect(routeLine(mapDays(d)[0])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run and confirm they fail**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/lenses/mapRailData.test.ts
```

- [ ] **Step 4: Implement**

Reuse `chipModel(detail)` from `components/trip/DayChips.tsx` for the per-day
city — it is already the single source of that derivation, and Phase 8 changes
how accents are resolved, so going through it keeps the map in step. Bars are
proportional to each leg's share of `totalKm`, with an equal split when
`totalKm` is null. `flagText` is `"No stops yet"` for an empty day, else
`"N stops have no place yet"` when `unlocatedCount > 0`, else `null`.

- [ ] **Step 5: Run and confirm they pass, then commit**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/lenses/mapRailData.test.ts
pnpm typecheck && pnpm lint
git add apps/web/src/lib/geo.ts apps/web/src/components/lenses/mapRailData.ts apps/web/src/components/lenses/mapRailData.test.ts apps/web/src/components/lenses/TimelineLens.tsx
git commit -m "feat(web): map rail data model; hoist haversineKm to lib/geo"
```

---

## Task 2.2: The rail, the focus card and the legend

**Files:**
- Create: `apps/web/src/components/lenses/MapRail.tsx`, `MapRail.test.tsx`
- Create: `apps/web/src/components/lenses/MapFocusCard.tsx`, `MapFocusCard.test.tsx`
- Modify: `apps/web/src/lib/preview-registry.ts`

**Interfaces:**

```tsx
<MapRail days={MapDay[]} focusedDay={number | null} onFocus={(index: number) => void} />
<MapFocusCard day={MapDay | null} />
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapRail } from "./MapRail";
import type { MapDay } from "./mapRailData";

afterEach(cleanup);

const day = (over: Partial<MapDay> = {}): MapDay => ({
  index: 0, dayId: "d1", label: "Day 1", date: "2026-09-05", city: "Rochester",
  accent: "warning", stops: [], unlocatedCount: 0, totalKm: 4.2,
  bars: [{ grow: 1, color: "warning" }], flagText: null, ...over,
});

describe("MapRail", () => {
  it("renders one button per day, carrying its label and city", () => {
    render(<MapRail days={[day(), day({ index: 1, dayId: "d2", label: "Day 2", city: "Niagara Falls" })]} focusedDay={0} onFocus={vi.fn()} />);

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Rochester")).toBeTruthy();
    expect(screen.getByText("Niagara Falls")).toBeTruthy();
  });

  it("focuses a day when its button is clicked", async () => {
    const onFocus = vi.fn();
    render(<MapRail days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]} focusedDay={0} onFocus={onFocus} />);

    await userEvent.click(screen.getAllByRole("button")[1]);

    expect(onFocus).toHaveBeenCalledWith(1);
  });

  it("marks the focused day without greying out the others", () => {
    render(<MapRail days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]} focusedDay={1} onFocus={vi.fn()} />);

    const [first, second] = screen.getAllByRole("button");
    expect(second.getAttribute("aria-current")).toBe("true");
    expect(first.getAttribute("aria-current")).toBeNull();
    // Handoff: inactive rail days keep full-strength text — the tint and the
    // left spine are the only active-state signal.
    expect(first.className).not.toMatch(/opacity-|text-slate\b/);
  });

  it("shows a warning flag when the day carries one", () => {
    render(<MapRail days={[day({ flagText: "No stops yet" })]} focusedDay={null} onFocus={vi.fn()} />);
    expect(screen.getByText("No stops yet")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement both components to the values in the table above**

Use the static-`Record` pattern for accent → class (`DayChips.tsx:19` `CHIP_BG`
is the template); Tailwind's JIT cannot see `bg-${accent}-tint`. The 268px width,
the 3px spine and the 6px bar row are computed geometry — inline `style` with the
standard eslint-disable comment.

**The legend's mode split is not backed by data.** We model no transport mode, so
"On foot" vs "By train or taxi" is a claim we cannot make. Wrap those two legend
entries in `<Preview id="map-legend-modes" size="compact">`, leave "Rest of trip"
outside it, and draw every real route line **solid**. Add to
`apps/web/src/lib/preview-registry.ts`:

```ts
  'map-legend-modes': { milestone: 'M9', wiredUpBy: 'Transport mode per leg — no field models it today' },
```

Use whatever the registry's existing entries use for the value shape — read the
file first and match it exactly, or `preview-registry.test.ts` will fail.

- [ ] **Step 4: Run, confirm pass, commit**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/lenses/MapRail.test.tsx src/components/lenses/MapFocusCard.test.tsx src/lib/preview-registry.test.ts
git add apps/web/src/components/lenses/MapRail.tsx apps/web/src/components/lenses/MapRail.test.tsx apps/web/src/components/lenses/MapFocusCard.tsx apps/web/src/components/lenses/MapFocusCard.test.tsx apps/web/src/lib/preview-registry.ts
git commit -m "feat(web): map day rail, focus card and legend"
```

---

## Task 2.3: MapLens rebuilt around the rail

**Files:**
- Modify: `apps/web/src/components/lenses/MapLens.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx` (hide chips in map view)
- Test: `apps/web/src/components/lenses/MapLens.test.tsx`

**maplibre facts that will otherwise cost you an hour:**

- The module is dynamically imported (`await import("maplibre-gl")`) and the map
  is built inside a `useEffect`. Style and sources are **not** available
  synchronously — adding a source before `map.on("load")` fires throws
  `Style is not done loading`. Add sources and layers inside a `load` handler.
- `new Marker().setLngLat([lng, lat])` takes **`[lng, lat]`**, same order as
  `routeLine`'s output. `fitBounds` takes a `LngLatBounds` built by
  `bounds.extend([lng, lat])`.
- The existing `styleimagemissing` handler (`MapLens.tsx:49-52`) must be kept —
  without it maplibre logs an error per missing sprite icon.
- In jsdom there is no WebGL. `MapLens.test.tsx` already exists — **read how it
  mocks `maplibre-gl` before writing new tests** and follow the same approach;
  do not try to render a real map in a unit test.

- [ ] **Step 1: Write the failing tests**

```tsx
it("hides the day-chips row in map view", async () => {
  setViewportMatches({ "(min-width: 1180px)": true });
  renderScreen("trip-1");                       // TripBoardScreen.test.tsx's helper
  await userEvent.click(await screen.findByRole("tab", { name: "Map" }));

  expect(screen.queryByRole("group", { name: "Days" })).toBeNull();
});
```

In `MapLens.test.tsx`, following that file's existing maplibre mock:

```tsx
it("draws one route layer per day that has two or more located stops", async () => {
  renderMap(detailWithTwoDays);        // this file's existing helper
  await waitFor(() => expect(addLayerMock).toHaveBeenCalled());

  const lineLayers = addLayerMock.mock.calls.filter(([layer]) => layer.type === "line");
  expect(lineLayers).toHaveLength(2);
});

it("does not move the camera for a focused day with no coordinates", async () => {
  renderMap(detailWithEmptyDay, { focusedDay: 2 });
  await waitFor(() => expect(mapOnLoad).toHaveBeenCalled());

  expect(fitBoundsMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

1. **Switch the basemap to the muted style** so the day accents are the only
   colour that carries meaning:

   ```ts
   const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
   ```

2. Make the lens full-bleed from the tabs down — `relative flex-1 min-h-0` with a
   hairline top border, matching the `data-r="mapwrap"` values above.
3. Inside `map.on("load")`, for each `MapDay` with `stops.length >= 2`, add a
   GeoJSON source and a `line` layer whose `line-color` is the day's accent
   resolved to a real colour. **Do not hardcode a hex** — the color wall forbids
   it. Read the token at runtime the way the existing code already reads
   `--color-brand` (`MapLens.tsx:71`):
   `getComputedStyle(document.documentElement).getPropertyValue("--color-warning").trim()`.
   Map `AccentFamily` → CSS custom property name with a static `Record`.
4. Non-focused days draw at `line-opacity: 0.55`, the focused day at `1`.
5. Colour each day's markers with its own accent, same lookup.
6. Drive the camera from `useFocus()`: on focus change, `fitBounds` to that day's
   stops. **If the focused day has fewer than one located stop, do nothing** —
   hold the previous viewport, and let `MapFocusCard` explain. Lurching to the
   whole-trip bounds on every empty day is the behaviour this avoids.
7. Mount `<MapRail>` and `<MapFocusCard>` over the canvas.
8. In `TripBoardScreen.tsx`, gate the chips row on the lens — the rail replaces
   it in map view:

   ```tsx
   <TripHeader tripId={tripId}>
     <TripViewTabs />
     {lens !== "Map" && <DayChips days={chipModel(activeTrip)} focusedDay={focusedDay} onSelect={setFocusedDay} />}
   </TripHeader>
   ```

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Verify in the browser, on the seeded trip**

`pnpm --filter web db:reseed` if you need the fixture back
(`[Seed] Rochester to Niagara`: 4 days, Rochester + Niagara Falls, day 3
deliberately empty).

- Four rail days; day 3 flagged "No stops yet".
- Rochester and Niagara routes draw in different accents (after Phase 8's accent
  fix they will be reliably distinct; before it they may collide — that is KI-18,
  not a bug in this task).
- Clicking a rail day moves the camera; clicking day 3 leaves it where it was.
- No day-chips row in map view; it returns on the other three tabs.

- [ ] **Step 6: Run the phase gate and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components/lenses/MapLens.tsx apps/web/src/components/lenses/MapLens.test.tsx apps/web/src/components/board/TripBoardScreen.tsx
git commit -m "feat(web): per-day map with routes, day rail and focus camera"
```

---

## Phase 2 exit checklist

- [ ] The map fills the area below the tabs; the rail floats over its left side.
- [ ] Each day with 2+ located stops draws a route; the focused one is full
      strength and the rest are at 0.55 opacity.
- [ ] Clicking a rail day focuses it; an empty day holds the camera.
- [ ] The day-chips row is hidden in map view only.
- [ ] The legend's two transport-mode keys are behind a registered `<Preview>`;
      all drawn routes are solid.
- [ ] No hardcoded colours — accents are read from CSS custom properties.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter web test`,
      `node scripts/check-color-wall.mjs` all pass.
