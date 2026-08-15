# Phase 1 — Structure and navigation

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first — its
> **Global Constraints** section applies to every task here.
>
> **Phase 0 must be merged before starting this phase.**

**Goal:** the app's navigation and the trip header match the design — a global
app bar, four peer view tabs, and a sticky header that actually keeps the tabs
and day chips on screen.

**Gate for this phase:** scrolling a long trip keeps the tabs and chips visible;
every route has a way home; the header shows real dates, counts, travellers and
budget.

---

## Contract facts you need (verified, do not re-derive)

From `packages/contracts/src/detail.ts`:

```ts
TripDetail = {
  tripId, name, status,
  currency: string,             // ISO-4217, trip-level (line 24)
  budget: Money | null,         // line 25
  members: TripMember[],        // line 26, min 1
  days: { dayId, date: string | null, activityIds: string[] }[],
  backlog: string[],            // line 35
  activities: Record<string, ActivityView>,
  conflicts, dismissedConflictIds,
  tripCostTotal: number,        // line 41 — minor units, ALREADY SUMMED SERVER-SIDE
  budgetRemaining: number | null, // line 42 — budget − total, null if no budget, may be negative
}
```

**`tripCostTotal` and `budgetRemaining` already exist.** Do **not** re-sum
activity costs to get a trip total — read these fields. A second client-side
sum can diverge from the server's and would be a bug, not a refactor.

`TripMember` (`packages/contracts/src/trip.ts:232`) is
`{ userId: string; role: "owner" }` — a role field exists but `"owner"` is its
only value, and there is no display name. `TripSummary` carries `createdAt` but
**no start date**.

Component APIs you will use:

- `PageContainer({ width?: "content" | "measure" | "full", as?: "div" | "main" })`
  — always applies `mx-auto w-full px-6`.
- `TabStrip({ value, onValueChange, options, "aria-label" })` — plain
  `role="tab"` buttons, **not** Radix (Radix's trigger is pointer-only and
  silently breaks `fireEvent.click`).
- `Badge({ variant })` — `neutral | danger | warning | success | info | brand`.

---

## Task 1.1: Global app header

The design has a persistent top bar on all three routes
(`current/…dc.html:63-78`). `layout.tsx` renders fonts and `{children}` only, so
`/playbooks` has no way back.

**Design values, verbatim from the prototype:**

| element | value |
|---|---|
| bar | `background: --color-surface`, `border-bottom: 1px solid --color-hairline`, `padding: 12px 24px`, `gap: 12px 18px` |
| mark | 30×30, `border-radius: 11px`, `background: --color-brand`, `color: --color-surface`, glyph `◎`, `font-size: 15px` |
| wordmark | `--font-next-display`, 600, 16px, `--color-ink`, text "Trip Planner" |
| nav links | 14px, weight 500, `--color-slate`, `padding: 6px 10px`, `border-radius: 6px`; labels "Trips", "Playbooks" |
| right | primary Button "New trip", then a 30px `--color-moss` avatar circle with 12px/600 `--color-slate` initials |

**Files:**
- Create: `apps/web/src/components/AppHeader.tsx`
- Create: `apps/web/src/components/AppHeader.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Produces: `<AppHeader />` — no props, no client state, no trip context. It must
  stay a server component so `layout.tsx` does not become client-rendered.
- Produces: a **56px-tall** bar (`h-14`). Task 1.3 pins the trip header directly
  beneath it with `top-14`; the two values must agree.

**Note on "Quick add":** the prototype's header has a "Quick add" button. It
needs a trip context the global header does not have. **Omit it** — do not fake
it, and do not add a Preview for it (a Preview marks something we will build;
this is something that belongs on a different surface).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/AppHeader.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppHeader } from "./AppHeader";

afterEach(cleanup);

describe("AppHeader", () => {
  it("links to both routes so every page has a way back", () => {
    render(<AppHeader />);

    expect(screen.getByRole("link", { name: "Trips" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Playbooks" }).getAttribute("href")).toBe("/playbooks");
  });

  it("names the product", () => {
    render(<AppHeader />);
    expect(screen.getByText("Trip Planner")).toBeTruthy();
  });

  it("is a banner landmark", () => {
    render(<AppHeader />);
    expect(screen.getByRole("banner")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/AppHeader.test.tsx
```

