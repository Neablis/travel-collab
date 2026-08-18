# Phase 5 — Overlap warnings

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first.
>
> **Phases 0 and 1 must be merged.** Otherwise independent of Phases 2, 3 and 4 —
> with one shared-module caveat: this phase uses `toMinutes` from
> `apps/web/src/lib/time.ts`. Phase 3 Task 3.1 creates it by moving the function
> verbatim out of `TimelineLens.tsx:55-67`. **If that file does not exist yet, do
> that move as your first step here** and update `TimelineLens.tsx`'s import. Do
> not write a second copy.

**Goal:** two stops whose times cross show the design's inline, never-blocking
warning with a one-click fix.

**Gate for this phase:** giving two seeded stops crossing times produces the
warning under the later one; "Start HH:MM" moves it and the warning clears;
"Dismiss" hides it without changing the trip.

---

## This is a restyle, not a new feature

The domain already emits exactly what the design needs
(`packages/domain/src/trip/conflicts.ts:91-120`):

```ts
{
  id: `time-overlap:${day.dayId}:${s1}:${s2}`,   // s1 < s2, sorted by activityId
  kind: "time-overlap",
  severity: "warn",
  subjects: [s1, s2],
  description: `"A" and "B" overlap in time on the same day.`,
  resolutions: [...],
}
```

`Conflict` (`packages/contracts/src/conflict.ts`) is
`{ id, kind, severity, subjects, description, resolutions }`. `TripDetail` carries
`conflicts` and `dismissedConflictIds`, and `DismissConflict` already dismisses
per conflict id — which, because the id encodes the **pair**, is already the
design's "dismissals are per stop-pair".

**Do not touch `packages/domain`.** No new rule, no changed rule. Everything here
reads `detail.conflicts`.

**Note:** `subjects` is sorted by activityId, **not** by time. The design attaches
the warning to whichever stop starts **later**, so the UI must work that out
itself from the two activities' `timeWindow`s.

---

## Design values, verbatim

*Timeline (`current/…dc.html:423-434`)* — a row in the same
`92px 1fr` grid as an activity, `margin-top: 6px`, left cell empty. The right
cell: `--color-warning-tint`, `border-radius: 10px`,
`padding: 8px 10px 8px 12px`, `flex-wrap; gap: 8px 10px`; a 6px
`--color-warning` dot; then `flex: 1; min-width: 200px`, 12.5px,
`line-height: 1.45`, `--color-warning-ink` text; then a `secondary` size-sm fix
button and a `ghost` size-sm "Dismiss".

*Day columns (`current/…dc.html:552-556`)* — a compact chip inside the card:
`margin-top: 7px`, `--color-warning-tint`, `border-radius: 7px`,
`padding: 4px 6px 4px 8px`; 11px `--color-warning-ink` text, truncated with
ellipsis; then a bare `✕` button, `aria-label="Dismiss overlap warning"`.

*Day header* — a `Badge variant="warning"` reading `"1 overlap"` / `"N overlaps"`.

**Copy, verbatim:**

- Long form: `Overlaps {other title}, {other start} – {other end} — {duration} on top of each other.`
  Example: `Overlaps Nezu Museum, 10:30 am – 1 pm — 30m on top of each other.`
- Short form (day columns): `Overlaps {other title}`
- Fix button label: `Start {time}` — e.g. `Start 1 pm`.

Times use the same formatting the rest of the timeline uses. **Find it first** —
`grep -rn "function fmt\|formatTime" apps/web/src/lib apps/web/src/components` —
and reuse it rather than writing a second time formatter.

---

## Task 5.1: `overlapData.ts`

**Files:**
- Create: `apps/web/src/components/lenses/overlapData.ts`, `overlapData.test.ts`

**Interfaces:**

