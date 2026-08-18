# Phase 8 — Correctness and polish

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first.
>
> **Phases 0 and 1 must be merged.** Otherwise independent — these seven tasks
> can be done in any order, and each is a standalone commit.

**Goal:** close the remaining drift and the one genuine correctness bug in the
accent system.

**Note:** Task 8.2 is not cosmetic. It is **KI-18** — the day-accent system
currently fails at its one job.

---

## Task 8.1: The leg line stops inventing transit

The `1412 → previous` design generation replaced the invented "29 min · Metro"
with free time before the next stop. That also retires our own honest-but-odd
`~0.8 km direct` string, and removes the last reason to want a routing provider.

**Copy, verbatim (`current/…dc.html:2236-2237`):**

- gap > 0 → `{duration} until next stop` — e.g. `1 h 15 m until next stop`
- gap == 0 → `Back to back`
- gap >= **150 minutes** → additionally a warning pill reading `Nothing planned`

**Files:** `apps/web/src/components/lenses/TimelineLens.tsx:156-190` + test.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows the free time before the next stop", () => {
  renderTimeline(detailWithGap(75));
  expect(screen.getByText("1 h 15 m until next stop")).toBeTruthy();
});

it("says back to back when there is no gap", () => {
  renderTimeline(detailWithGap(0));
  expect(screen.getByText("Back to back")).toBeTruthy();
});

it("flags a gap of two and a half hours or more", () => {
  renderTimeline(detailWithGap(150));
  expect(screen.getByText("Nothing planned")).toBeTruthy();
});

it("does not flag a gap just under the threshold", () => {
  renderTimeline(detailWithGap(149));
  expect(screen.queryByText("Nothing planned")).toBeNull();
});

it("no longer claims a straight-line distance", () => {
  renderTimeline(detailWithCoordinatesOnBothStops);
  expect(screen.queryByText(/km direct/)).toBeNull();
});
```

- [ ] **Step 2: Run, implement, re-run**

Rewrite `Leg`. Delete the `haversineKm` distance suffix and the
`GAP_WARNING_THRESHOLD_MIN = 30` "Long gap" pill; the threshold is now 150.

**Do not delete `haversineKm` itself.** Phase 2's map uses it for per-day
distances. If Phase 2 has already merged it lives in `apps/web/src/lib/geo.ts` —
leave it there and just drop the timeline's import. If Phase 2 has **not** merged
yet, it is still local to `TimelineLens.tsx:127-135`: move it to `lib/geo.ts`
(function and comment verbatim) rather than deleting it, so Phase 2 finds it
where it expects. The comment explains why it is not imported from `@tc/domain`
and must travel with it.

Match the design's duration formatting (`1 h 15 m`, with spaces) — check what
`formatDuration` (`TimelineLens.tsx:89-95`) currently emits and adjust it, rather
than adding a second formatter.

- [ ] **Step 3: Commit** — `feat(web): leg line shows free time, not invented transit`

---

## Task 8.2: Day accents — collision probing and a real neutral (KI-18)

`dayAccentFor` is `djb2(city) % 5`. Verified over real names:

| city | family | | city | family |
|---|---|---|---|---|
| Tokyo | success | | New Orleans | brand |
| **Kyoto** | **danger** | | Naoshima | info |
| **Osaka** | **danger** | | Lisbon | danger |
| Nikkō | success | | Paris | danger |
| Rochester | warning | | Rome | info |
| Niagara Falls | danger | | Barcelona | danger |
| *(no city)* | info | | Portland | danger |

Seven of thirteen on `danger`. The handoff's headline trip — **Tokyo → Kyoto →
Osaka — renders Kyoto and Osaka identically.** The prototype used ten buckets
**with linear collision probing** (`cityBuckets()`); the probing is the part that
guarantees distinctness, and it was not carried over.

**Files:** `apps/web/src/lib/dayAccent.ts` + `dayAccent.test.ts`, and every caller.

**Interfaces:**

```ts
export const ACCENT_FAMILIES = ["brand", "info", "success", "warning", "danger"] as const;
export type AccentFamily = (typeof ACCENT_FAMILIES)[number] | "neutral";
export type DayAccent = { tint: AccentFamily; ink: AccentFamily; solid: AccentFamily };