Expected: FAIL — `Failed to resolve import "./AppHeader"`.

- [ ] **Step 3: Create the component**

`apps/web/src/components/AppHeader.tsx`:

```tsx
import Link from "next/link";

// Handoff `current/…dc.html:63-78`: a persistent bar on every route. Before
// this, /playbooks had no way back to the trip list at all. Deliberately a
// server component with no trip context — it must not force layout.tsx client-
// side. The prototype's "Quick add" is omitted: it needs a trip to add to, so
// it belongs on the trip surface, not here.
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-hairline bg-surface px-6">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand text-surface"
        >
          ◎
        </span>
        <span className="font-display text-md font-semibold text-ink">Trip Planner</span>
      </Link>
      <nav className="flex items-center gap-1 pl-2">
        <Link href="/" className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
          Trips
        </Link>
        <Link href="/playbooks" className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
          Playbooks
        </Link>
      </nav>
    </header>
  );
}
```

**Before writing this, confirm the utility names exist** in
`apps/web/src/app/globals.css`'s `@theme` block: `font-display`, `text-md`,
`text-base`, `bg-brand`, `text-surface`, `border-hairline`, `bg-surface`,
`text-ink`, `text-slate`. If any is named differently, use the repo's name — do
**not** introduce an arbitrary value. Grep an existing component for the pattern:
`grep -rn "font-display" apps/web/src/components | head`.

The "New trip" button and the avatar are deliberately **not** in this task —
"New trip" opens a dialog that lives on the home page (`app/page.tsx`), and
wiring it from a server component would force a client boundary. Phase 7's
wizard task re-homes it. Leave the right side empty for now.

- [ ] **Step 4: Mount it in the layout**

In `apps/web/src/app/layout.tsx`, import `AppHeader` and render it above
`{children}`:

```tsx
      <body>
        <AppHeader />
        {children}
        <Analytics />
      </body>
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/AppHeader.test.tsx
pnpm --filter web test
```

Expected: the new file PASSes. Other suites may fail if they assert on
`getByRole("banner")` and now find two banners — the trip header is also a
`<header>`. If so, that is fixed in Task 1.3, which gives the trip header an
`aria-label`; for now, narrow any failing query to
`getByRole("banner", { name: … })` rather than deleting it.

- [ ] **Step 6: Verify in the browser**

Navigate `/` → `/playbooks` → back, and `/trips/{id}` → `/`. The bar is present
and sticky on all three.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/AppHeader.tsx apps/web/src/components/AppHeader.test.tsx apps/web/src/app/layout.tsx
git commit -m "feat(web): global app header with Trips/Playbooks navigation"
```

---

## Task 1.2: Four peer view tabs

`TripViewTabs` renders three tabs plus a "More" popover holding Map, Itinerary,
Daily overview and Full trip, and relabels the trigger to the active lens — so in
Map view nothing in the strip is selected. The design
(`current/…dc.html:2469`) is exactly:

```js
viewOptions: [
  { value: 'timeline',  label: 'Timeline' },
  { value: 'columns',   label: 'Day columns' },
  { value: 'calendar',  label: 'Calendar' },
  { value: 'map',       label: 'Map' },
]
```

Decision (Mitchell, 2026-08-14): four peer tabs. Itinerary, Daily overview and
Full trip keep their code and their `?lens=` URLs but lose their nav entry.

**Files:**
- Modify: `apps/web/src/components/trip/TripViewTabs.tsx`
- Modify: `apps/web/src/components/ui/tab-strip.tsx` (comment only)
- Modify: `docs/known-issues.md`
- Test: `apps/web/src/components/trip/TripViewTabs.test.tsx`

**Interfaces:**
- Produces: `type PrimaryTab = "Timeline" | "Day columns" | "Calendar" | "Map"`.
- Consumes: `useLens()` → `{ lens, view, setLens, setLensAndView }`, unchanged.
  Lens values are `"Board" | "Schedule" | "Map" | "Itinerary" | "Daily" | "Trip"`;
  `Schedule` owns its own `view` of `"Timeline" | "Calendar"`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/trip/TripViewTabs.test.tsx`:

