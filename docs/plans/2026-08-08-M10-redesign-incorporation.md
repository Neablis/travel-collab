# M10 — Trip Planner Redesign incorporation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the external Trip Planner redesign to the product as one coherent visual pass — real restyle of existing surfaces, and inert `<Preview>` shells for the M9 (AI) and M11 (Playbooks) surfaces — with zero behavior change.

**Architecture:** UI-only work in `apps/web/src`. Existing surfaces (home, trip plan) are restyled against the handoff using the existing `@tc/ui` (Field Kit) components and tokens. Every not-yet-functional surface is wrapped in a single `<Preview>` seam (component + registry + sync test) that renders the real visual but inerts all controls. Shells are real components with the prop contracts M9/M11 will need, fed sample data + no-op handlers now; shared cross-surface state (focused day) is a real context, while ghost/kept/suggestion state is Preview-only sample state.

**Tech Stack:** Next.js (App Router), React, TypeScript strict, Tailwind v4 (`@theme` tokens in `globals.css`), Vitest + Testing Library, Playwright (e2e), pnpm workspaces.

## Global Constraints

- **Presentational only. Zero diff to `packages/`, `apps/web/src/server`, and `apps/web/src/app/api`** (M10 exit-gate rule; ADR-018). If a change seems to need any of those, stop and escalate — it is not M10.
- **No behavior change.** No lens added, removed, or merged; no command, route-behavior, or data change. The redesign's 3 trip-plan views map onto existing lenses (see "View mapping" below); the other lenses stay.
- **Every not-yet-functional surface goes through `<Preview id=… milestone=…>`** and has a registry entry. Shells are inert — no real or fake side effects (no "link copied" toast).
- **Shells are real components with real prop contracts** (sample data + no-op handlers now). Shared state uses properly-structured React context (extends ADR-012's trip client-state architecture), so M9/M11 swap the source, not the shape.
- **Only named tokens** — no raw color literals outside `globals.css` (the Field Kit rule; `--color-*: initial` makes an off-system color a build error).
- TypeScript strict; imports via `@tc/*` and `@/` aliases; UI must not import `@tc/domain` or `src/server` (CI-enforced lint wall).
- Commits: conventional style, one logical change; end messages with the Co-Authored-By trailer used repo-wide.
- Source of visual truth: `~/Downloads/design_handoff_trip_planner/README.md` (written) + `Trip Planner Redesign.dc.html` (prototype). Tasks cite the README section and the prototype anchor to read before editing.
- Design record: `docs/specs/2026-08-08-M10-redesign-incorporation-design.md`; decision: `docs/architecture/ADR-018-visual-pass-ahead-of-ai-behind-preview-seam.md`.

## View mapping (scope guard — read before any trip-plan task)

The prototype shows three trip-plan views. They map onto existing lenses; **do not add/remove lenses.**

| Redesign view | Existing lens/sub-view | File |
|---|---|---|
| **Day columns** | `Board` lens | `components/board/Board.tsx`, `Column.tsx`, `ActivityCard.tsx` |
| **Timeline** | `Schedule` lens → `Timeline` sub-view (`SCHEDULE_VIEWS`) | `components/lenses/ScheduleLens.tsx`, `TimelineLens.tsx` |
| **Calendar** | `Schedule` lens → `Calendar` sub-view | `components/lenses/CalendarLens.tsx` |
| (not depicted — retain, light restyle only) | `Map`, `Itinerary`, `Daily`, `Trip` | `components/lenses/*` |

`LENSES = ["Board","Map","Schedule","Itinerary","Daily","Trip"]` (`components/trip/context/LensRouter.tsx`). **Whether to eventually collapse the lens set to match the redesign's 3-view TabStrip is an explicit open question deferred out of M10** (it is a behavior/IA change, not a restyle) — record it in the retro, do not act on it here.

---

## Task 1: Token & radius deltas

**Files:**
- Modify: `apps/web/src/app/globals.css:53-63` (radius scale + new day-accent tokens)
- Modify: `apps/web/docs/design-system.md` (the human contract that changes with the tokens — find its radius/color section; if the path differs, `grep -rl "Field Kit" apps/web` finds it)

**Interfaces:**
- Produces: CSS custom properties `--radius-xl: 14px`, `--radius-2xl: 16px`, `--radius-full: 999px` (yielding `rounded-xl/2xl/full` utilities), consumed by day headers/tiles/columns/pills in later tasks.

The handoff uses radii 14 (day headers, stat tiles), 16 (day columns), and 999px (pills, avatars); only `--radius-sm/md/lg` (6/8/12) exist today.

- [ ] **Step 1: Add the radius tokens.** In the `@theme` block after `--radius-lg: 12px;` add:

```css
  --radius-xl: 14px;
  --radius-2xl: 16px;
  --radius-full: 999px;
```

- [ ] **Step 2: Verify utilities build.** Run: `pnpm --filter @tc/web build` (or `pnpm build`). Expected: builds clean; `rounded-xl`, `rounded-2xl`, `rounded-full` are now valid classes.
- [ ] **Step 3: Update the design-system doc** radius section to list 14/16/999 with their uses (day headers, day columns, pills), matching the handoff "Radius" line. Keep tokens and doc in lockstep (the file's own rule).
- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/app/globals.css apps/web/docs/design-system.md
git commit -m "feat(web): add 14/16/999px radius tokens for the redesign"
```

## Task 2: Per-city day-accent helper

**Files:**
- Create: `apps/web/src/lib/dayAccent.ts`
- Test: `apps/web/src/lib/dayAccent.test.ts`

**Interfaces:**
- Produces: `dayAccentFor(city: string | null | undefined): DayAccent` where `type DayAccent = { tint: string; ink: string; solid: string }` — each value a Field Kit token *class fragment* (e.g. `"brand"`, `"info"`, `"warning"`, `"success"`, `"danger"`) so callers compose `bg-${a.tint}-tint`, `text-${a.tint}-ink`. Day chips (Task 8) and day headers (Task 10) consume this.

The handoff derives a stable per-city accent from the tint/ink/solid families. Keep it deterministic (same city → same accent) and on-system (only the named families).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { dayAccentFor, ACCENT_FAMILIES } from "./dayAccent";

describe("dayAccentFor", () => {
  it("is deterministic per city", () => {
    expect(dayAccentFor("Tokyo")).toEqual(dayAccentFor("Tokyo"));
  });
  it("only ever returns on-system families", () => {
    for (const city of ["Tokyo", "Osaka", "Kyoto", "", null, undefined]) {
      expect(ACCENT_FAMILIES).toContain(dayAccentFor(city).tint);
    }
  });
  it("spreads distinct cities across families", () => {
    const a = dayAccentFor("Tokyo").tint;
    const b = dayAccentFor("Toyosu-is-different").tint;
    // not a hard guarantee for all pairs, but these two must differ
    expect(a).not.toEqual(b);
  });
  it("gives a stable fallback for empty city", () => {
    expect(dayAccentFor(null)).toEqual(dayAccentFor(undefined));
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `pnpm --filter @tc/web test dayAccent` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**

```ts
export const ACCENT_FAMILIES = ["brand", "info", "success", "warning", "danger"] as const;
export type AccentFamily = (typeof ACCENT_FAMILIES)[number];
export type DayAccent = { tint: AccentFamily; ink: AccentFamily; solid: AccentFamily };

// Stable string hash (djb2) → family index. Same city always maps to the same
// family; empty/nullish city hashes the empty string for a stable fallback.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function dayAccentFor(city: string | null | undefined): DayAccent {
  const family = ACCENT_FAMILIES[hash(city ?? "") % ACCENT_FAMILIES.length]!;
  return { tint: family, ink: family, solid: family };
}
```

(If the two cities in the "distinct" test happen to collide on this hash, change the second fixture string — collisions are acceptable in general, the test only pins two known-distinct values.)

- [ ] **Step 4: Run test to verify it passes.** Run: `pnpm --filter @tc/web test dayAccent` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/dayAccent.ts apps/web/src/lib/dayAccent.test.ts
git commit -m "feat(web): deterministic per-city day-accent helper"
```

## Task 3: The `<Preview>` seam + registry + sync test

**Files:**
- Create: `apps/web/src/lib/preview-registry.ts`
- Create: `apps/web/src/components/ui/preview.tsx`
- Test: `apps/web/src/components/ui/preview.test.tsx`
- Test: `apps/web/src/lib/preview-registry.test.ts`

**Interfaces:**
- Produces: `PREVIEW_REGISTRY` (const map `id → { milestone: "M9"|"M11"; wiredUpBy: string }`), `type PreviewId = keyof typeof PREVIEW_REGISTRY`, and `<Preview id={PreviewId} note?={string}>` which renders children, an `aria-disabled` corner chip `Preview · <milestone>`, and inerts controls. Every later shell task consumes `<Preview>`.

- [ ] **Step 1: Create the registry** (`preview-registry.ts`):

```ts
// The single seam listing every not-yet-functional surface. M9/M11 remove their
// entries as they wire each shell up. A sync test keeps this in lockstep with
// actual <Preview id> usage.
export const PREVIEW_REGISTRY = {
  "home-worth-attention": { milestone: "M9", wiredUpBy: "M9 proactive suggestions" },
  "home-playbooks-strip": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "assistant-rail": { milestone: "M9", wiredUpBy: "M9 AI thread" },
  "timeline-ghost": { milestone: "M9", wiredUpBy: "M9 propose→review→approve" },
  "keep-day-flag": { milestone: "M11", wiredUpBy: "M11 keep-a-day" },
  "keep-day-dialog": { milestone: "M11", wiredUpBy: "M11 keep-a-day" },
  "playbooks-route": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "insert-playbook": { milestone: "M11", wiredUpBy: "M11 insert-a-Playbook" },
  "share-button": { milestone: "M11", wiredUpBy: "M11 share links" },
  "add-saved-day": { milestone: "M11", wiredUpBy: "M11 add-a-saved-day" },
} as const;

export type PreviewId = keyof typeof PREVIEW_REGISTRY;
export type PreviewMilestone = (typeof PREVIEW_REGISTRY)[PreviewId]["milestone"];
```

- [ ] **Step 2: Write the failing component test** (`preview.test.tsx`):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Preview } from "./preview";