/** Resolve a whole trip's cities at once, so collisions can be probed. */
export function dayAccents(cities: (string | null)[]): DayAccent[];
```

`dayAccentFor` is **removed**. Resolving one city at a time is what makes probing
impossible.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { dayAccents } from "./dayAccent";

describe("dayAccents", () => {
  it("gives the handoff's headline trip three distinct colours", () => {
    const [tokyo, kyoto, osaka] = dayAccents(["Tokyo", "Kyoto", "Osaka"]);
    expect(new Set([tokyo.solid, kyoto.solid, osaka.solid]).size).toBe(3);
  });

  it("gives the same city the same colour throughout a trip", () => {
    const a = dayAccents(["Rochester", "Niagara Falls", "Rochester"]);
    expect(a[0]).toEqual(a[2]);
  });

  it("uses an explicit neutral for a day with no known city", () => {
    expect(dayAccents([null])[0].solid).toBe("neutral");
  });

  it("does not spend a colour bucket on the unknown-city case", () => {
    const [, kyoto, osaka] = dayAccents([null, "Kyoto", "Osaka"]);
    expect(kyoto.solid).not.toBe("neutral");
    expect(osaka.solid).not.toBe("neutral");
    expect(kyoto.solid).not.toBe(osaka.solid);
  });

  it("degrades without throwing when there are more cities than families", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(() => dayAccents(many)).not.toThrow();
    expect(dayAccents(many)).toHaveLength(8);
  });

  it("is order-independent for the same set of cities", () => {
    const forward = dayAccents(["Tokyo", "Kyoto"]);
    const backward = dayAccents(["Kyoto", "Tokyo"]);
    expect(forward[0].solid).toBe(backward[1].solid);
    expect(forward[1].solid).toBe(backward[0].solid);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement the prototype's two-pass approach**

Sort the distinct non-null city names (so the result is stable regardless of the
order days appear). Pass 1: each city takes its hashed bucket if free. Pass 2:
collisions probe **forward** from their hash until they find a free bucket,
wrapping; if every bucket is taken, fall back to the raw hash. `null` maps to
`"neutral"` without consuming a bucket.

- [ ] **Step 4: Update every caller**

```bash
grep -rn "dayAccentFor" apps/web/src
```

`DayChips.tsx`, `TimelineLens.tsx`, `Board.tsx`, `CalendarLens.tsx`, and
`MapRail.tsx`/`mapRailData.ts` if Phase 2 is merged. Each computes the whole
trip's accents once — `dayAccents(chipModel(detail).map((c) => c.city))` — and
indexes by day.

**Add `neutral` to every static class `Record`** — `CHIP_BG`, `DOT_BG`,
`TINT_BG`, `SOLID_BG`, `INK_TEXT`, and any accent→CSS-variable map Phase 2 added.
Back it with `--color-moss` / `--color-slate`. Missing one produces `undefined`
in a `cn()` call, which fails silently and renders unstyled.

- [ ] **Step 5: Verify, then close KI-18**

On the seeded trip, day 3 (empty) is moss, not blue. Update `docs/known-issues.md`
— move **KI-18** to the Resolved section with what changed.

- [ ] **Step 6: Commit** — `fix(web): probe day-accent collisions; neutral for unknown city (closes KI-18)`

---

## Task 8.3: Day chip typography

The design's chip is four lines: 11px day-of-week in the **day's ink colour**; a
baseline row of a **16px mono date number** beside a **10px city**; a fixed 14px
transition slot; then 8×3px stop dots. We collapse lines 1–2 into a `text-xs`
ink-coloured day-of-week plus one truncated `DataText` (`"5 Rochest…"`).

**Files:** `apps/web/src/components/trip/DayChips.tsx:123-127` + test.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the date number and the city as separate elements", () => {
  render(<DayChips days={[{ dow: "Sat", dateNum: "5", city: "Rochester", transitionTo: null, stops: 2 }]} focusedDay={null} onSelect={vi.fn()} />);

  expect(screen.getByText("5")).toBeTruthy();
  expect(screen.getByText("Rochester")).toBeTruthy();
});
```