```tsx
it("offers exactly the four design tabs and no More menu", () => {
  renderTabs();  // the file's existing helper

  const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
  expect(tabs).toEqual(["Timeline", "Day columns", "Calendar", "Map"]);
  expect(screen.queryByRole("button", { name: /more/i })).toBeNull();
});

it("selects the Map tab when the Map lens is active", () => {
  renderTabs({ lens: "Map" });

  expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true");
});

it("switches to the Map lens when the Map tab is clicked", async () => {
  const setLens = vi.fn();
  renderTabs({ setLens });

  await userEvent.click(screen.getByRole("tab", { name: "Map" }));

  expect(setLens).toHaveBeenCalledWith("Map");
});
```

Read the top of the existing test file first and reuse its render helper and its
`useLens` mock rather than writing new ones. If it has no helper, add one that
mocks `./context/LensRouter`'s `useLens`.

- [ ] **Step 2: Run them and confirm they fail**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/trip/TripViewTabs.test.tsx
```

Expected: the first test FAILS — three tabs plus a "More" button.

- [ ] **Step 3: Rewrite the component**

Replace the whole body of `apps/web/src/components/trip/TripViewTabs.tsx` with:

```tsx
"use client";

import { TabStrip } from "@/components/ui/tab-strip";
import { useLens } from "./context/LensRouter";

// Handoff `current/…dc.html:2469`: exactly four peer views. The app's lens
// system still has six (LensRouter is untouched — no lens added, removed or
// merged, per ADR-018/M10's guardrail); Itinerary, Daily overview and Full trip
// keep working via their ?lens= URLs but are no longer in the nav. Recorded in
// docs/known-issues.md. This replaces the three-tabs-plus-"More"-popover
// arrangement, whose trigger relabelled itself to the active lens and left the
// strip showing no selection at all in Map view.
type PrimaryTab = "Timeline" | "Day columns" | "Calendar" | "Map";

const PRIMARY_TABS: readonly { value: PrimaryTab; label: string }[] = [
  { value: "Timeline", label: "Timeline" },
  { value: "Day columns", label: "Day columns" },
  { value: "Calendar", label: "Calendar" },
  { value: "Map", label: "Map" },
];

export function TripViewTabs() {
  const { lens, view, setLens, setLensAndView } = useLens();

  const primaryValue: PrimaryTab | undefined =
    lens === "Board"
      ? "Day columns"
      : lens === "Map"
        ? "Map"
        : lens === "Schedule" && view === "Timeline"
          ? "Timeline"
          : lens === "Schedule" && view === "Calendar"
            ? "Calendar"
            : undefined;

  const selectPrimary = (value: PrimaryTab) => {
    if (value === "Day columns") return setLens("Board");
    if (value === "Map") return setLens("Map");
    setLensAndView("Schedule", value === "Calendar" ? "Calendar" : "Timeline");
  };

  return <TabStrip value={primaryValue} onValueChange={selectPrimary} options={PRIMARY_TABS} aria-label="Trip view" />;
}
```

The `Button`, `Popover`, `cn` and `useState` imports are all now unused — remove
them or `pnpm lint` will fail.

- [ ] **Step 4: Update the stale TabStrip comment**

`apps/web/src/components/ui/tab-strip.tsx:14-16` explains `value: T | undefined`
by pointing at TripViewTabs' "More" menu, which no longer exists. Replace that
comment with:

```tsx
  // `undefined` is for a caller whose selection can legitimately fall outside
  // this strip's own options (TripViewTabs: the trip can be on one of the three
  // lenses that have no tab — Itinerary, Daily overview, Full trip). Every tab
  // renders unselected in that case.
