### KI-2 — Money formatting differs between UI and domain conflict text — RESOLVED
- **Severity:** cosmetic
- **Area:** `apps/web/src/components/lenses/formatMoney.ts` vs. the domain's
  `fmt` in `packages/domain/src/trip/conflicts.ts`
- **Symptom:** the UI groups thousands (`1,111,106.00 USD`, added in M5 Wave-3
  for comment #22), but the **over-budget conflict banner text is generated in
  `packages/domain`** and stayed ungrouped, so the same amount could render
  two ways. Accepted knowingly at the time: `packages/domain` was off-limits
  to that UI-only wave.
- **Fix (2026-08-09, Task 19):** grouped the domain's `fmt` the same way —
  `Math.abs(minor) / 100` through `toLocaleString("en-US", { minimumFractionDigits:
  2, maximumFractionDigits: 2 })` with a manual sign prefix, mirroring
  `formatAmount`'s own construction in `formatMoney.ts`. This is a real
  `packages/domain` change — an explicitly pre-approved, one-time exception to
  M10's "zero diff to `packages/`" rule (Mitchell, mid-session decision on
  Task 19); it does not reopen `packages/domain` generally.
- **Proof:** `packages/domain/test/over-budget.test.ts` adds a case asserting
  the over-budget conflict description renders `"Trip total (1,111,107.00
  USD) exceeds the budget (1.00 USD) by 1,111,106.00 USD."` for a
  budget/cost pair chosen so the difference matches
  `formatMoney.test.ts`'s existing `111110600` minor-unit grouping fixture —
  same amount, same grouped string, on both surfaces.
- **First noted:** 2026-07-13 (M5 Wave-3). **Resolved:** 2026-08-09 (Task 19).
- **Re-confirmed (2026-08-22, Task 4.1, M10 Phase 4):** extended the gate to
  every new per-stop/per-day/per-trip cost surface added this task —
  `TimelineLens`'s activity-row cost and day-header cost chip, the board
  `ActivityCard`'s cost, and `NextTripHero`'s "planned of budget" line — all
  route through `formatMoney`, keyed off the trip's own `currency` (never a
  per-`Money` read). Audit: `grep -rn "amountMinor" apps/web/src/components |
  grep -v formatMoney` turns up only test fixture literals, `MoneyInput`'s own
  edit-field parsing (no currency suffix needed there), and
  `ItineraryLens.tsx`'s `formatAmount` alias (`import { formatMoney as
  formatAmount }` — already the real formatter under a local name). No
  violations found; the entry still reads true.