- [ ] **Step 2: Run, implement, re-run.** Keep the fixed `h-3.5` transition slot
      and the dot row — both are already correct.
- [ ] **Step 3: Commit** — `fix(web): restore day-chip typography to the handoff`

---

## Task 8.4: Preview badges must not cover their host

The compact badge covers part of the "Share" and "Ask" labels and the keep-day
flag; the container chip sits on the hero's third stat tile.

**Files:** `apps/web/src/components/ui/preview.tsx` + `preview.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
it("reserves space for the compact badge instead of overlapping the host", () => {
  render(<Preview id="share-button" size="compact"><button>Share</button></Preview>);
  expect(screen.getByRole("group").className).toMatch(/\bpr-/);
});
```

- [ ] **Step 2: Run, implement, re-run**

For `size="compact"`, add trailing padding to the wrapper and pin the badge into
that reserved gutter rather than hanging it over the host. For
`size="container"`, inset the chip to the border instead of `-top-1.5 -right-1.5`.
The existing header comment on `preview.tsx:58-72` explains why the badge was
moved outside the box — **update it**, do not delete the reasoning.

The Wave-1 retro notes that `Preview`'s conditional-`relative` branch
(`preview.tsx:31`) has **no test**. Add one while you are here:

```tsx
it("does not force position:relative when the caller positions itself", () => {
  render(<Preview id="assistant-suggestions" size="container" className="fixed inset-0"><p>x</p></Preview>);
  expect(screen.getByRole("group").className).not.toMatch(/\brelative\b/);
});
```

- [ ] **Step 3: Commit** — `fix(web): preview badges reserve space instead of covering the host`

---

## Task 8.5: Home page rhythm, hero and trip cards

**Files:** `apps/web/src/app/page.tsx`, `home/NextTripHero.tsx`, `home/TripCard.tsx` + tests.

Design: `PageContainer width="content"`, **30px top / 60px bottom**, a **34px**
vertical stack gap. A mono uppercase 11px `0.09em`-tracked `--color-slate` date
line above `Heading level={1}`. An "All trips" `Heading level={3}` with a trip
count line above the grid.

- [ ] **Step 1: Write the failing tests**

```tsx
it("heads the page with today's date above the title", () => {
  renderHome();
  expect(screen.getByTestId("page-date-line")).toBeTruthy();
});

it("labels the trips grid", async () => {
  renderHome();
  expect(await screen.findByRole("heading", { name: "All trips" })).toBeTruthy();
});

it("says one traveler, not one travelers", () => {
  render(<NextTripHero trip={{ ...summary, members: [{ userId: "u", role: "owner" }] }} />);
  expect(screen.getByText("traveler")).toBeTruthy();
  expect(screen.queryByText("travelers")).toBeNull();
});

it("shows the trip's dates rather than its creation date", () => {
  render(<TripCard trip={tripWithDates} />);
  expect(screen.queryByText(/^Created /)).toBeNull();
});
```

- [ ] **Step 2: Run, implement, re-run**

Fix the rhythm and the two missing headings. **Singularise the traveler label**
(`NextTripHero.tsx:154` — `label="travelers"` unconditionally).

Two honesty points, both of which must be resolved, not papered over:

- The third stat tile is **hardcoded `value="2"`** (`NextTripHero.tsx:165`).
  Drive it from the trip's real live conflict count, **or delete the tile.** Do
  not ship a fabricated number.