```

- [ ] **Step 5: Record the deliberate gap**

Add an entry to `docs/known-issues.md`, matching the file's existing entry
format (read a neighbouring entry first and copy its shape):

> **Itinerary, Daily overview and Full-trip lenses have no navigation entry.**
> M10's four-tab strip (Timeline / Day columns / Calendar / Map) matches the
> redesign, which never contemplated the other three. Their components,
> `LensRouter` entries and `?lens=` URLs all still work — only the nav affordance
> is gone. Decide whether to re-home or retire them. Deliberate, 2026-08-14.

- [ ] **Step 6: Repoint any e2e that navigated through "More"**

```bash
grep -rn "More\|Itinerary\|Daily overview\|Full trip" apps/web/e2e
```

Any spec that clicked "More" to reach a lens must navigate by URL
(`?lens=Itinerary`) instead. Do not delete the assertions.

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/trip/TripViewTabs.test.tsx
pnpm typecheck && pnpm lint && pnpm --filter web test
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/trip/TripViewTabs.tsx apps/web/src/components/trip/TripViewTabs.test.tsx apps/web/src/components/ui/tab-strip.tsx docs/known-issues.md apps/web/e2e
git commit -m "feat(web): four peer view tabs; retire the More popover"
```

---

## Task 1.3: Tabs and day chips move inside the sticky header

In the prototype (`current/…dc.html:249`) **one** `position: sticky; top: 0`
container holds the trip head, the `TabStrip` and the day-chips row. We make only
`TripHeader` sticky and render the other two after it.

Measured on the branch at `scrollY 422`:

```
header      sticky, top 0, height 147px   (title + toolbar)
tab strip   static, top -274px            (scrolled away)
day chips   static, top -236px            (scrolled away)
```

**Files:**
- Modify: `apps/web/src/components/trip/TripHeader.tsx:94`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx:134-144`
- Test: `apps/web/src/components/trip/TripHeader.test.tsx`

**Interfaces:**
- Produces: `TripHeader` gains `children?: React.ReactNode`, rendered **inside**
  the sticky `<header>`, after the meta row. That is how the tabs and chips get in.
- Produces: the `<header>` gains `aria-label="Trip"` so it is distinguishable
  from Task 1.1's app banner.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/trip/TripHeader.test.tsx`:

```tsx
it("keeps the view tabs and day chips inside the sticky header", () => {
  renderHeader(                       // the file's existing helper
    <>
      <div role="tablist" aria-label="Trip view" />
      <div role="group" aria-label="Days" />
    </>,
  );

  const header = screen.getByRole("banner", { name: "Trip" });
  expect(header.contains(screen.getByRole("tablist", { name: "Trip view" }))).toBe(true);
  expect(header.contains(screen.getByRole("group", { name: "Days" }))).toBe(true);
});
```

