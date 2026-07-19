# M5 — Layout & Surfaces (Wave 2) design record

**Date:** 2026-07-12 · **Milestone:** M5 (design foundations), Wave 2 ·
**Branch:** `m5-design-foundations` · **Precedes:** implementation plan
`docs/plans/2026-07-12-M5-layout-and-surfaces.md`

Companion to `docs/specs/2026-07-11-M5-design-foundations-design.md` (Wave 1 —
the Field Kit re-skin, PR #11). Normative system reference:
`docs/guidelines/design-system.md`. Architecture decisions extracted to two
separately-gated ADRs: **ADR-011 (editing-surfaces model)** and **ADR-012
(client-state architecture)**.

## Origin

Wave 1 re-skinned every Phase-1 surface onto Field Kit and shipped as PR #11.
Mitchell left 15 UI/UX comments on the Vercel preview
(`docs/design-feedback/2026-07-12-pr11-vercel-ui-comments.md`). Read as a set
rather than 15 tickets, they are symptoms of **four missing design-system
patterns** plus two small conventions. This wave adds those patterns once, so
the whole class of issue is resolved and the next batch is prevented.

## Scope expansion — recorded honestly

Wave 1 (and `design-system.md`'s "Breakpoints" section) scoped M5 as **purely
presentational**, with "a real responsive pass explicitly out of scope." That
exclusion was correct for a re-skin. This wave **reverses it inside M5**
(Mitchell's call, 2026-07-12): it adds breakpoint/container tokens, two new
overlay primitives, a client-side UI-state architecture, URL-backed view
routing, and **two intentional behavior changes** (Enter-to-search; the activity
editor becomes a raised surface). This is more than presentational. It stays in
M5 because it is still design-foundation work — the paradigms every later
feature is built on — but the milestone file is amended to say so, and Wave 2's
exit gate replaces Wave 1's "e2e changes are selector-only" rule with "behavior
changes are expected and each is justified."

Not reopened: the phone/mobile pass. Wave 2 is **desktop-first with guardrails**
— the breakpoint and container tokens are mobile-capable so a later phone pass
is purely additive, but no phone-optimized layouts are designed here.

## The organizing idea: a scope→surface taxonomy

The deeper request behind the comments is not "how do I fix this control" but
**"what surface does editing-a-thing-of-scope-X live in, everywhere"** — a
reusable paradigm so new features slot in without re-deciding.

| Scope of the thing | Examples | Surface it lives in | Rule |
|---|---|---|---|
| **Trip-global** | name, dates, budget, currency | **Settings surface** (a side-sheet reached from a gear in the header) — *not* always-on chrome | set-once / revisit-occasionally |
| **Identity** | "you're in *Italy*", budget-vs-total glance | **Header** — read-only reminder, no editing | orientation only |
| **Entity (activity)** | title, time, location, cost, anchors | **Portable entity editor** (a side-sheet) — one component, raised *with prefill* from any lens | the form is decoupled from its trigger |
| **Structural** | add / remove / reorder day | **Inline affordances** on the board | in-place, lightweight |

Two cross-cutting rules make it a paradigm (see ADR-011):

- **R1 — scope decides surface, not screen.** A new global setting goes in the
  Settings sheet automatically; a new activity field goes in the entity editor.
  Nobody re-decides per feature.
- **R2 — triggers carry context; the surface is reused.** The entity editor is
  raised via `openCreate(prefill)` / `openEdit(activityId)`. The prefill payload
  `{ dayId?, location?, timeWindow? }` is known **at the trigger's own
  position** — the "+" at the foot of a day, a map double-click — so adding a
  new invocation point is wiring one trigger, never rebuilding the form.

### Surface vocabulary (fixed, so R1 holds)

| Surface | Used for | Why this one |
|---|---|---|
| **Sheet** (slides from the right; board stays visible, dimmed) | create/edit an **activity**; **trip settings** | roomy for many fields; keeps spatial context so context-prefill is meaningful |
| **Popover** (anchored, small) | tiny contextual controls — clear-date (#2), History (#13), row menus | attached to its trigger; never pushes page content down |
| **Dialog** (centered, blocking) | destructive confirmations only | the only time blocking the screen is correct |

The activity editor is a **sheet, not a dialog** (a dialog covers the map/day
you just acted on, killing prefill) and **not a popover** (the form has too many
fields — a popover reproduces the overflow of comment #9).

## Client-state architecture (the implementation spine)

A hierarchy of React contexts that surfaces and triggers read from. This is
UI-layer only — it imports the typed API client, never `packages/domain` or
`src/server` (AGENTS.md architecture wall).

```
<TripProvider tripId>          // { trip, history, dispatch, pending, activeTrip, preview:{seq,enter,exit}, error }
  <EditorHost>                 // { openCreate(prefill?), openEdit(activityId), close, state }; renders the ONE activity Sheet at root
    <LensRouter>               // { lens, view, setLens, setView } derived from the URL; no local mirror
      <TripHeader/>            // pure reader of TripProvider: identity + budget-vs-total; gear→Settings sheet, History popover, undo/redo
      <SettingsSheet/>         // trip-global edits, dispatched
      <LensOutlet/>            // renders the active lens; a lens calls useEditor().openCreate({ dayId })
```

This replaces the prop-drilling in the current
`apps/web/src/components/board/TripBoardScreen.tsx`, where `dispatch`, `history`,
preview state, and every callback are threaded by hand through `Board`.

### The three invariants of the spine (ADR-012)

1. **`TripProvider` is a server-cache + dispatch, never a client store.** The
   event log is the sole source of truth (AGENTS.md Invariant 1); the trip is
   refetched after every command (`load()`). The context *wraps* the fetched
   read-model and `dispatch` for ergonomics. Writing into trip context to
   "optimistically update" instead of dispatching a command is the drift smell —
   stop and escalate. No contract or domain change rides on this refactor.

2. **View state is URL-as-truth, unidirectional.** The URL is the log; the
   context is a projection of it — the same discipline the domain runs on.
   ```
   click tab ─▶ router.replace(?lens=…&view=…, {scroll:false}) ─▶ URL changes ─▶ LensRouter re-derives ─▶ UI renders
   ```
   `LensRouter`'s value is **derived from `useSearchParams()` every render**;
   there is **no `useState` mirror** and no effect syncing state→URL (that second
   source of truth is what loops/deadlocks — it is banned). `setLens`/`setView`
   do exactly one thing: `router.replace`. Hydrate-on-load is free. Buys
   deep-linkable tabs, the Calendar↔Timeline toggle, and refresh-survival.

3. **Overlays are opened by state we own, never by a library Trigger
   component.** The Sheet/Popover `open` prop comes from `EditorHost` /
   local state; the trigger is a plain `<Button onClick={open}>`. Radix's
   `*Trigger` components respond only to pointer events, so `fireEvent.click`
   in unit tests would silently fail to open them — the exact trap comment #11
   documents for the lens switcher. Owning `open` sidesteps it everywhere and
   keeps the existing `fireEvent`-driven tests valid.

## Pattern 1 — Responsive content-width system

**New tokens (added to `globals.css` `@theme` + documented in
design-system.md together):** named container widths —

| Token | Width | Use |
|---|---|---|
| `--container-measure` | ~640px | forms, the Settings sheet, reading-width prose |
| `--container-content` | ~1120px | default page content; lens bodies that aren't full-bleed |
| (full-bleed) | none | the board and the map, which want the viewport |

**New composite `PageContainer`** (`ui/page-container.tsx`):
`<PageContainer width="content|measure|full">` → `mx-auto` + horizontal padding
+ the chosen max-width. This is the single home for page width; it replaces the
current inconsistency (`trips/[tripId]/page.tsx` uses `max-w-none`, `page.tsx`
uses `max-w-6xl`, editors use `max-w-md`). Resolves the "too wide / logical max
sizes" complaints (**#1, #4, #9**) at the container level rather than per element.

**Breakpoints:** keep Tailwind's default breakpoint *values* (mobile-capable),
but design-system.md now states an **opinion**: the **minimum supported width is
1024px** (desktop-first); below it is best-effort until the mobile milestone. One
named **board-stack breakpoint** (`lg`) is where the board switches from
horizontal day-columns to a stacked layout.

## Pattern 2 — Overflow policy + affordance

design-system.md gains a **decision rule**: a row/section that overflows either
(a) **wraps/stacks** (default — most content), or (b) **scrolls internally with
a visible affordance** (only when horizontal adjacency is meaningful, i.e. the
board). Gradients are banned (design-system.md), so the affordance is an **edge
`shadow`** cue at the scroll boundary, never a fade.

**Board at scale (#10 — the "brainstorm" comment).** Drag-drop between adjacent
days needs horizontal adjacency, so the board keeps horizontal scroll rather
than becoming a grid. Recommended resolution:
- a **visible right-edge shadow** when more days exist off-screen (the missing
  "hint you can scroll");
- a compact **day pager** (Day 1…N chips) above the board that scrolls the
  target column into view on click — navigation without dragging across the
  whole width;
- below the **board-stack breakpoint**, day columns stack vertically.

This is the one piece whose feel should be confirmed visually during the
foundation track before the rest of the board work builds on it; the convention
(scroll + edge-shadow + pager) is decided, the exact chip styling is not.

## Pattern 3 — Field-with-context

For fields whose purpose or domain concept isn't self-evident (**#5, #6, #7, #8,
#12a**):

- **Every field has a visible `Label`** via `FormField` — fixes the unlabeled
  cost input (**#7**). `FormField` already carries a `hint`; Wave 2 makes the
  label mandatory and adds an optional **`description`** slot for one-line
  plain-language context.
- **Unfamiliar concepts get an inline explainer.** The "anchor" control (**#8**)
  — currently a bare `select#anchor-kind` — gets a plain-language label ("Lock
  this to a date rule"), a `description` explaining what an anchor does, and a
  friendlier control than a raw enum select. The explainer pattern (label +
  description + optional "?" popover) is the reusable answer for any future
  domain concept a normal user won't recognize.
- **A search/typeahead field is distinct from form submit.** `LocationInput`
  (**#5, #6**) becomes a proper combobox: results render as a styled `listbox`
  with clear separation between rows (fixing "no separation, font overlaps"),
  and **Enter triggers the search, not a form submit** (`onKeyDown` handles
  Enter → search and calls `preventDefault`, so the surrounding form isn't
  submitted). This is behavior change #1 of the wave.

## Pattern 4 — Header / settings split + surfaces

The current screen dumps date, budget, undo/redo, history, and the lens strip as
flat siblings in one `<main>` with no grouping (root cause of **#12, #14, #15**).
Wave 2:

- **`TripHeader`** = read-only identity (trip name, date range, a
  budget-vs-total glance) + action affordances: gear → Settings sheet, History
  popover, undo/redo (frequent, so they stay in the header). A clear visual
  boundary (surface + hairline) separates header chrome from lens content
  (**#14**).
- **`SettingsSheet`** holds trip-global edits — **budget/currency move here**
  from the always-visible header (**#12b**: budget is set-once, so it doesn't
  belong in permanent chrome). Its fields get the Pattern-3 treatment, so the
  "no indicator this sets the budget" problem (**#12a**) is fixed by a proper
  labelled "Trip budget" field.
- **History becomes a Popover** anchored to its header trigger, not an inline
  panel that pushes content down (**#13**) — consistent placement regardless of
  scroll. Pagination/`next-prev` for history entries (**#1**) is designed in at
  the same time (the entries list gets a max height + internal scroll, and a
  bounded page size).
- **Lens switcher reads as tabs (#11) without Radix.** A presentational
  `TabStrip` reuses the moss-pill visual styling of `ui/tabs.tsx`'s `TabsList`
  (raised active tab on a moss track) applied to plain `role="tab"` buttons
  wired to `LensRouter` — **not** Radix `Tabs`/`TabsTrigger`, so
  `fireEvent.click` keeps working (the documented Track-B1 constraint).
- **Calendar + Timeline merge into one "Schedule" lens** with a `view` toggle
  (a new `SegmentedControl` primitive, state in `LensRouter` `?view=`). They are
  two renderings of the same time data; merging also cuts the flat tab count,
  further helping tab legibility. This is a structural change — two lenses become
  one tab plus a toggle — and the e2e that selects the Calendar/Timeline tabs
  updates accordingly.

The activity editor moving from inline to a raised sheet (introduced under the
surface vocabulary above) is **behavior change #2** of the wave, alongside
Enter-to-search (#1).

## Small conventions (not their own pattern)

- **Human-readable dates (#3).** design-system.md mandates mono `DataText` for
  dates but not a *format*. Wave 2 adds a date-format convention: `DataText`
  dates render human-readably (e.g. `Sun, Jul 12`) via a shared formatter, not
  raw ISO `2026-07-12`. Money already formats; dates join it.
- **Rare-operation prominence (#2).** "Clear date" is a rare op, so it moves off
  a prominent standalone button into the date control's Popover, and the copy is
  singular ("Clear date"). Generalizes to: rare/destructive-adjacent operations
  live in a contextual popover, not permanent chrome.

## New / changed components (design-system.md inventory updates)

- **New composites:** `PageContainer`, `Sheet` (Radix Dialog, side-positioned,
  state-opened), `Popover` (Radix Popover, state-opened), `SegmentedControl`,
  `TabStrip` (presentational, non-Radix).
- **Changed:** `FormField` (mandatory label + `description` slot); `LocationInput`
  → combobox with a `listbox` results pattern.
- Every addition updates the design-system.md component inventory in the same
  task (adding a component is a design-system change).

## Comment → resolution map (all 15 accounted for)

| # | Comment | Resolved by |
|---|---|---|
| 1 | History too wide, needs pagination | P1 container + P4 History popover with bounded/paged, internally-scrolled list |
| 2 | Giant "Clear dates" button; "date" not "dates" | Small convention: rare op → date-control popover; copy fix |
| 3 | More human-readable date | Small convention: `DataText` date formatter |
| 4 | Itinerary subtotal rows too wide; "logical max sizes" | P1 container + `--container-content` |
| 5 | Search results unreadable | P3 combobox `listbox` styling |
| 6 | Enter should search, not submit | P3 combobox key handling (behavior change #1) |
| 7 | Cost field has no label | P3 mandatory `FormField` label |
| 8 | "Anchor" concept unclear | P3 explainer (label + description + friendlier control) |
| 9 | Create-event UI overflow | P1 container + P4 editor as sized Sheet |
| 10 | Board scroll, no affordance; 7+ day trips | P2 overflow policy: edge-shadow + day pager + stack breakpoint |
| 11 | Lens switcher doesn't read as tabs | P4 `TabStrip` (non-Radix, preserves `fireEvent`) |
| 12 | Budget unclear + too top-level | P4 budget→SettingsSheet (12b) + P3 labelled field (12a) |
| 13 | History should be a popover, not push-down | P4 History Popover |
| 14 | No separation between chrome and content | P4 `TripHeader` boundary |
| 15 | Two bars misaligned | P4 header restructure removes the ad-hoc flat rows |

## Constraints carried from M5 / AGENTS.md

- **Architecture wall:** all changes in `apps/web/src` UI layer; no import of
  `packages/domain` or `src/server`; **no contract change** (URL/context/UI only)
  → no `docs/contracts/CHANGELOG.md` entry. The portable editor dispatches the
  same `AddActivity`/`UpdateActivity` commands — schemas untouched.
- **Enforcement wall stays green:** new colors/tokens only in `globals.css`;
  new primitives live in `components/ui/`; the element/style/color walls hold.
- **Overlays state-opened, not Trigger-opened** (spine invariant 3) — preserves
  `fireEvent` unit tests.
- **e2e:** unlike Wave 1, behavioral e2e updates ARE expected (Enter-to-search,
  editor-as-sheet, budget-in-settings, merged Schedule lens). Each behavioral
  test change is justified in its commit; `data-testid`/`aria-label` are
  preserved where the element still exists. This replacement of Wave 1's
  "selector-only" rule is the crux of the milestone-file amendment.

## Deliverables

1. This spec.
2. **ADR-011 — editing-surfaces model.** The scope→surface taxonomy, R1/R2, and
   the surface vocabulary (sheet/popover/dialog). Its own **validation:** a new
   global setting demonstrably lands in the Settings sheet and a new activity
   field in the entity editor with no per-feature surface decision (R1); the
   entity editor is raised with prefill from at least two distinct triggers
   (R2). Gated independently in the Wave-2 exit gate.
3. **ADR-012 — client-state architecture.** The `TripProvider → EditorHost →
   LensRouter` spine and its three invariants (cache-not-store, URL-as-truth
   unidirectional, overlays-opened-by-owned-state). Its own **validation:** trip
   state is only mutated via `dispatch`+refetch (grep shows no direct context
   writes); `LensRouter` holds no `useState` mirror of the URL; a targeted test
   proves `fireEvent.click` opens every overlay. Gated independently.
4. **design-system.md amendments** — breakpoints/containers, overflow policy,
   surface vocabulary, field-with-context, date-format convention, new inventory
   entries (done in the implementation tasks, since the doc and tokens change
   together).
5. **M5 milestone amendment** — scope-expansion note + Wave-2 exit gate that
   validates ADR-011 and ADR-012 as independent line items.
6. The implementation plan `docs/plans/2026-07-12-M5-layout-and-surfaces.md`.

## Open items carried into the plan

- Exact `--container-*` pixel values (ranges given above; pinned in F-track
  against real content width).
- Board day-pager chip styling (convention decided; visual pinned in F-track).
- Whether the anchor control's "friendlier UI" is a segmented control, a
  labelled select, or a small guided form — decided during P3 implementation
  against the actual anchor kinds, staying within `NativeSelect` semantics
  (ADR-010) if a select is kept.
