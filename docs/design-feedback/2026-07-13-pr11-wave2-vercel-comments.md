# PR #11 Wave-2 UI/UX feedback — Vercel live comments (2026-07-13)

Source: Mitchell left **16 new comments** via the Vercel preview toolbar on
[PR #11](https://github.com/Neablis/travel-collab/pull/11)
(`travel-collab-git-m5-design-foundations-neablis-projects.vercel.app`,
branch `m5-design-foundations`), after the Wave-2 deploy. Pulled via the
Vercel MCP's `list_toolbar_threads`; DOM selectors below are straight from
each thread's captured `context`, not guessed.

The Vercel toolbar also still shows the **15 original Wave-1 comments** as
unresolved (timestamped 2026-07-12, on the old pre-Wave-2 DOM
`div.mx-auto > main > …`). Those are the set Wave 2 was built to resolve
(see `2026-07-12-pr11-vercel-ui-comments.md`); they were never marked
resolved in the toolbar and are **not** re-litigated here. This file covers
only the 16 new (2026-07-13) comments on the Wave-2 DOM
(`main > header.border-b`, `#radix` sheet/popover, `div.map-lens`,
`?lens=Schedule&view=Timeline`).

Triage decision (Mitchell, 2026-07-13): **fix the unambiguous items now
(Groups 1–3), brainstorm the design-ambiguous cluster (Group 4) before
building.** Both items that reverse a Wave-2 decision (#19, #22) were
explicitly approved.

---

## Group 1–3 — fixed in this PR (Wave-3 fix pass)

| # | Comment (verbatim) | Maps to | Resolution |
|---|---|---|---|
| 29 | "Why does this edit button open the edit dialog at the bottom but the other ones open it on the right side panel?" | `board/Board.tsx` (inline `ActivityEditor`) | Board's Edit now routes through `useEditor().openEdit`, opening the same right-side `ActivityEditorSheet` every other lens uses; inline bottom editor removed. |
| 22 | "Can we add a formatter for all currency numbers? … 1,111,106.00 USD so its easily readable" | `lenses/formatMoney.ts`, `trip/TripHeader.tsx` | `formatMoney`/new `formatAmount` group thousands (`en-US`); `TripHeader` routed through `formatAmount` instead of inline `.toFixed(2)`. **Known mismatch (approved):** the domain's own `fmt` (over-budget conflict text) is not grouped — `packages/domain` is off-limits this wave. |
| 19 | "Make this an X and it clears the date. Right now you have a dropdown of 1 element" | `lenses/TripDateControl.tsx` | One-item "Date options" popover replaced by a direct **X** shown only when a date is set. Reverses C2's popover move (approved). |
| 16 | "The revert to here version … overflows off the container. The back to now button is not very obvious, maybe just rename it dismiss?" | `board/HistoryPanel.tsx`, `ui/popover.tsx` | Preview-banner actions moved under the text and wrap (no more overflow); popover widened to `w-96`; "Back to now" → "Dismiss". |
| 18 | "Clicking outside this dropdown should default to 'Back to now' and close the dropdown" | `trip/TripHeader.tsx` | History popover `onOpenChange` now exits the preview when dismissed during a preview, then closes. |
| 17 | "Date text goes right up to the edge" | `board/HistoryPanel.tsx` | Entry description gets `min-w-0`/`truncate` so it can't push the date out; date is `shrink-0`; wider popover gives breathing room. |
| 21 | "Alerts are up againsst the tab display" | `board/ConflictBanner.tsx` | Banner container `mb-3` → `my-3` so it isn't flush against the tab strip. |
| 20 | "When theres no elements in a day, make this button more pronounced since its empty" | `board/Column.tsx` | Empty day's add affordance becomes a full dashed "＋ Add activity" slot; collapses to a compact "＋" once the day has cards. |

## Group 4 — deferred to design brainstorm (NOT built here)

These are IA / interaction-model questions or feature-shaped requests with
real design ambiguity; per the working agreement they get a
`superpowers:brainstorming` pass + approval before implementation.

| # | Comment (verbatim) | Maps to | Why deferred |
|---|---|---|---|
| 26 | "These activities ui list doesnt make sense, just eliminate, and the only interaction on this page is clicking a location on the map" | `lenses/MapLens.tsx` | Removes a whole sub-surface; changes the lens's interaction model. |
| 25 | "The map can be larger, fill more of the height. Also its re-rendering when i click anything like a activity" | `lenses/MapLens.tsx` | Layout + a real re-render/perf investigation. |
| 24 | "Why is this map part overflowing into the edit dialog?" | `lenses/MapLens.tsx` (maplibre ctrl) | Tied to the Map-lens layout rework above. |
| 27 | "I dont know if a tab list in a tab list is the best way to implement this toggle. Theres only two elements and its weird its nested" | `lenses/ScheduleLens.tsx`, `ui/segmented-control.tsx` | Questions L1's nested-toggle design; needs an alternative. |
| 28 | "Theres no UI indicator to indicate when this is. … does that break happen at 5am, or 5pm, its impossible to tell from this ui" | `lenses/TimelineLens.tsx` | New time-of-day axis/labelling — feature-shaped. |
| 30 | "Its not clear one is the current cost and one is the budget. Lets figure out a better way to show this" | `trip/TripHeader.tsx` | Explicit "figure out a better way" — a display redesign. |
| 31 / 23 | "I still think this full screen UI does not look very good. I dont believe we introduced the container with max width…" / "This scrollbar ui makes no sense when its wide…" | `ui/page-container.tsx`, `board/Board.tsx` | Wave-2 container work isn't landing visually; needs investigation + a width/scroll model decision (echoes old #4). |

---

## Notes for the brainstorm

- Group 4's Map cluster (#24/#25/#26) is best treated as one "what is the Map
  lens for" question rather than three tweaks.
- #31/#23 recur from Wave-1 #4 despite Wave-2's `PageContainer`; the header is
  full-bleed (`border-b` spans the viewport) while lens bodies are constrained,
  which may be what still reads as "full screen". Worth confirming live before
  deciding.
- #30 (cost-vs-budget clarity) and the grouped-money change (#22, done) both
  touch the header's money glance — resolve #30 knowing the numbers now group.