```ts
export type Overlap = {
  conflictId: string;
  laterActivityId: string;   // the stop the warning attaches to
  otherActivityId: string;
  otherTitle: string;
  otherStart: string;        // raw "HH:MM"
  otherEnd: string;          // raw "HH:MM"
  overlapMinutes: number;
  suggestedStart: string;    // raw "HH:MM" — the other stop's end
};

export function overlapsForDay(detail: TripDetail, dayId: string): Overlap[];
```

Rules:
- Only `kind === "time-overlap"` conflicts whose id names this `dayId`.
- Exclude any conflict whose id is in `detail.dismissedConflictIds`.
- `laterActivityId` is whichever subject has the later `timeWindow.start`; ties
  break on the later `end`, then on activityId so the result is deterministic.
- `overlapMinutes` is the true intersection:
  `min(endA, endB) − max(startA, startB)`, using `toMinutes` from `lib/time.ts`
  (moved there in Phase 3 Task 3.1).
- `suggestedStart` is the **earlier** stop's `end`.
- A conflict naming an activity that no longer exists is skipped, not thrown on.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { overlapsForDay } from "./overlapData";

const detail = (over = {}) => ({
  tripId: "t", name: "T", status: "active", currency: "USD", budget: null,
  members: [{ userId: "u", role: "owner" }],
  days: [{ dayId: "d1", date: null, activityIds: ["a", "b"] }],
  backlog: [],
  activities: {
    a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], cost: null },
    b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "12:30", end: "14:00" }, location: null, notes: null, anchors: [], cost: null },
  },
  conflicts: [{
    id: "time-overlap:d1:a:b", kind: "time-overlap", severity: "warn",
    subjects: ["a", "b"], description: "…", resolutions: [],
  }],
  dismissedConflictIds: [],
  tripCostTotal: 0, budgetRemaining: null,
  ...over,
}) as never;