describe("Preview", () => {
  it("renders children and a milestone chip", () => {
    render(<Preview id="assistant-rail">{<span>rail body</span>}</Preview>);
    expect(screen.getByText("rail body")).toBeInTheDocument();
    expect(screen.getByText(/Preview · M9/)).toBeInTheDocument();
  });
  it("inerts interactive controls inside it", async () => {
    const onClick = vi.fn();
    render(
      <Preview id="assistant-rail">
        <button onClick={onClick}>Ask</button>
      </Preview>,
    );
    await userEvent.click(screen.getByText("Ask")).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });
  it("marks the region aria-disabled", () => {
    render(<Preview id="assistant-rail">body</Preview>);
    expect(screen.getByRole("group", { hidden: true })).toHaveAttribute("aria-disabled", "true");
  });
});
```

- [ ] **Step 3: Run it, verify it fails.** Run: `pnpm --filter @tc/web test preview` — Expected: FAIL (module not found).
- [ ] **Step 4: Implement `preview.tsx`.**

```tsx
import { PREVIEW_REGISTRY, type PreviewId } from "@/lib/preview-registry";

export function Preview({
  id,
  note,
  children,
  className,
}: {
  id: PreviewId;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { milestone } = PREVIEW_REGISTRY[id];
  return (
    <div
      role="group"
      aria-disabled="true"
      data-preview-id={id}
      title={note ?? `Coming in ${milestone}`}
      className={`relative ${className ?? ""}`}
    >
      {/* Shield: renders above children, swallows pointer events so no control
          inside a Preview ever fires. children keep their real markup/prop API. */}
      <div className="pointer-events-none select-none [&_a]:pointer-events-none [&_button]:pointer-events-none">
        {children}
      </div>
      <span className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-surface">
        Preview · {milestone}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Run it, verify it passes.** Run: `pnpm --filter @tc/web test preview` — Expected: PASS.
- [ ] **Step 6: Write the registry↔usage sync test** (`preview-registry.test.ts`). This enforces "no orphan registry entries, no unregistered ids":

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_REGISTRY, type PreviewId } from "./preview-registry";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

const SRC = join(__dirname, "..");
const used = new Set<string>();
for (const file of walk(SRC)) {
  if (file.endsWith("preview.tsx")) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/<Preview[^>]*\bid=["']([\w-]+)["']/g)) used.add(m[1]!);
}

describe("preview registry ↔ usage", () => {
  it("every used <Preview id> is registered", () => {
    for (const id of used) expect(PREVIEW_REGISTRY).toHaveProperty(id);
  });
  it("every registered id is used at least once (no orphans)", () => {
    for (const id of Object.keys(PREVIEW_REGISTRY) as PreviewId[]) {
      expect(used, `registry entry "${id}" is unused — remove it`).toContain(id);
    }
  });
});
```

- [ ] **Step 7: Run it — expect it to FAIL now** (no shells use `<Preview>` yet), which is correct. To keep the suite green until shells exist, temporarily guard the orphan assertion with `if (used.size === 0) return;` at the top of the second test **and leave a `// TODO(remove after Task 18): shells not built yet` note**. Remove the guard in Task 18's final step.
- [ ] **Step 8: Commit.**

```bash
git add apps/web/src/lib/preview-registry.ts apps/web/src/lib/preview-registry.test.ts apps/web/src/components/ui/preview.tsx apps/web/src/components/ui/preview.test.tsx
git commit -m "feat(web): Preview seam + registry with usage-sync test"
```

## Task 4: FocusProvider (real cross-surface focused-day state)

**Files:**
- Create: `apps/web/src/components/trip/context/FocusProvider.tsx`
- Test: `apps/web/src/components/trip/context/FocusProvider.test.tsx`
- Modify: `apps/web/src/app/trips/[tripId]/page.tsx` (mount `FocusProvider` inside `TripProvider`)

**Interfaces:**
- Produces: `FocusProvider`, `useFocus(): { focusedDay: number | null; setFocusedDay: (i: number | null) => void }`. Day chips (Task 8) call `setFocusedDay`; the timeline (Task 10) reads `focusedDay` to scroll/highlight. This is **real** behavior (the handoff: "day chips jump the timeline and set it as focused").

- [ ] **Step 1: Write the failing test.**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FocusProvider, useFocus } from "./FocusProvider";

function Probe() {
  const { focusedDay, setFocusedDay } = useFocus();
  return <button onClick={() => setFocusedDay(2)}>focus:{String(focusedDay)}</button>;
}

describe("FocusProvider", () => {
  it("defaults to null and updates on set", async () => {
    render(<FocusProvider><Probe /></FocusProvider>);
    expect(screen.getByText("focus:null")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("focus:2")).toBeInTheDocument();
  });
  it("throws when used outside the provider", () => {
    expect(() => render(<Probe />)).toThrow(/useFocus outside/);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test FocusProvider` — Expected: FAIL.
- [ ] **Step 3: Implement** (mirror TripProvider's context shape/idiom):

```tsx
"use client";
import { createContext, useContext, useMemo, useState } from "react";

type FocusCtx = { focusedDay: number | null; setFocusedDay: (i: number | null) => void };
const Ctx = createContext<FocusCtx | null>(null);

export function useFocus(): FocusCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFocus outside FocusProvider");
  return v;
}

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const value = useMemo(() => ({ focusedDay, setFocusedDay }), [focusedDay]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 4: Run it, verify it passes.** Run: `pnpm --filter @tc/web test FocusProvider` — Expected: PASS.
- [ ] **Step 5: Mount it** in `page.tsx`, wrapping the tree inside `TripProvider` (so it can later read trip data if needed) and outside `LensRouter`:

```tsx
<TripProvider tripId={tripId}>
  <FocusProvider>
    <EditorHost>
      <LensRouter>
        <TripBoardScreen tripId={tripId} />
      </LensRouter>
    </EditorHost>
  </FocusProvider>
</TripProvider>
```

- [ ] **Step 6: Run the app's provider/screen tests.** Run: `pnpm --filter @tc/web test TripBoardScreen` — Expected: PASS (no behavior change; provider is inert until consumed).
- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/trip/context/FocusProvider.tsx apps/web/src/components/trip/context/FocusProvider.test.tsx apps/web/src/app/trips/\[tripId\]/page.tsx
git commit -m "feat(web): FocusProvider for cross-surface focused-day state"
```

## Task 5: Sparkline component ("shape of the trip")

**Files:**
- Create: `apps/web/src/components/trip/Sparkline.tsx`
- Test: `apps/web/src/components/trip/Sparkline.test.tsx`

**Interfaces:**
- Consumes: `TripDetail` day/activity shape (`import type { TripDetail } from "@tc/contracts"`; inspect `packages/contracts` for exact day/activity field names before writing — do not guess).
- Produces: `<Sparkline days={SparklineDay[]} onSelectDay?={(i:number)=>void} />` where `SparklineDay = { stops: number }`, and a pure `sparklineBars(days, opts?)` helper returning per-day bar heights. The hero (Task 6) consumes `<Sparkline>`.

Handoff (README §1 next-trip hero + prototype `buildDays(`): one clickable column per day, ~13px stacked bars per stop, 5px gaps, 96px tall, on `--color-moss`.

- [ ] **Step 1: Write the failing test for the pure helper.**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline, sparklineBars } from "./Sparkline";

describe("sparklineBars", () => {
  it("emits one column per day with a bar per stop", () => {
    const bars = sparklineBars([{ stops: 2 }, { stops: 0 }, { stops: 4 }]);
    expect(bars.map((c) => c.length)).toEqual([2, 0, 4]);
  });
});

describe("Sparkline", () => {
  it("renders one clickable column per day", () => {
    render(<Sparkline days={[{ stops: 1 }, { stops: 3 }]} onSelectDay={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test Sparkline` — Expected: FAIL.
- [ ] **Step 3: Implement** `sparklineBars` (pure) + the presentational component. Columns are `<button>` calling `onSelectDay(i)`; bars use the day accent from Task 2; container `bg-moss`, 96px tall, 5px gaps. Read README §1 for exact metrics.
- [ ] **Step 4: Run it, verify it passes.** Run: `pnpm --filter @tc/web test Sparkline` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/trip/Sparkline.tsx apps/web/src/components/trip/Sparkline.test.tsx
git commit -m "feat(web): trip sparkline (shape of the trip)"
```

## Task 6: Home — next-trip hero (real data)

**Files:**
- Modify: `apps/web/src/app/page.tsx` (the home route)
- Create: `apps/web/src/components/home/NextTripHero.tsx`
- Test: `apps/web/src/components/home/NextTripHero.test.tsx`

**Interfaces:**
- Consumes: `TripSummary` (already used in `page.tsx`) + `Sparkline` (Task 5). Determine "next trip" from the existing `trips` list (first upcoming by start date; if `TripSummary` lacks a start date, use the first trip and note it — do **not** add server fields, that would break the presentational-only rule).
- Produces: `<NextTripHero trip={TripSummary} onOpen shareSlot={ReactNode} />` where `shareSlot` receives the Preview-wrapped Share button (Task 18) so the hero itself stays behavior-free about sharing.

Handoff README §1 "Next-trip hero": `Card raised`, two columns `1.15fr 1fr`, brand `Badge` "Next trip", `Heading level={2}`, mono meta row, avatar stack, three stat tiles (brand/warning/danger tints), primary "Open plan" + secondary Share; right column `--color-moss` panel with the sparkline + segment pills.

- [ ] **Step 1: Write the failing render test** asserting: brand "Next trip" badge, the trip name as a level-2 heading, three stat tiles present, an "Open plan" control, and a `Sparkline` (query by its buttons). Use a fixture `TripSummary`.
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test NextTripHero` — Expected: FAIL.
- [ ] **Step 3: Implement** `NextTripHero` from the handoff spec using `Card`, `Badge`, `Heading`, `DataText`, `Button` from `@/components/ui/*`; stat tiles hand-styled with the tint/ink families and `rounded-xl`; avatar stack hand-styled (30px circles, brand-tint, 2px surface ring, −8px overlap). "Open plan" links to `/trips/{id}`.
- [ ] **Step 4: Render it in `page.tsx`** above the trips list, only when a next trip exists.
- [ ] **Step 5: Run tests.** Run: `pnpm --filter @tc/web test NextTripHero page` — Expected: PASS (update `page.test.tsx` DOM assertions the new markup changes).
- [ ] **Step 6: Browser-verify** (see the Verification workflow at the end): home renders the hero with a real trip, sparkline columns click through to focus. Screenshot.
- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/app/page.tsx apps/web/src/components/home/
git commit -m "feat(web): next-trip hero on home"
```

## Task 7: Home — all-trips grid with accent bars (real data)

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/home/TripCard.tsx`
- Test: `apps/web/src/components/home/TripCard.test.tsx`

**Interfaces:**
- Consumes: `TripSummary`. Keeps the existing menu (Duplicate/Delete via `Popover`) and its handlers — move the current row's menu into `TripCard` unchanged.
- Produces: `<TripCard trip menuSlot />`.

Handoff README §1 "All trips": 3-col grid, 14px gap; each `Card` has a 46×6px accent bar, 20px display name, mono dates, 13px summary, footer with avatars + state `Badge`. **Also addresses `TODO.md`'s "richer trip-list metadata" item:** show start date / length / cost from `TripSummary` (derivable fields already present) instead of the raw `createdAt` ISO string. If a field isn't on `TripSummary`, show what is — do not add server fields.

- [ ] **Step 1: Write the failing test** asserting a card renders the trip name (display size), a state `Badge`, and the accent bar element (`data-testid="accent-bar"` or role), and that the actions menu still exposes Duplicate + Delete.
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test TripCard` — Expected: FAIL.
- [ ] **Step 3: Implement** `TripCard` with the accent bar (`dayAccentFor` on the trip's primary city if available, else brand), display-size name, mono dates, footer badge; keep the `Popover` menu and pass its handlers via `menuSlot` or props. Replace the raw `createdAt` render.
- [ ] **Step 4: Swap the grid in `page.tsx`** from the `<ul>` list to a responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5`) of `TripCard`. Keep `EmptyState` for zero trips, keep delete/undo/duplicate logic intact.
- [ ] **Step 5: Run tests.** Run: `pnpm --filter @tc/web test TripCard page` — Expected: PASS (update `page.test.tsx`).
- [ ] **Step 6: Browser-verify** delete → undo toast, duplicate, and responsive collapse (3→2→1 at 1040/820). Screenshot.
- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/app/page.tsx apps/web/src/components/home/TripCard.tsx apps/web/src/components/home/TripCard.test.tsx
git commit -m "feat(web): all-trips grid with accent-bar cards"
```

## Task 8: Day-chips row (real data, sets focus)

**Files:**
- Create: `apps/web/src/components/trip/DayChips.tsx`
- Test: `apps/web/src/components/trip/DayChips.test.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx` (render `DayChips` under the `TabStrip`)

**Interfaces:**
- Consumes: `activeTrip` (`TripDetail`) from `useTrip()`, `useFocus()` (Task 4), `dayAccentFor` (Task 2).
- Produces: `<DayChips days={ChipDay[]} focusedDay onSelect />` and a pure `chipModel(detail): ChipDay[]` where `ChipDay = { dow: string; dateNum: string; city: string | null; transitionTo: string | null; stops: number }`.

Handoff README §2 "Day chips row" + prototype `data-r` chips: horizontally scrolling, 92px wide, 12px radius, day-tinted; line 1 day-of-week; line 2 mono date number + city; line 3 the **transition line** ("→ dest city") that is a **fixed 14px slot always present even when empty**; line 4 stop dots (8×3px). Clicking sets focus.

- [ ] **Step 1: Write the failing test** for `chipModel` (one entry per day; `transitionTo` set only when the city changes vs previous day) and for the component (renders N chips; clicking a chip calls `onSelect(i)`; the transition slot element is always present even when `transitionTo` is null — assert the slot node exists on a no-transition chip).
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test DayChips` — Expected: FAIL.
- [ ] **Step 3: Implement** `chipModel` (pure; read `packages/contracts` for the real day/activity field names — city likely derives from an activity's `location`) and the presentational row; the transition line is a fixed-height (`h-3.5`) element rendered always. Chip click → `onSelect(i)`.
- [ ] **Step 4: Wire into `TripBoardScreen`** below the `TabStrip`: `const { focusedDay, setFocusedDay } = useFocus();` then render `<DayChips days={chipModel(activeTrip)} focusedDay={focusedDay} onSelect={setFocusedDay} />`. No lens/command change.
- [ ] **Step 5: Run tests.** Run: `pnpm --filter @tc/web test DayChips TripBoardScreen` — Expected: PASS (update `TripBoardScreen.test.tsx` for the new row).
- [ ] **Step 6: Browser-verify** chips render, scroll, and clicking sets focus (visible once Task 10 consumes it; for now assert via test). Screenshot.
- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/trip/DayChips.tsx apps/web/src/components/trip/DayChips.test.tsx apps/web/src/components/board/TripBoardScreen.tsx
git commit -m "feat(web): day-chips row that sets focused day"
```

## Task 9: Trip sticky header restyle

**Files:**
- Modify: `apps/web/src/components/trip/TripHeader.tsx`
- Modify: `apps/web/src/components/trip/TripHeader.test.tsx` (assertion updates only)

**Interfaces:**
- Consumes: existing `TripHeader` props/state (name, state badge, dates, `SyncIndicator`). Do not change its data or handlers.

Handoff README §2 sticky header: `--color-surface`, 1px hairline bottom, back link "← Your trips" (12px slate), `Heading level={2}` name + neutral `Badge` state, mono meta row; actions ghost "Share" (Task 18 Preview) · secondary "Add a saved day" (Task 18 Preview) · primary "Add stop" (existing editor trigger). Keep the existing `SyncIndicator` (KI-5) placement.

- [ ] **Step 1: Restyle** the header markup to the handoff (sticky, hairline, back link, meta row, action cluster). Leave the "Share" and "Add a saved day" slots as placeholders wired in Task 18; keep "Add stop" pointing at the existing editor. Keep `SyncIndicator`.
- [ ] **Step 2: Update `TripHeader.test.tsx`** assertions for the new structure; keep any behavior assertions (rename, sync indicator) intact.
- [ ] **Step 3: Run tests.** Run: `pnpm --filter @tc/web test TripHeader` — Expected: PASS.
- [ ] **Step 4: Browser-verify** the header, sticky-on-scroll, sync indicator still updates. Screenshot.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/trip/TripHeader.tsx apps/web/src/components/trip/TripHeader.test.tsx
git commit -m "feat(web): restyle trip sticky header to redesign"
```

## Task 10: Timeline view restyle (day headers, activity rows, legs) + inline Preview shells

**Files:**
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx` (+ `ScheduleLens.tsx` if it owns the Timeline sub-view chrome)
- Modify: `apps/web/src/components/lenses/TimelineLens.test.tsx`
- Create: `apps/web/src/components/trip/KeepDayFlag.tsx` (the flag button shell)

**Interfaces:**
- Consumes: `activeTrip` (`TripDetail`), `useFocus()` (scroll/highlight the focused day), `dayAccentFor`, `<Preview>`.
- Produces: `<KeepDayFlag dayIndex />` rendered inside `<Preview id="keep-day-flag" milestone="M11">` (inert pennant button; no dialog wiring yet — Task 17 adds the dialog shell).

Handoff README §"Timeline view": max-width 920px; **day header** = `rounded-xl` block in the day tint, two rows (Day N + mono date + city/travel pill + stop meter pill + keep-day flag + secondary "Add stop"; row 2 the mono summary line). **Activity rows** = 92px right-aligned time column (`DataText`) + `Card` with a 4px accent rail, title, optional `Badge`, place·area line, optional note block (`bg-paper` `rounded-sm`), right column with avatar + ghost "Ask"/"Edit". **Legs** = indented dotted left border, mono travel time, optional warning-tint gap pill.

- [ ] **Step 1: Restyle the day header** to the handoff block; read `focusedDay` from `useFocus()` and scroll the focused day's header into view + highlight it (`useEffect` + `ref`). Add the stop-meter pill (one dot per stop + mono "Xh Ym out").
- [ ] **Step 2: Add the keep-day flag shell.** Create `KeepDayFlag` (icon-only pennant, 30px circle, day-ink glyph) and render it in the day header wrapped in `<Preview id="keep-day-flag" milestone="M11">` — inert, no celebration.
- [ ] **Step 3: Restyle activity rows and legs** to the handoff. The per-row ghost **"Ask"** button is an AI affordance — wrap it in `<Preview id="timeline-ghost" milestone="M9">` (or omit "Ask" and keep only the working "Edit" that opens the existing editor; prefer keeping a Preview "Ask" so the surface matches the handoff). "Edit" keeps its existing behavior.
- [ ] **Step 4: Update `TimelineLens.test.tsx`** for the new structure; add an assertion that the keep-day flag is inside a Preview region (query `[data-preview-id="keep-day-flag"]`).
- [ ] **Step 5: Run tests.** Run: `pnpm --filter @tc/web test TimelineLens` — Expected: PASS.
- [ ] **Step 6: Browser-verify** timeline day headers/rows/legs, and that clicking a day chip (Task 8) scrolls the timeline to that day. Screenshot before/after.
- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/lenses/TimelineLens.tsx apps/web/src/components/lenses/ScheduleLens.tsx apps/web/src/components/lenses/TimelineLens.test.tsx apps/web/src/components/trip/KeepDayFlag.tsx
git commit -m "feat(web): restyle timeline view; keep-day flag Preview shell"
```

## Task 11: Day columns (Board) restyle

**Files:**
- Modify: `apps/web/src/components/board/Board.tsx`, `Column.tsx`, `ActivityCard.tsx`
- Modify: the corresponding `*.test.tsx` (assertion updates only)

**Interfaces:**
- Consumes: existing `Board` props/callbacks (`onMove`, `onAddDay`, `onAddActivity`, …) — **unchanged**. Restyle only.

Handoff README §"Day columns view": horizontally scrolling 268px columns, `rounded-2xl`, day tint; compact cards (12px padding); a dashed "+ Add" button per column. Keep drag-to-move and the add/remove behavior exactly.

- [ ] **Step 1: Restyle** columns (268px, `rounded-2xl`, `dayAccentFor` tint) and compact cards; keep the dashed add button wired to the existing `onAddActivity`. Preserve DnD.
- [ ] **Step 2: Update** `board.test.tsx` / `Column`/`ActivityCard` tests for markup; keep all DnD/behavior assertions.
- [ ] **Step 3: Run tests.** Run: `pnpm --filter @tc/web test board Column ActivityCard` — Expected: PASS.
- [ ] **Step 4: Browser-verify** drag-to-move still works; columns styled. Screenshot.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/board/Board.tsx apps/web/src/components/board/Column.tsx apps/web/src/components/board/ActivityCard.tsx apps/web/src/components/board/*.test.tsx
git commit -m "feat(web): restyle day-columns (Board) view"
```

## Task 12: Calendar view restyle

**Files:**
- Modify: `apps/web/src/components/lenses/CalendarLens.tsx`
- Modify: `apps/web/src/components/lenses/CalendarLens.test.tsx` (if present; else add a minimal render test)

**Interfaces:**
- Consumes: existing `CalendarLens` props — unchanged. Restyle only. Calendar cells set focus via `useFocus()` (handoff: calendar cells jump the timeline/focus).

Handoff README §"Calendar view": 7-column grid, 1px hairline gaps, 116px min cell height; in-trip days show a tinted button with city, first stop, mono "+N more".

- [ ] **Step 1: Restyle** to the 7-col grid; in-trip cells are tinted buttons calling `setFocusedDay`. Keep any existing behavior.
- [ ] **Step 2: Add/Update** the test (render 7 columns; in-trip cell click calls focus).
- [ ] **Step 3: Run tests.** Run: `pnpm --filter @tc/web test CalendarLens` — Expected: PASS.
- [ ] **Step 4: Browser-verify** within the Schedule lens's Calendar sub-view. Screenshot.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/lenses/CalendarLens.tsx apps/web/src/components/lenses/CalendarLens.test.tsx
git commit -m "feat(web): restyle calendar view"
```

## Task 13: Retained lenses + dialogs light restyle

**Files:**
- Modify: `apps/web/src/components/lenses/{MapLens,ItineraryLens,DailyOverviewLens,FullTripOverviewLens}.tsx` (spacing/type/token alignment only)
- Modify: the New-trip form (in `apps/web/src/app/page.tsx`) and Add-stop editor (`apps/web/src/components/board/ActivityEditor.tsx` / `trip/editor/ActivityEditorSheet.tsx`)

**Interfaces:** No prop/behavior change anywhere in this task.

The redesign doesn't depict Map/Itinerary/Daily/Trip; they stay (presentational-only rule). Bring their spacing/type into the handoff rhythm so they don't look orphaned. Restyle the New-trip and Add-stop dialogs to the handoff dialog spec (fields, slot-availability note); any AI "suggested matching places" affordance is wrapped in `<Preview id="timeline-ghost" milestone="M9">` or omitted.

- [ ] **Step 1: Align** the four retained lenses' spacing/type to the token rhythm; no structural change.
- [ ] **Step 2: Restyle** New-trip + Add-stop dialogs; keep their submit behavior.
- [ ] **Step 3: Run tests.** Run: `pnpm --filter @tc/web test lenses ActivityEditor page` — Expected: PASS (update assertions as needed).
- [ ] **Step 4: Browser-verify** each retained lens and both dialogs. Screenshots.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/lenses/ apps/web/src/components/board/ActivityEditor.tsx apps/web/src/components/trip/editor/ActivityEditorSheet.tsx apps/web/src/app/page.tsx
git commit -m "feat(web): align retained lenses and dialogs to redesign"
```

## Task 14: Assistant rail shell (M9 Preview)

**Files:**
- Create: `apps/web/src/components/assistant/AssistantRail.tsx`
- Create: `apps/web/src/components/assistant/preview-fixtures.ts`
- Test: `apps/web/src/components/assistant/AssistantRail.test.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx` (mount the rail)

**Interfaces:**
- Produces (real prop contract, M9 fills it): `<AssistantRail contextLine={string} suggestions={Suggestion[]} quickAsks={string[]} onAsk={(text:string)=>void} onKeepGhost={(id:string)=>void} onDismiss={(id:string)=>void} onHide={()=>void} />` where `Suggestion = { id: string; location: string; title: string; body: string; cta: string }`. Mounted inside `<Preview id="assistant-rail" milestone="M9">`, fed `PREVIEW_SUGGESTIONS` + no-op handlers.

Handoff README §"Assistant rail": 356px right rail, hairline left border, header + "Hide", context line on `bg-paper`, suggestion cards (brand dot, mono location, title, body, secondary CTA + ghost Dismiss), quick-ask chips, input + "Ask"; below 1180px a fixed overlay with a `rgba(21,29,46,0.32)` scrim.

- [ ] **Step 1: Write the failing test:** renders the context line, N suggestion cards from a fixture, quick-ask chips, and an Ask input; and the whole thing sits inside a `[data-preview-id="assistant-rail"]` region.
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test AssistantRail` — Expected: FAIL.
- [ ] **Step 3: Implement** the rail (real prop contract) + `preview-fixtures.ts` (sample suggestions/context line from the prototype fixtures). Context line can read `useFocus()` to say "Looking at Day N" so the Preview feels alive without doing anything.
- [ ] **Step 4: Mount** in `TripBoardScreen` wrapped in `<Preview id="assistant-rail" milestone="M9">` with `PREVIEW_SUGGESTIONS` + no-op handlers; implement the ≥1180px rail / <1180px overlay+scrim responsive behavior (CSS only; the overlay open/close can be local UI state — it toggles visibility, not product behavior).
- [ ] **Step 5: Run tests.** Run: `pnpm --filter @tc/web test AssistantRail TripBoardScreen` — Expected: PASS.
- [ ] **Step 6: Browser-verify** rail at desktop and the overlay+scrim under 1180px; confirm controls are inert. Screenshots at both widths.
- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/assistant/ apps/web/src/components/board/TripBoardScreen.tsx
git commit -m "feat(web): assistant rail Preview shell (M9)"
```

## Task 15: In-timeline proposal ("ghost") shell (M9 Preview)

**Files:**
- Create: `apps/web/src/components/assistant/GhostProposal.tsx`
- Test: `apps/web/src/components/assistant/GhostProposal.test.tsx`
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx` (render one sample ghost in the focused day)

**Interfaces:**
- Produces: `<GhostProposal proposal={Proposal} onKeep onDiscard />` where `Proposal = { id: string; title: string; why: string; start: string; end: string }`, wrapped in `<Preview id="timeline-ghost" milestone="M9">`. Fed one sample proposal + no-op handlers.

Handoff README §"Assistant proposals (ghosts)": dashed 1px `--color-brand` card on `--color-brand-tint`, "Assistant proposal" outline chip, primary "Keep" + ghost "Discard".

- [ ] **Step 1: Write the failing test:** renders the proposal title/why + Keep/Discard, inside `[data-preview-id="timeline-ghost"]`.
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test GhostProposal` — Expected: FAIL.
- [ ] **Step 3: Implement** the dashed brand card. Render one sample ghost in the focused day in `TimelineLens` (behind the Preview seam), so the surface reads as intended.
- [ ] **Step 4: Run tests.** Run: `pnpm --filter @tc/web test GhostProposal TimelineLens` — Expected: PASS.
- [ ] **Step 5: Browser-verify** the ghost appears in the timeline, inert. Screenshot.
- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/assistant/GhostProposal.tsx apps/web/src/components/assistant/GhostProposal.test.tsx apps/web/src/components/lenses/TimelineLens.tsx
git commit -m "feat(web): timeline ghost-proposal Preview shell (M9)"
```

## Task 16: Home Preview shells — "Worth your attention" (M9) + "Your Playbooks" strip (M11)

**Files:**
- Create: `apps/web/src/components/home/WorthYourAttention.tsx`
- Create: `apps/web/src/components/home/PlaybooksStrip.tsx`
- Create: `apps/web/src/components/home/preview-fixtures.ts`
- Test: `apps/web/src/components/home/WorthYourAttention.test.tsx`, `PlaybooksStrip.test.tsx`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Produces: `<WorthYourAttention items={AttentionRow[]} />` (`AttentionRow = { id; title; body; cta }`) in `<Preview id="home-worth-attention" milestone="M9">`; `<PlaybooksStrip playbooks={PlaybookCard[]} />` (`PlaybookCard = { id; city; name; span; window; shape: number[] }`) in `<Preview id="home-playbooks-strip" milestone="M11">`. Both fed fixtures + no-op.

- [ ] **Step 1: Write failing render tests** for both (rows/cards from fixtures; each inside its `[data-preview-id]`).
- [ ] **Step 2: Run them, verify they fail.** Run: `pnpm --filter @tc/web test WorthYourAttention PlaybooksStrip` — Expected: FAIL.
- [ ] **Step 3: Implement** both per README §1 ("Your Playbooks" 4-col compact cards with 64px shape strip; "Worth your attention" `Panel` rows with brand dot + ghost CTA), + fixtures from the prototype.
- [ ] **Step 4: Render** both in `page.tsx` (strip after the trips grid; panel last), each behind its Preview seam.
- [ ] **Step 5: Run tests.** Run: `pnpm --filter @tc/web test WorthYourAttention PlaybooksStrip page` — Expected: PASS.
- [ ] **Step 6: Browser-verify** + responsive (4→2 at 1180). Screenshot.
- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/home/ apps/web/src/app/page.tsx
git commit -m "feat(web): home Preview shells — worth-your-attention (M9) + playbooks strip (M11)"
```

## Task 17: Keep-this-day dialog shell (M11 Preview)

**Files:**
- Create: `apps/web/src/components/trip/KeepDayDialog.tsx`
- Test: `apps/web/src/components/trip/KeepDayDialog.test.tsx`
- Modify: `apps/web/src/components/trip/KeepDayFlag.tsx` (open the dialog shell on click — still inert overall since the whole flag is inside `<Preview>`)

**Interfaces:**
- Produces: `<KeepDayDialog open onOpenChange />` — name/what's-included/visibility fields, wrapped `<Preview id="keep-day-dialog" milestone="M11">`. **No celebration, no toast, no save/share** (that is M11). The confirm button is inert.

Handoff README §"Keep this day": the dialog (name, what's included, visibility). The celebrate() choreography is explicitly deferred to M11 (see the spec).

- [ ] **Step 1: Write the failing test:** dialog renders name/visibility fields inside `[data-preview-id="keep-day-dialog"]`; confirm does nothing (no toast text appears).
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test KeepDayDialog` — Expected: FAIL.
- [ ] **Step 3: Implement** the dialog shell using `Dialog`, `FormField`, `Input`, `NativeSelect`. Confirm is inert.
- [ ] **Step 4: Run tests.** Run: `pnpm --filter @tc/web test KeepDayDialog KeepDayFlag` — Expected: PASS.
- [ ] **Step 5: Browser-verify** flag → dialog opens, confirm does nothing, no toast. Screenshot.
- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/trip/KeepDayDialog.tsx apps/web/src/components/trip/KeepDayDialog.test.tsx apps/web/src/components/trip/KeepDayFlag.tsx
git commit -m "feat(web): keep-this-day dialog Preview shell (M11)"
```

## Task 18: Playbooks route + Share / Add-a-saved-day / Insert-a-Playbook shells (M11 Preview)

**Files:**
- Create: `apps/web/src/app/playbooks/page.tsx`
- Create: `apps/web/src/components/playbooks/PlaybooksScreen.tsx`, `PlaybookCard.tsx`, `preview-fixtures.ts`
- Test: `apps/web/src/components/playbooks/PlaybooksScreen.test.tsx`
- Create: `apps/web/src/components/trip/ShareButton.tsx` (Preview), `AddSavedDayButton.tsx` (Preview), `InsertPlaybookDialog.tsx` (Preview)
- Modify: `apps/web/src/components/home/NextTripHero.tsx` + `trip/TripHeader.tsx` (fill the Share / Add-a-saved-day slots)

**Interfaces:**
- Produces: a `/playbooks` route rendering `<PlaybooksScreen>` inside `<Preview id="playbooks-route" milestone="M11">`; `<ShareButton>` (`id="share-button"`), `<AddSavedDayButton>` (`id="add-saved-day"`), `<InsertPlaybookDialog>` (`id="insert-playbook"`) — all inert, fed fixtures/no-op.

Handoff README §3 "Playbooks": intro, info `Banner`, `SegmentedControl` filter + city `NativeSelect`, 3-col grid of `Card raised` (city pill + origin badge, name, mono span, 72px shape strip, up to 3 preview rows, tag pills, footer with ghost Share + secondary "Add to trip"), closing with a dashed "Community Playbooks" placeholder card.

- [ ] **Step 1: Write the failing test** for `PlaybooksScreen` (renders the banner, filter controls, N playbook cards from a fixture, and the Community placeholder card; whole screen inside `[data-preview-id="playbooks-route"]`).
- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @tc/web test PlaybooksScreen` — Expected: FAIL.
- [ ] **Step 3: Implement** `PlaybooksScreen` + `PlaybookCard` + fixtures per the handoff; the `/playbooks` route renders it behind the Preview seam.
- [ ] **Step 4: Implement** `ShareButton`, `AddSavedDayButton`, `InsertPlaybookDialog` (each its own `<Preview>` id) and fill the slots left in Task 6 (hero Share), Task 9 (header Share + Add-a-saved-day).
- [ ] **Step 5: Add a nav entry** to `/playbooks` (the home page head's secondary "Start from a Playbook" per README §1 — wrap in `<Preview id="playbooks-route">`? No: the *link* may navigate to the route, which itself is Preview. Make the link real so the route is reachable; the route's content is the Preview). Confirm the link navigates.
- [ ] **Step 6: Remove the temporary orphan-guard** added in Task 3 Step 7 (all registry ids are now used). Run: `pnpm --filter @tc/web test preview-registry` — Expected: PASS with the guard gone.
- [ ] **Step 7: Run tests.** Run: `pnpm --filter @tc/web test playbooks preview-registry` — Expected: PASS.
- [ ] **Step 8: Browser-verify** `/playbooks` renders, is reachable from home, all controls inert. Screenshot.
- [ ] **Step 9: Commit.**

```bash
git add apps/web/src/app/playbooks/ apps/web/src/components/playbooks/ apps/web/src/components/trip/ShareButton.tsx apps/web/src/components/trip/AddSavedDayButton.tsx apps/web/src/components/trip/InsertPlaybookDialog.tsx apps/web/src/components/home/NextTripHero.tsx apps/web/src/components/trip/TripHeader.tsx apps/web/src/lib/preview-registry.test.ts
git commit -m "feat(web): Playbooks route + share/add-saved-day/insert Preview shells (M11)"
```

## Task 19: Close cosmetic debt KI-2, KI-3, KI-4

**Files:**
- Modify: `apps/web/src/components/lenses/formatMoney.ts` (KI-2) + the domain-conflict-text consumer that formats money differently
- Modify: files listed in `docs/known-issues.md` KI-3 / KI-4 entries
- Modify: `docs/known-issues.md` (mark closed, or re-defer with a reason)

**Interfaces:** No behavior change; formatting/cleanup only.

- [ ] **Step 1: Read** the KI-2/3/4 entries in `docs/known-issues.md` for exact locations.
- [ ] **Step 2: KI-2** — make the UI and conflict-text money formatting consistent (one formatter). Add/adjust a unit test asserting both render the same string for a sample `Money`.
- [ ] **Step 3: KI-3 / KI-4** — apply the listed cosmetic/dead-code cleanups, or re-defer each in `known-issues.md` with a one-line reason.
- [ ] **Step 4: Run tests.** Run: `pnpm --filter @tc/web test formatMoney` (and any touched) — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src docs/known-issues.md
git commit -m "fix(web): close cosmetic debt KI-2/KI-3/KI-4"
```

## Task 20: Gate — verify, milestone hygiene, retro

**Files:**
- Modify: `docs/milestones/M10-visual-craft.md` (scope + exit gate → this plan; append retro)
- Modify: `docs/milestones/README.md` (table + Current milestone → M10 order), `TODO.md`, `docs/STATUS.md`
- Delete: this plan file (staging-area rule, in the gate-close commit)

- [ ] **Step 1: Verify presentational-only.** Run: `git diff --stat main -- packages apps/web/src/server apps/web/src/app/api` — Expected: **empty** (zero diff). If not empty, the offending change is out of M10 scope — revert or escalate.
- [ ] **Step 2: Full check.** Run: `pnpm typecheck && pnpm lint && pnpm test` — Expected: all green (unit + int). Then `pnpm build && pnpm start` and run the e2e suite (`pnpm --filter @tc/web e2e`) against the production build — Expected: all prior milestones' e2e green (no new e2e is required; M10 is presentational, but do not let any prior spec go red).
- [ ] **Step 3: Capture before/after** screenshots for every surface (home, each trip-plan view, retained lenses, dialogs, the Preview shells) per M10's exit gate.
- [ ] **Step 4: Milestone hygiene (one commit).** Rewrite `M10-visual-craft.md` scope + exit gate to this plan and append the retro; update `README.md` (table rows + "Current milestone"), `TODO.md`, `docs/STATUS.md` to the reordered roadmap; delete this plan file. Run the gate-close checklist in `docs/milestones/README.md`.
- [ ] **Step 5: Commit.**

```bash
git add docs/
git rm docs/plans/2026-08-08-M10-redesign-incorporation.md
git commit -m "docs(M10): close visual-craft gate — retro, roadmap flips, plan removed"
```

---

## Self-review notes (author)

- **Spec coverage:** home hero/sparkline/grid (T5–7), Playbooks strip + worth-attention (T16), trip header (T9), day chips (T8), timeline/day-columns/calendar (T10–12), retained lenses + dialogs (T13), assistant rail + ghosts (T14–15), keep-a-day flag+dialog shell (T10/T17), Playbooks route + share/insert/add-saved-day (T18), Preview seam+registry (T3), tokens+accents (T1–2), focus context (T4), KI-2/3/4 (T19), gate+hygiene (T20). All spec sections mapped.
- **Presentational-only** guarded by T20 Step 1 (`git diff --stat` must be empty for `packages`/`server`/`api`).
- **Verify-before-guessing:** T2/T8 explicitly say read `packages/contracts` for real field names before writing `chipModel`/city derivation; do not assume day/activity shapes.
- **Known soft spot:** exact final JSX for restyle tasks is discovered against the running preview + handoff, not pre-written here — these are visual-implementation tasks with concrete acceptance criteria and named tests, verified via the browser workflow. Foundation tasks (T1–5, T8) carry full TDD code.
