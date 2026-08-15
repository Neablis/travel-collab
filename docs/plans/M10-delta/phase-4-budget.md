# Phase 4 — Budget and cost

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first — its
> **Global Constraints** section applies to every task here, especially the
> **Currency** rule.
>
> **Phases 0 and 1 must be merged** — this phase builds on `lib/cost.ts`, created
> in Phase 1 Task 1.4.

**Goal:** cost is visible where the design puts it — on each stop, per day, on
home trip cards — and Trip settings becomes the design's budget surface.

**Gate for this phase:** a costed trip shows the same figure, formatted the same
way, in every place it appears. **This closes KI-2.**

---

## What already exists

- `ActivityView.cost` — `Money.optional()`, i.e. `{ amountMinor, currency }` or
  `undefined`. The activity editor already writes it (`MoneyInput`).
- `TripDetail.tripCostTotal` (minor units) and `TripDetail.budgetRemaining`
  (nullable, may be negative) — **computed server-side. Never re-sum them.**
- `trip.budget: Money | null`, `trip.currency: string`.
- `tripSpend(detail)` / `daySpend(detail, dayId)` — Phase 1 Task 1.4.
- The domain's `over-budget` conflict rule (`conflicts.ts:196`).
- `components/ui/budget-meter.tsx` — `BudgetMeter` takes **minor units**.
- `components/lenses/formatMoney.ts` — **the** money formatter. There must not be
  a second one; that is exactly what KI-2 is.

## What is not modelled — Preview it, do not build it

- **Confirmed vs. estimate cost state.** The design shows an amount plus a small
  uppercase `est` for anything unconfirmed, and "No cost yet" for an idea. We can
  render "No cost yet" honestly (a cost is absent or present), but **`est` is a
  claim we cannot make** — nothing distinguishes a firm price from a guess.
- **The budget breakdown categories** — Booked / Holds / Travel between cities /
  Everything else. We model none of them.
- **Invite roles and "Invite someone".** `TripMember` is `{ userId, role: "owner" }`
  — a role field exists but `"owner"` is its only value, and there is no display
  name. Real member userIds can be listed; roles and inviting cannot.

---

## Task 4.1: Cost on stops, per-day chips and home cards

**Files:**
- Modify: `apps/web/src/components/lenses/TimelineLens.tsx` (activity right column, day header)
- Modify: `apps/web/src/components/board/ActivityCard.tsx`
- Modify: `apps/web/src/components/home/TripCard.tsx`, `home/NextTripHero.tsx`
- Modify: `apps/web/src/lib/preview-registry.ts`
- Tests: alongside each

**Design values:**

| where | value |
|---|---|
| timeline card cost | right column, under the attributee, mono, `--color-slate` |
| no cost | the literal string **"No cost yet"** |
| day-header cost chip | in the day header's row 1, beside the stop meter, mono 12px, day-ink |
| home trip card | a mono line: `"{planned} planned of {budget}"`, or `"No budget yet"` when the trip has none |

- [ ] **Step 1: Write the failing tests**

```tsx
// TimelineLens.test.tsx
it("shows a stop's cost in the card's right column", () => {
  renderTimeline(detailWithCostedActivity);        // this file's existing helper style
  expect(screen.getByText("$42.00")).toBeTruthy();
});

it("says so honestly when a stop has no cost", () => {
  renderTimeline(detailWithUncostedActivity);
  expect(screen.getByText("No cost yet")).toBeTruthy();
});

it("totals the day's costs in the day header", () => {
  renderTimeline(detailWithTwoCostedActivitiesOnDayOne);
  expect(screen.getByTestId("day-cost-day-1").textContent).toContain("$67.00");
});
```

```tsx
// TripCard.test.tsx
it("shows planned spend against the budget", () => {
  render(<TripCard trip={{ ...tripSummary }} plannedOfBudget="$908.50 planned of $1,640.00" />);
  expect(screen.getByText("$908.50 planned of $1,640.00")).toBeTruthy();
});
```

Read each test file's existing helpers first and match them — do not add parallel
render helpers.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

Use `daySpend` / `tripSpend` and **`formatMoney`**. Do not write formatting
inline; do not add a second formatter.

`TripSummary` carries no cost fields at all, so the home trip card's line cannot
be derived on the list page from `TripSummary` alone. Two honest options — pick
the first:

1. Pass the line in as a prop from wherever the real `TripDetail` is already in
   hand (`NextTripHero` already fetches one), and render **nothing** on cards
   that have no detail. An absent line is honest; a fabricated one is not.
2. If no detail is available for a card, render `"No budget yet"` only when you
   actually know there is no budget — never as a stand-in for "unknown".

**The `est` marker:** add the design's uppercase `est` badge next to any amount,
wrapped in `<Preview id="cost-estimate-state" size="compact">`, and register it:

```ts
  'cost-estimate-state': { milestone: 'M11', wiredUpBy: 'Confirmed-vs-estimate flag per cost — no field models it' },
```

Match the registry's existing value shape — read the file first.

- [ ] **Step 4: Run tests; then close KI-2 deliberately**

Search for every place money is rendered and confirm they all route through
`formatMoney`:

```bash
grep -rn "amountMinor" apps/web/src/components | grep -v formatMoney
```