Extend the file's existing render helper to forward `children` to `TripHeader`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/trip/TripHeader.test.tsx -t "sticky header"
```

Expected: FAIL — `TripHeader` does not accept children.

- [ ] **Step 3: Accept and render children**

In `TripHeader.tsx`, change the signature:

```tsx
export function TripHeader({ tripId, children }: { tripId: string; children?: React.ReactNode }) {
```

Change the opening tag at line 94 to pin below the app bar, use the trip gutter
(26px ≈ `px-6`, matching `PageContainer`), and label itself:

```tsx
    <header aria-label="Trip" className="sticky top-14 z-10 border-b border-hairline bg-surface px-6 pt-3.5">
```

`top-14` is 56px — Task 1.1's `h-14` app bar. **These two must stay in sync**;
if you change one, change the other.

Then, immediately before the closing `</header>`, after the existing
`justify-between` row's closing `</div>`, render:

```tsx
      {/* Handoff `current/…dc.html:249`: the tab strip and the day-chips row
          live INSIDE the sticky container, not after it. Before this they
          scrolled away while the header kept 147px of chrome pinned, so the two
          rows you actually navigate with were the first things to disappear. */}
      {children !== undefined && <div className="flex flex-col gap-3 pt-3 pb-3">{children}</div>}
```

- [ ] **Step 4: Move the tabs and chips into it**

In `TripBoardScreen.tsx`, replace this block:

```tsx
        <TripHeader tripId={tripId} />
        <PageContainer width="full">
          {error !== null && <p role="alert">{error}</p>}
          <TripViewTabs />
          <div className="mt-2">
            <DayChips days={chipModel(activeTrip)} focusedDay={focusedDay} onSelect={setFocusedDay} />
          </div>
        </PageContainer>
```

with:

```tsx
        <TripHeader tripId={tripId}>
          <TripViewTabs />
          <DayChips days={chipModel(activeTrip)} focusedDay={focusedDay} onSelect={setFocusedDay} />
        </TripHeader>
        {error !== null && (
          <PageContainer width="full">
            <p role="alert">{error}</p>
          </PageContainer>
        )}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/trip/TripHeader.test.tsx src/components/board/TripBoardScreen.test.tsx
```

- [ ] **Step 6: Verify in the browser, and measure**

Open a trip with several days, scroll down, and confirm the tabs and chips stay
pinned under the app bar. Then record the new header height — Phase 3 needs it:

```js
document.querySelector('header[aria-label="Trip"]').getBoundingClientRect().height
```

**Write the number into your commit message.** `Board.tsx:83-103` blames the
day-columns drag-and-drop regression on exactly this region's height pushing
columns below the fold; if the height dropped materially, note that too.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/trip/TripHeader.tsx apps/web/src/components/trip/TripHeader.test.tsx apps/web/src/components/board/TripBoardScreen.tsx
git commit -m "fix(web): pin the view tabs and day chips inside the sticky trip header

Sticky header height after this change: <N>px (was 147px)."
```

---

## Task 1.4: Header meta pill and budget chip

The design's second header line is a bordered pill, and the actions row gains a
bordered budget chip. Today we render a bare start date and a `BudgetMeter`.

**Design values, verbatim (`current/…dc.html:255-296`):**

*Meta pill* — `inline-flex`, `background: --color-surface`,
`border: 1px solid --color-hairline`, `border-radius: 999px`,
`padding: 5px 14px 5px 12px`, `gap: 6px 12px`, `margin-top: 8px`. Contents in
order: a 9px accent dot; mono 12px `--color-ink` dates; then, each separated by a
`1px × 14px --color-hairline` divider, mono 12px `--color-slate` length, stops
and cities; then a button holding 20px avatars (`margin-right: -6px`,
`1.5px solid --color-surface` ring, `--color-moss` bg, 9px/600 `--color-slate`
initials) and a mono 12px `--color-slate` crew label. The button opens settings.

*Budget chip* — a button: `background: --color-surface`,
`border: 1px solid --color-hairline`, `border-radius: 999px`,
`padding: 5px 8px 5px 14px`, `gap: 12px`. Left column: a baseline row of mono
13px `--color-ink` headline and mono 11px `--color-slate` "of X"; below it a
`132px × 4px` `--color-moss` track, `border-radius: 3px`, holding a fill bar of
the same height. Right: a `Badge`. Opens settings.

*Header actions* (`current/…dc.html:281-284`) are now ghost **Trip settings** ·
ghost **Share** · primary **Add stop**. "Add a saved day" has moved out of the
header into the plan flow (Phase 6).

**Files:**
- Create: `apps/web/src/lib/cost.ts`, `apps/web/src/lib/cost.test.ts`
- Create: `apps/web/src/components/trip/BudgetChip.tsx` + test
- Create: `apps/web/src/components/trip/TripMetaPill.tsx` + test
- Modify: `apps/web/src/components/trip/TripHeader.tsx:135-146` and its action row

**Interfaces:**

```ts
// apps/web/src/lib/cost.ts
export type TripSpend = {
  total: number;             // minor units — read from TripDetail.tripCostTotal
  unpriced: number;          // activities carrying no cost
  budget: number | null;     // minor units — TripDetail.budget?.amountMinor ?? null
  remaining: number | null;  // TripDetail.budgetRemaining; may be negative
  over: boolean;             // remaining !== null && remaining < 0
};
export function tripSpend(detail: TripDetail): TripSpend;
export function daySpend(detail: TripDetail, dayId: string): { total: number; unpriced: number };
```

**`total` is read, not computed.** `TripDetail.tripCostTotal` (detail.ts:41) is
summed server-side, and `budgetRemaining` (line 42) is derived there too. A
second client-side sum could diverge. Only `unpriced` and the **per-day** rollup
need computing here, because the server exposes neither.

Remember the contract asymmetry: `cost` is `Money.optional()` on `ActivityView`,
so "no cost" is `undefined` — but the update command allows `null`, so a value
round-tripped through it can be `null`. Treat both as unpriced.

- [ ] **Step 1: Write the failing tests for `cost.ts`**

Create `apps/web/src/lib/cost.test.ts`. Build fixtures from
`@/mocks/fixtures` — `tripDetailFixture` and `costedTripDetailFixture` already
exist (see `TripBoardScreen.test.tsx`'s imports); read them before inventing new
ones.

```tsx
import { describe, expect, it } from "vitest";
import { tripSpend, daySpend } from "./cost";
import { costedTripDetailFixture } from "@/mocks/fixtures";

describe("tripSpend", () => {
  it("reads the server-computed total rather than re-summing", () => {
    const detail = { ...costedTripDetailFixture, tripCostTotal: 12_345 };
    expect(tripSpend(detail).total).toBe(12_345);
  });

  it("counts activities with no cost as unpriced, whether undefined or null", () => {
    const detail = {
      ...costedTripDetailFixture,
      activities: {
        a: { ...costedTripDetailFixture.activities.a, cost: { amountMinor: 500, currency: "USD" } },
        b: { ...costedTripDetailFixture.activities.a, activityId: "b", cost: undefined },
        c: { ...costedTripDetailFixture.activities.a, activityId: "c", cost: null },
      },
    };
    expect(tripSpend(detail).unpriced).toBe(2);
  });

  it("reports over-budget from budgetRemaining, including the negative case", () => {
    expect(tripSpend({ ...costedTripDetailFixture, budgetRemaining: -820 }).over).toBe(true);
    expect(tripSpend({ ...costedTripDetailFixture, budgetRemaining: 7_315 }).over).toBe(false);
    expect(tripSpend({ ...costedTripDetailFixture, budgetRemaining: null }).over).toBe(false);
  });

  it("has a null budget when the trip has none", () => {
    expect(tripSpend({ ...costedTripDetailFixture, budget: null }).budget).toBeNull();
  });
});

describe("daySpend", () => {
  it("sums only the named day's activities", () => {
    const dayId = costedTripDetailFixture.days[0].dayId;
    const result = daySpend(costedTripDetailFixture, dayId);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.unpriced).toBeGreaterThanOrEqual(0);
  });

  it("returns zeroes for an unknown day", () => {
    expect(daySpend(costedTripDetailFixture, "no-such-day")).toEqual({ total: 0, unpriced: 0 });
  });
});
```

Adjust the fixture property access to whatever `costedTripDetailFixture` actually
exposes — **read `apps/web/src/mocks/fixtures.ts` first.**

- [ ] **Step 2: Run and confirm they fail**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/lib/cost.test.ts
```

- [ ] **Step 3: Implement `cost.ts`**

```ts
import type { TripDetail } from "@tc/contracts";

// Currency is trip-level, never per-event (decision, 2026-08-14), so every
// amount here shares detail.currency and callers format once with it. No
// per-amount currency branching.
//
// `total` and `remaining` are READ from the projection, not recomputed:
// TripDetail.tripCostTotal and .budgetRemaining are summed server-side
// (packages/contracts/src/detail.ts:41-42), and a second client-side sum could
// silently disagree with the figure the rest of the app trusts.
export type TripSpend = {
  total: number;
  unpriced: number;
  budget: number | null;
  remaining: number | null;
  over: boolean;
};

// `cost` is Money.optional() on ActivityView but Money.nullable().optional() on
// the update command, so an unpriced activity reads as undefined OR null.
function isUnpriced(cost: { amountMinor: number } | null | undefined): boolean {
  return cost === undefined || cost === null;
}

export function tripSpend(detail: TripDetail): TripSpend {
  const unpriced = Object.values(detail.activities).filter((a) => isUnpriced(a.cost)).length;
  return {
    total: detail.tripCostTotal,
    unpriced,
    budget: detail.budget?.amountMinor ?? null,
    remaining: detail.budgetRemaining,
    over: detail.budgetRemaining !== null && detail.budgetRemaining < 0,
  };
}

export function daySpend(detail: TripDetail, dayId: string): { total: number; unpriced: number } {
  const day = detail.days.find((d) => d.dayId === dayId);
  if (day === undefined) return { total: 0, unpriced: 0 };

  let total = 0;
  let unpriced = 0;
  for (const activityId of day.activityIds) {
    const cost = detail.activities[activityId]?.cost;
    if (isUnpriced(cost)) unpriced += 1;
    else total += cost.amountMinor;
  }
  return { total, unpriced };
}
```

- [ ] **Step 4: Run and confirm they pass**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/lib/cost.test.ts
```

- [ ] **Step 5: Write the failing test for `BudgetChip`**

```tsx
it("shows the planned total, the budget and the remaining badge", () => {
  render(<BudgetChip spend={{ total: 908_500, unpriced: 0, budget: 1_640_000, remaining: 731_500, over: false }} currency="USD" onOpenSettings={() => {}} />);

  expect(screen.getByText(/\$9,085/)).toBeTruthy();
  expect(screen.getByText(/of \$16,400/)).toBeTruthy();
  expect(screen.getByText(/\$7,315 left/)).toBeTruthy();
});

it("reads as over budget with a warning badge", () => {
  render(<BudgetChip spend={{ total: 1_722_000, unpriced: 0, budget: 1_640_000, remaining: -82_000, over: true }} currency="USD" onOpenSettings={() => {}} />);
  expect(screen.getByText(/\$820 over/)).toBeTruthy();
});

it("invites setting a budget when there is none", () => {
  render(<BudgetChip spend={{ total: 0, unpriced: 0, budget: null, remaining: null, over: false }} currency="USD" onOpenSettings={() => {}} />);
  expect(screen.getByText("Set a budget")).toBeTruthy();
});
```

- [ ] **Step 6: Run, implement, re-run**

Implement `BudgetChip` to the design values above. Use the existing money
formatter — **find it first**: `grep -rn "export function formatMoney" apps/web/src`
(there is one in `components/lenses/formatMoney.ts`). Do not write a second
formatter; **KI-2 is "money formatted two ways in the same screen" and is
assigned to M10.** Fill width is `remaining`-derived and must be clamped to
0–100%; put it in an inline `style` with the standard eslint-disable comment,
since a percentage is computed geometry with no token.

- [ ] **Step 7: Repeat for `TripMetaPill`**

Test that it renders the date range, `N days`, `N stops`, `N cities` and an
avatar per member, and that clicking the avatar group calls `onOpenSettings`.
Derive `cities` from `chipModel(detail)`'s distinct non-null `city` values —
`chipModel` is exported from `components/trip/DayChips.tsx` and is already the
single source of the per-day city derivation.

- [ ] **Step 8: Wire both into `TripHeader`**

Replace the `DataText` + `BudgetMeter` block at lines 135-146 with
`<TripMetaPill … />`. Put `<BudgetChip … />` under the action row. Change the
action row to the design's set: ghost **Trip settings** (opens `SettingsSheet`),
ghost **Share**, primary **Add stop** — and **remove `<AddSavedDayButton />`**,
which the design moved into the plan flow (Phase 6 rebuilds it there). Leave the
sync indicator, undo/redo and History cluster where it is; the design has no home
for them and re-siting them is out of scope for this phase.

- [ ] **Step 9: Run the full phase gate**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/cost.ts apps/web/src/lib/cost.test.ts apps/web/src/components/trip/BudgetChip.tsx apps/web/src/components/trip/BudgetChip.test.tsx apps/web/src/components/trip/TripMetaPill.tsx apps/web/src/components/trip/TripMetaPill.test.tsx apps/web/src/components/trip/TripHeader.tsx
git commit -m "feat(web): header meta pill and budget chip from real trip data"
```

---

## Phase 1 exit checklist

- [ ] Every route has a persistent app bar with working Trips/Playbooks links.
- [ ] Exactly four tabs; no "More"; Map is selectable and shows as selected.
- [ ] Tabs and day chips stay pinned when the trip scrolls.
- [ ] The header shows real dates, day/stop/city counts, travellers and budget.
- [ ] `docs/known-issues.md` records the three lenses with no nav entry.
- [ ] The new sticky-header height is recorded in Task 1.3's commit message.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter web test`,
      `node scripts/check-color-wall.mjs` all pass.