- `TripSummary` has no start date, so the hero picks `trips[0]`, not the next
  trip by date, and cards show `createdAt`. That cannot be fixed without a
  contract change, which this plan forbids. **Record it in
  `docs/known-issues.md`** rather than fabricating a date.

- [ ] **Step 3: Commit** — `feat(web): home head, rhythm, hero stats and trip-card dates`

---

## Task 8.6: Calendar cells

Design: an in-trip day is a **tinted button inside** a surface cell, not a tinted
cell. Cells hold a **116px minimum height**. A mono "+N more" line appears
whenever the day has more stops than the cell shows.

**Files:** `apps/web/src/components/lenses/CalendarLens.tsx` + test.

- [ ] **Step 1: Write the failing test**

```tsx
it("puts the day tint on an inner button, not the cell", () => {
  renderCalendar(detailWithOneDay);
  const button = screen.getByRole("button", { name: /Day 1/ });
  expect(button.className).toMatch(/bg-\w+-tint/);
  expect(button.parentElement?.className).toMatch(/bg-surface/);
});
```

- [ ] **Step 2: Run, implement, re-run, commit** —
      `fix(web): calendar cells use an inner tinted button`

---

## Task 8.7: Shorten the timeline route and place lines

The day-header route line is built from full geocoded `location.name` strings, so
it renders as *"Ugly Duck Coffee, Rochester, NY, USA → The Strong National Museum
of Play, Rochester, Monroe County, New York, USA"* and wraps. The same full string
is the activity's place line.

**Files:** create `apps/web/src/lib/place.ts` + test; modify
`TimelineLens.tsx:107-118` and its `ActivityRow`.

**Interfaces:**

```ts
export function shortPlace(location: Location | null | undefined): string | null;
```

Prefers `location.city` (the geocoder's structured city, documented at
`packages/contracts/src/activity.ts:38-45`), else the first comma-delimited
segment of `location.name`, else `null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("prefers the structured city", () => {
  expect(shortPlace({ name: "Ugly Duck Coffee, Rochester, NY, USA", city: "Rochester" })).toBe("Rochester");
});

it("falls back to the first segment of the full label", () => {
  expect(shortPlace({ name: "Ugly Duck Coffee, Rochester, NY, USA" })).toBe("Ugly Duck Coffee");
});

it("is null for no location", () => {
  expect(shortPlace(null)).toBeNull();
  expect(shortPlace(undefined)).toBeNull();
});
```

Plus, in `TimelineLens.test.tsx`:

```tsx
it("leaves no dangling separator when a day has no route", () => {
  renderTimeline(detailWithUnlocatedStops);
  expect(screen.getByTestId("day-meta-day-1").textContent).not.toMatch(/·\s*$/);
});
```

- [ ] **Step 2: Run, implement, re-run**

Use `shortPlace` in `routeSummary` and in `ActivityRow`'s place line. Render the
`·` separator **only** when a route exists.

There is still no true "area" field. Record in `docs/known-issues.md` that the
line is a city-or-first-segment approximation, matching the stance `cityFor`
already documents.

- [ ] **Step 3: Commit** — `fix(web): shorten the timeline route and place lines`

---

## Phase 8 exit checklist

- [ ] Legs read "N until next stop" / "Back to back", with "Nothing planned" at
      150+ minutes and no distance claim.
- [ ] Tokyo / Kyoto / Osaka are three distinct colours; unknown-city days are
      moss. KI-18 moved to Resolved.
- [ ] Day chips show a mono date number beside a separate city.
- [ ] No Preview badge overlaps its host; the conditional-`relative` branch has a test.
- [ ] Home has its date line, "All trips" heading, 34px rhythm, and no
      un-singularised or hardcoded figures.
- [ ] Calendar tints an inner button; cells are at least 116px.
- [ ] Route and place lines are short; no dangling separator.
- [ ] `docs/known-issues.md` records: no start date on `TripSummary`, and no true
      area field.