Anything left that formats an amount by hand is a KI-2 violation — route it
through `formatMoney`. Then update `docs/known-issues.md`: KI-2 is listed under
**Resolved** on this branch already (Wave 1 grouped the domain's `fmt`); confirm
that entry still reads true after this task and extend it if this task fixed
further cases.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test
git add apps/web/src/components apps/web/src/lib/preview-registry.ts docs/known-issues.md
git commit -m "feat(web): surface per-stop, per-day and per-trip cost"
```

---

## Task 4.2: Trip settings sheet rebuilt

**Files:**
- Modify: `apps/web/src/components/trip/SettingsSheet.tsx` + test
- Modify: `apps/web/src/lib/preview-registry.ts`

**Design values, verbatim from `current/…dc.html:849-900`:**

| element | value |
|---|---|
| container | `flex column; gap: 18px; padding-top: 4px`, inside the existing `Sheet title="Trip settings"` |
| trip name | `FormField` label "Trip name", description "Everyone invited sees this name." |
| dates | a **read-only** row: `1px solid --color-hairline`, `border-radius: 8px`, `padding: 10px 12px`, 12px `--color-slate` label "Dates" on the left, `DataText size="sm"` in ink on the right |
| section heading | 11px, weight 600, `letter-spacing: 0.05em`, uppercase, `--color-slate`, `margin-bottom: 10px` — "Budget", then "Who is invited" |
| budget inputs | `display: grid; grid-template-columns: 1fr 130px; gap: 10px` — "Total for the trip" `Input`, "Currency" `NativeSelect` (USD / EUR / GBP) |
| meter row | `BudgetMeter` + a 12px status line, `gap: 12px`, `margin-top: 12px` |
| over-budget | a `Banner variant="warning"` at `margin-top: 12px`, only when over |
| breakdown row | `flex; gap: 10px`; label `flex: 0 0 150px` at 12.5px ink; a `flex: 1` 6px `--color-moss` track holding a `--color-brand` fill; `DataText size="sm"` amount |
| unpriced line | 12px `--color-slate`, `margin-top: 10px` |
| invite header | the section heading with a `secondary` "Invite someone" button on the right |

**Dates are read-only here.** The design moved date editing out. `TripDateControl`
still exists and is still the only way to change dates — Phase 6's "Add a day"
uses `AddDay`, not this sheet. Do **not** delete `TripDateControl`; per Mitchell's
decision, capability is never removed just because the design has no surface for
it. If it ends up with no caller, record that in `docs/known-issues.md`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows the trip name, read-only dates and the budget fields", () => {
  renderSettings({ open: true });

  expect(screen.getByLabelText("Trip name")).toBeTruthy();
  expect(screen.getByText("Dates")).toBeTruthy();
  expect(screen.getByLabelText("Total for the trip")).toBeTruthy();
  expect(screen.getByLabelText("Currency")).toBeTruthy();
});

it("warns when the trip is over budget", () => {
  renderSettings({ open: true, budgetRemaining: -82_000 });
  expect(screen.getByRole("status")).toHaveTextContent(/over/i);
});

it("does not warn when the trip is within budget", () => {
  renderSettings({ open: true, budgetRemaining: 731_500 });
  expect(screen.queryByRole("status")).toBeNull();
});

it("counts stops with no cost", () => {
  renderSettings({ open: true });
  expect(screen.getByText(/no cost yet/i)).toBeTruthy();
});

it("lists real members", () => {
  renderSettings({ open: true });
  expect(screen.getByText("dev-alice")).toBeTruthy();
});
```

Check what role the repo's `Banner` renders with before asserting `role="status"` —
read `components/ui/banner.tsx` and assert against what it actually does.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

Keep `TripMoneySettings`' existing dispatch logic for the budget/currency fields —
re-home the controls, do not rewrite the commands. `BudgetMeter` takes **minor
units**; `tripSpend` already returns minor units, so pass straight through and do
**not** multiply by 100.

**The four breakdown rows are unbacked.** Wrap the whole breakdown block in
`<Preview id="budget-breakdown" size="container">` and keep the honest figures —
the total, the meter, the over-budget banner and the unpriced count — **outside**
it. Wrap the roles column and the "Invite someone" button in
`<Preview id="trip-invites" size="container">`, listing real member userIds
outside it. Register both:

```ts
  'budget-breakdown': { milestone: 'M11', wiredUpBy: 'Booked/Holds/Travel/Other categories — no field classifies a cost' },
  'trip-invites':     { milestone: 'M13', wiredUpBy: 'Invites and non-owner roles — TripMember.role is literal "owner"' },
```

Keep Duplicate and Delete where they are; the design does not show them, and
removing them would delete capability.

- [ ] **Step 4: Run tests, verify in the browser, commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test && node scripts/check-color-wall.mjs
git add apps/web/src/components/trip/SettingsSheet.tsx apps/web/src/components/trip/SettingsSheet.test.tsx apps/web/src/lib/preview-registry.ts
git commit -m "feat(web): rebuild the trip settings sheet to the redesign"
```

---

## Phase 4 exit checklist

- [ ] Every amount in the app routes through `formatMoney` — grep proves it.
- [ ] Stops show a cost or "No cost yet"; days show a total; home cards show
      planned-of-budget or nothing (never a fabricated figure).
- [ ] Settings shows name, read-only dates, budget + currency, a real meter, a
      real unpriced count, and a warning banner only when genuinely over.
- [ ] `cost-estimate-state`, `budget-breakdown` and `trip-invites` are registered
      and the registry↔usage test is green.
- [ ] `TripDateControl` still exists; if it now has no caller, that is recorded.