describe("overlapsForDay", () => {
  it("attaches the warning to the later stop", () => {
    const [o] = overlapsForDay(detail(), "d1");
    expect(o.laterActivityId).toBe("b");
    expect(o.otherTitle).toBe("Nezu Museum");
  });

  it("reports the true intersection, not the whole span", () => {
    // 12:30–13:00 = 30 minutes.
    expect(overlapsForDay(detail(), "d1")[0].overlapMinutes).toBe(30);
  });

  it("suggests starting when the earlier stop ends", () => {
    expect(overlapsForDay(detail(), "d1")[0].suggestedStart).toBe("13:00");
  });

  it("excludes dismissed conflicts", () => {
    expect(overlapsForDay(detail({ dismissedConflictIds: ["time-overlap:d1:a:b"] }), "d1")).toEqual([]);
  });

  it("ignores conflicts belonging to another day", () => {
    expect(overlapsForDay(detail(), "d2")).toEqual([]);
  });

  it("ignores non-overlap conflict kinds", () => {
    const d = detail({ conflicts: [{ id: "over-budget", kind: "over-budget", severity: "warn", subjects: [], description: "", resolutions: [] }] });
    expect(overlapsForDay(d, "d1")).toEqual([]);
  });

  it("skips a conflict naming a missing activity rather than throwing", () => {
    const d = detail({ conflicts: [{ id: "time-overlap:d1:a:zzz", kind: "time-overlap", severity: "warn", subjects: ["a", "zzz"], description: "", resolutions: [] }] });
    expect(() => overlapsForDay(d, "d1")).not.toThrow();
    expect(overlapsForDay(d, "d1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, implement, re-run, commit**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/lenses/overlapData.test.ts
git add apps/web/src/components/lenses/overlapData.ts apps/web/src/components/lenses/overlapData.test.ts
git commit -m "feat(web): derive per-day overlap warnings from existing time-overlap conflicts"
```

---

## Task 5.2: The warning, the fix and the badges

**Files:**
- Create: `apps/web/src/components/lenses/OverlapWarning.tsx` + test
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx`
- Modify: `apps/web/src/components/board/ActivityCard.tsx` (compact chip)
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx` day header (count badge)

**Interfaces:**

```tsx
<OverlapWarning overlap={Overlap} onFix={() => void} onDismiss={() => void} />
```

**The fix action, precisely.** "Start 1 pm" moves the later stop to begin when the
earlier one ends, **keeping its duration**, then lets the day re-sort naturally:

```tsx
const duration = toMinutes(activity.timeWindow.end) - toMinutes(activity.timeWindow.start);
const start = overlap.suggestedStart;
const end = toTimeString(toMinutes(start) + duration);
void dispatch({ type: "UpdateActivity", tripId, activityId: overlap.laterActivityId, timeWindow: { start, end } });
```

Nothing is validated or prevented — if the move creates a new overlap further
down the day, the domain emits a new conflict and the UI shows a new warning.
That is the design's "never blocking".

- [ ] **Step 1: Write the failing tests**

```tsx
it("states which stop it overlaps, and by how much", () => {
  render(<OverlapWarning overlap={overlap} onFix={vi.fn()} onDismiss={vi.fn()} />);
  expect(screen.getByText("Overlaps Nezu Museum, 10:30 am – 1 pm — 30m on top of each other.")).toBeTruthy();
});

it("offers a fix labelled with the suggested start", () => {
  render(<OverlapWarning overlap={overlap} onFix={vi.fn()} onDismiss={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Start 1 pm" })).toBeTruthy();
});

it("fixes and dismisses independently", async () => {
  const onFix = vi.fn();
  const onDismiss = vi.fn();
  render(<OverlapWarning overlap={overlap} onFix={onFix} onDismiss={onDismiss} />);

  await userEvent.click(screen.getByRole("button", { name: "Start 1 pm" }));
  expect(onFix).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
```

In `TimelineLens.test.tsx`:

```tsx
it("moves the later stop to start when the earlier one ends, keeping its duration", async () => {
  const dispatch = renderTimelineWithOverlap();

  await userEvent.click(screen.getByRole("button", { name: "Start 1 pm" }));

  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: "UpdateActivity",
    activityId: "b",
    timeWindow: { start: "13:00", end: "14:30" },   // was 12:30–14:00, a 90-minute stop
  }));
});

it("shows an overlap count badge on the day header", () => {
  renderTimelineWithOverlap();
  expect(screen.getByText("1 overlap")).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement** to the design values above.

The timeline warning sits in the same `92px 1fr` grid as the activity rows —
reuse that grid rather than a new layout, or it will not align with the time
column. `Dismiss` dispatches `{ type: "DismissConflict", tripId, conflictId }`.

Note the existing conflict `Badge` on the activity card (`TimelineLens.tsx:231`)
currently fires for **any** conflict naming that activity. Leave it — it covers
the other conflict kinds (geography, anchors, budget). The overlap warning is
additive, and the two should not double up on the same information: pass
`hasConflict` only for **non-overlap** conflicts once this task lands, so a
time-overlap shows the rich warning and not also a bare triangle.

- [ ] **Step 4: Run tests; verify in the browser**

Edit two seeded stops on one day to cross. The later one gains the warning; the
day header shows "1 overlap"; day columns show the compact chip. Click the fix —
the stop moves and the warning clears. Undo restores it. Dismiss hides the
warning without changing any time.

- [ ] **Step 5: Run the phase gate and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components/lenses apps/web/src/components/board/ActivityCard.tsx
git commit -m "feat(web): inline overlap warnings with a one-click fix"
```

---

## Phase 5 exit checklist

- [ ] The warning attaches to the **later** stop, not an arbitrary subject.
- [ ] The stated overlap duration is the true intersection.
- [ ] The fix keeps the stop's duration and never blocks anything.
- [ ] Dismissal is per pair and changes no trip data.
- [ ] Day headers show a count badge; day columns show the compact chip.
- [ ] Zero diff to `packages/`.
