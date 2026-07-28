# M5 — Wave 3 refinements design record

**Date:** 2026-07-13 · **Milestone:** M5 (design foundations), Wave 3 ·
**Branch:** `m5-design-foundations` · **Precedes:** implementation plan
`docs/plans/2026-07-13-M5-wave3-refinements.md` (archived)

Companion to the Wave-1 re-skin (`docs/specs/2026-07-11-M5-design-foundations-design.md`)
and Wave-2 layout & surfaces (`docs/specs/2026-07-12-M5-layout-and-surfaces-design.md`).
Normative system reference: `docs/guidelines/design-system.md`.

## Origin

After the Wave-2 deploy, Mitchell left **16 new comments** on the Vercel
preview (raw capture: `docs/design-feedback/2026-07-13-pr11-wave2-vercel-comments.md`).
They were triaged into: **Groups 1–3** (8 unambiguous fixes — shipped in the
Wave-3 *fix pass*, commit `4dacd79`) and **Group 4** (the design-ambiguous
cluster). This spec is the Group-4 brainstorm result. It also folds in two
carried-over items that surfaced alongside: completing the money formatter for
editable inputs (#22) and a confusing no-op alert.

Decision to brainstorm Group 4 as a set (rather than one-off patches) was
Mitchell's, 2026-07-13. Each area below was decided interactively.

## Constraints (carried from Wave 1/2 — do NOT weaken)

- **UI-layer only.** All changes in `apps/web/src`. Zero diff to `packages/`,
  `apps/web/src/server`, `apps/web/src/app/api`, `docs/contracts`. No contract
  change; needing one means STOP and escalate.
- **ADR-012 spine invariants hold:** `TripProvider` is a server-cache +
  dispatch, never a store; `LensRouter` is URL-as-truth, unidirectional;
  overlays open via owned state, never a Radix `*Trigger`.
- **Enforcement walls stay green:** no raw color literals, no inline `style`
  outside the drag/maplibre allowlist, no raw elements outside `ui/`, no
  arbitrary Tailwind values. New tokens (if any) only in `globals.css`.
- Preserve existing `data-testid`/`aria-label` where the element still exists.

## The organizing idea

Wave 2 fixed *which surface* editing lives in. Wave 3 fixes *how the standing
surfaces read and scale*: the board at many days, the map as a map, the
schedule/timeline legibility, and the header's money glance — plus finishing
money formatting everywhere. The recurring thread across #31/#23/#4/#10 is one
root cause: **the page never actually caps its width, and the board leans on
horizontal scroll.** Wave 3 removes both.

---

## Area 1 — Board layout & width (#31, #23, #4, #10, and the new full-height-drop-target comment)

**Root cause.** The page shell renders `<PageContainer as="main" width="full"
px-0>` — full viewport width, no cap — and Board + Map opt out of the content
max-width (`width="full"`). On a wide monitor the board spreads edge-to-edge
(reads as "full screen", #31), and many-day trips scroll horizontally with a
confusing scrollbar (#23) and no good affordance (#10). Wave-2's Track-O added
a day pager + edge-shadow, but Mitchell's actual ask was *"we probably don't
even want to have to scroll right"* — a layout rethink, not a scroll hint.

**Decision.**
- **Cap the board to a max content width** (centered), so it is no longer
  edge-to-edge. Exact cap pinned in implementation against real column widths
  (candidates: reuse `--container-content` 1120px, or a slightly wider
  board-specific max ~1400px for ~5 columns/row — decided visually in the
  F-track).
- **Day columns flow into a wrapped grid** (multiple rows) instead of a single
  horizontally-scrolling row. All days visible; **no horizontal scroll.**
- **Backlog** becomes a **full-width strip above the day grid** (it is the
  unscheduled pool, conceptually distinct from the dated days).
- **Drop targets:** each day card has a **comfortable minimum height** (fits
  ~3–4 cards) and the **entire card is the drop zone** — drop anywhere in the
  day, insert position inferred from the nearest card. This resolves the
  new "hard to target the tiny box" comment; the earlier "full page-height
  drop target" idea is superseded (it assumed a single tall column, which the
  wrapped grid no longer has).
- **Retire** the Track-O horizontal-scroll affordances (edge-shadow strip,
  right-scroll). The **day pager** ("Jump to day") is retired too — with all
  days visible in the grid there is nothing to jump past. (If very long trips
  make the grid tall, ordinary vertical page scroll suffices.)

**Drag-drop.** Adjacency is already `dayId`-based (via drag `getData`), not DOM
order, so wrapping into rows does not affect drop logic — you can drag a card
to any day card on screen. The relaxation of strict left→right adjacency during
a drag was accepted (Mitchell, 2026-07-13).

**Test impact.** The board unit tests asserting the day-pager, edge-shadow, and
`flex-col`/`lg:flex-row` stack behavior are replaced with grid-layout +
whole-card-drop assertions. Drag e2e (`m1-board`) should still pass (drop
targets are still `dayId` columns).

## Area 2 — Map lens (#24, #25, #26)

**Decisions.**
- **Remove the located-activities pin list.** Pins are already on the map and
  clicking a marker opens the editor (existing wiring) — the list was
  redundant (#26).
- **Keep a minimal "no location" affordance.** Activities without coordinates
  can't appear on the map, so a quiet "N activities have no location"
  chip/button remains, opening those activities to add a place. Not a full
  list — just enough that they aren't stranded.
- **Map fills available height** instead of a fixed `height: 400`. It expands to
  the viewport height below the header/tabs (a computed height or flex-fill;
  dimensions stay in the sanctioned inline-style maplibre allowlist). Resolves
  #25's "map can be larger, fill more of the height."
- **Re-render fix (#24, #25).** *Root cause found:* `MapLens`'s mount effect
  lists `openCreate` in its dependency array, and `EditorHost` rebuilds
  `openCreate/openEdit/close` on every editor-state change
  (`useMemo(..., [state])`), so opening the editor gives those functions new
  identities and **tears down and recreates the whole map** (`map.remove()` →
  new `Map`). That is why the map re-renders on any click and its controls
  bleed over the sheet. **Fix:** stabilize the `EditorHost` callbacks with
  `useCallback` (empty deps — they only call `setState`), and keep only the
  changing `state` in the memo. Consumers that depend on the actions no longer
  re-run when editor state changes. UI-only, touches
  `components/trip/context/EditorHost.tsx`.

## Area 3 — Schedule toggle (#27)

**Decision.** Keep the merged **Schedule** lens (Timeline + Calendar are two
views of the same time data). The nesting *feels* wrong only because the
`SegmentedControl` reuses the **same moss-pill styling as the tab strip**, so it
reads as tabs-inside-tabs. **Restyle the Timeline/Calendar switch** to be
visually subordinate — a compact, lighter control placed in the lens header
(e.g. a small text/icon switch), distinct from the pill tab strip. Stays a
controlled `role="radiogroup"` (or equivalent) so `fireEvent` tests keep
working (ADR-012 invariant 3); only its skin changes. Whether this is a
re-skinned `SegmentedControl` or a new lighter control is an implementation
detail.

## Area 4 — Header spent-vs-budget (#30)

**Decision.** Replace the ambiguous `{cost} / {budget}` mono string with a
**mini budget meter**: a small horizontal fill bar (fill = cost / budget,
clamped; **warning-amber when over budget**, per the semantic-color rules — over
budget is a warning, not danger) plus a compact `X of Y` label in `DataText`.
Uses the now-grouped `formatAmount`. Lives in `TripHeader`, read-only. New
composite if warranted (`BudgetMeter`) added to the design-system inventory in
the same task.

## Area 5 — Timeline time axis (#28)

**Decision.** The timeline bar spans a fixed 06:00–22:00 window but shows no
scale, so a gap between blocks is unreadable. **Add hour ticks + labels**
(e.g. `6a · 9a · 12p · 3p · 6p · 9p`) along the axis with light vertical
gridlines, so block positions map to real times. Pure presentational addition
to `TimelineLens`; the existing `%`-based geometry is unchanged.

## Area 6 — Carried-over fixes folded in

- **#22 money in editable inputs.** `MoneyInput` is `<input type="number">`,
  which cannot render commas. **Rework it to format-on-blur:** an
  `inputMode="decimal"` text input that shows the **grouped** value
  (`1,111,106.00`) when not focused and raw digits while editing, parsing
  back to minor units on change. Reuses `formatAmount`. Applies everywhere
  `MoneyInput` is used (activity cost, trip budget). *The over-budget
  conflict-banner amount stays ungrouped — it is generated in `packages/domain`
  and is off-limits to this UI wave; tracked as KI-2 in `docs/known-issues.md`.*
- **No-op alert (#7HuQy…).** Re-setting a value to what it already is returns a
  no-op command result, currently surfaced as a page-level `<p role="alert">`
  reading "This change would have no effect" — confusing and alarming for a
  harmless action. **A no-op result should silently do nothing** (no alert).
  Handled at the dispatch layer in `TripProvider` (treat the no-op result
  code(s) as a benign success, don't set `error`) — a UI-layer error-handling
  choice, not a state mutation, so ADR-012 invariant 1 is intact. The exact
  result code(s) to treat as benign are enumerated during implementation.

## Comment → resolution map

| # / id | Comment | Resolved by |
|---|---|---|
| #31 `ea_LSVK3az97` | Still full-screen / max-width not applied | Area 1 — capped board width |
| #23 `JBTOsnhU_ZMX` | Confusing horizontal scrollbar | Area 1 — wrapped grid, no h-scroll |
| #4 `auxBzPUTjP-p` | Lenses too wide | Area 1 (+ Wave-2 containers already cap non-board lenses) |
| #10 `-egU2iMAEBmc` | Board scroll / 7+ days | Area 1 — wrapped grid |
| new `DEgwPqo7Qk18` | Drop targets hard to hit | Area 1 — min-height, whole-card drop |
| #24 `zU65ySYQmUqY` | Map control overflows into edit dialog | Area 2 — re-render fix |
| #25 `f-THhbRyGFLR` | Map bigger + stop re-rendering | Area 2 — fill height + re-render fix |
| #26 `40muPQGPKNU4` | Eliminate the activity list | Area 2 — remove located list, keep "no location" affordance |
| #27 `Za2Gej7fidrC` | Nested tab-in-tab toggle | Area 3 — restyle switch |
| #30 `EWIoH4yUXssn` | Cost vs budget unclear | Area 4 — mini budget meter |
| #28 `MdKTS_vDt7qT` | Timeline has no time indicator | Area 5 — hour axis |
| #22 `IH5b…`/`-BU-p…` | Editable money inputs not grouped | Area 6 — MoneyInput format-on-blur |
| new `7HuQy17X0mDu` | Confusing "no effect" alert | Area 6 — silent no-op |
| new `XnJ5vruFvBkE` | "Add anchor" button misaligned | Small fix in the plan (align to input baseline) |

## Deliverables

1. This spec.
2. design-system.md amendments — board grid/drop convention, any new composite
   (`BudgetMeter`), MoneyInput behavior note, timeline axis (done in the
   implementation tasks, since doc + code change together).
3. The implementation plan `docs/plans/2026-07-13-M5-wave3-refinements.md` (archived).

## Open items carried into the plan

- Exact board max-width and columns-per-row (pinned visually in the F-track).
- Day-card minimum height value.
- The Schedule switch's exact control form (re-skinned segmented vs. new).
- Enumerate the domain no-op result code(s) to treat as benign at dispatch.
- `MoneyInput` focus/blur formatting edge cases (partial input, empty, paste).
