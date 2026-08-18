# Design system — tokens, palette, components

**Normative reference for all UI work from M5 onward.** Every visual decision in
`apps/web` resolves to a token defined here; every rendered text element, input,
and button goes through the shared components listed here. The Tailwind `@theme`
block in `apps/web/src/app/globals.css` is the single machine-readable source of
truth; this document is its human contract (the two change together — a token PR
updates both).

Aesthetic direction: **Field Kit** — cartographic calm. Cool paper ground, ink
navy text, one quiet teal accent, warm semantic colors that stand out because
everything else is muted, and monospace for all data values (times, dates,
currency) so ledger-like surfaces align. Decided by Mitchell at M5 kickoff
(2026-07-11). Component library: shadcn/ui, heavily re-themed — see ADR-010.

## Typography

| Role | Face | Usage |
|---|---|---|
| Display | Bricolage Grotesque | Headings only (`Heading`). Weights 500–600. Never for body or UI chrome. |
| Body / UI | IBM Plex Sans | Everything else (`Text`, `Label`, buttons, inputs). Weights 400/500/600. |
| Data | IBM Plex Mono | **All** times, dates, durations, currency amounts, IDs (`DataText`). Weight 400/500. This is the system's signature — money and time columns align like a ledger. Dates rendered in `DataText` use `formatTripDate`/`formatTripDateLong` — never bare ISO strings. |

Loaded via `next/font` (self-hosted, zero layout shift). No other font families,
weights, or `font-style: italic` display usage.

**Type scale** (Tailwind `text-*` tokens; no arbitrary sizes):

| Token | Size / line-height | Use |
|---|---|---|
| `text-xs` | 12px / 1.35 | Badges, timestamps, table footnotes |
| `text-sm` | 13px / 1.4 | Secondary text, hints, dense table cells |
| `text-base` | 14px / 1.45 | Default UI text, inputs, buttons, table cells |
| `text-md` | 16px / 1.45 | Emphasized body, dialog body |
| `text-lg` | 19px / 1.3 | `Heading` h3 / card titles |
| `text-xl` | 24px / 1.2 | `Heading` h2 / panel titles |
| `text-2xl` | 30px / 1.15 | `Heading` h1 / page title (one per page) |

`DataText` pairs one notch down from its surrounding sans size (mono runs
optically larger).

## Spacing, radii, shadows, breakpoints

- **Spacing:** Tailwind's default 4px grid, unmodified. Arbitrary values
  (`p-[13px]`) are banned by lint — if a spacing need doesn't fit the grid, the
  design is wrong, not the grid.
- **Radii:** `rounded-sm` 6px (badges, inputs, small controls) · `rounded-md`
  8px (buttons, cards) · `rounded-lg` 12px (dialogs, panels) · `rounded-xl`
  14px (day headers, stat tiles) · `rounded-2xl` 16px (day columns) · `rounded-full`
  999px (pills, avatars).
- **Shadows:** two levels only. `shadow-raised` (`0 1px 2px rgb(21 29 46 /
  0.06)`) for cards that must lift off a tinted background; `shadow-overlay`
  (`0 8px 24px rgb(21 29 46 / 0.12), 0 2px 6px rgb(21 29 46 / 0.08)`) for
  dialogs/popovers. Everything else separates with borders, not depth.

### Breakpoints & containers

**Breakpoints:** Tailwind defaults, untouched. M5 must not regress current
responsive behavior; a real responsive pass is explicitly out of scope.
**Minimum supported width is 1024px** (desktop-first; below that, layout is
best-effort until the mobile milestone). The `lg` breakpoint (1024px) is named
the **board-stack breakpoint**: below it, the trip board's day-column layout
switches from horizontal to stacked.

**Container widths:** Two tiers, generated from `@theme` tokens in
`globals.css`:

| Token | Pixels | Use |
|---|---|---|
| `--container-measure` | 640px (40rem) | Forms, settings panels, prose passages |
| `--container-content` | 1120px (70rem) | Default page width; non-full lenses |

Used via the `PageContainer` composite, which applies `mx-auto` (centers) +
`px-6` (safe margin) + a max-width class (`max-w-measure`, `max-w-content`) or
none (`width="full"` for board/map views). See `PageContainer` below.

### Overflow policy

**The trip board wraps; it does not scroll horizontally.** Day columns
(`Column.tsx`, `data-testid="day-column"`) render in a `flex flex-wrap` grid
below the backlog strip rather than a fixed-width horizontally-scrolling row —
the previous `overflow-x-auto` treatment and its "Jump to day" affordance are
retired (#31/#23/#4/#10). The backlog renders as a full-width strip
(`fullWidth` prop on `Column`) above the day grid instead of sitting inline as
just another scrollable column.

**Day cards are whole-card drop targets with a comfortable minimum height.**
Each day `<section>` is a flex column with `min-h-44` (dated day cards only —
the backlog keeps its own compact height); the droppable `<ul>` inside is
`flex-1` with `min-h-24` (`min-h-12` for the backlog), so the drag-and-drop
target fills the card rather than just the area actually occupied by activity
rows. This means dropping anywhere in an empty or sparse day card — not just
on existing cards — targets that day.

### Surface vocabulary (fixed, so R1 holds)

| Surface | Used for | Why this one |
|---|---|---|
| **Sheet** (slides from the right; board stays visible, dimmed) | create/edit an **activity**; **trip settings** | roomy for many fields; keeps spatial context so context-prefill is meaningful |
| **Popover** (anchored, small) | tiny contextual controls — clear-date (#2), History (#13), row menus | attached to its trigger; never pushes page content down |
| **Dialog** (centered, blocking) | destructive confirmations only | the only time blocking the screen is correct |

The activity editor is a **sheet, not a dialog** (a dialog covers the map/day
you just acted on, killing prefill) and **not a popover** (the form has too many
fields — a popover reproduces the overflow of comment #9).

Both `Sheet` and `Popover` are **state-controlled** (`open`/`onOpenChange` props
owned by the caller) and never expose a Radix `*Trigger` component — see
ADR-012 invariant 3. Radix triggers only respond to real pointer events, so
`fireEvent.click` in unit tests silently fails to open them; the caller instead
renders a plain `Button` with its own `onClick` that flips `open`.

## Color palette

All values are defined once as `@theme` tokens; raw hex/rgb/hsl literals
anywhere else in `apps/web/src` fail CI (see Enforcement).

### Neutrals

| Token | Hex | Use |
|---|---|---|
| `paper` | `#F7F8F6` | Page background |
| `surface` | `#FFFFFF` | Cards, inputs, dialogs |
| `moss` | `#EFF2ED` | Day-column background, panel tint, hover rows |
| `hairline` | `#DDE2DA` | Dividers, decorative card borders |
| `border-strong` | `#C8CFC4` | Emphasized decorative borders (non-interactive) |
| `border-input` | `#8A938E` | Form-control borders (3.16:1 vs white — meets the 3:1 non-text minimum) |
| `slate` | `#5A6472` | Secondary text, icons |
| `ink` | `#151D2E` | Primary text |

### Brand

| Token | Hex | Use |
|---|---|---|
| `brand` | `#0E7C66` | Primary buttons, active lens tab, links, focus rings |
| `brand-hover` | `#0C6B58` | Hover state of the above |
| `brand-pressed` | `#0A5A4B` | Active/pressed state |
| `brand-tint` | `#E3F0EC` | Selected-item background, subtle brand wash |

### Semantic

Each role is a **tint + text pair** for passive surfaces (badges, banners) and
a **solid** for the rare emphatic use. Text-on-tint pairs are AA-checked below.

| Role | Solid | Tint | Text on tint |
|---|---|---|---|
| `danger` | `#B3372E` | `#F8E3E0` | `#8F2B23` |
| `warning` | `#B07C10` | `#F6EBD4` | `#8A5F0B` |
| `success` | `#2E7D43` | `#E4F0E7` | `#22603A` |
| `info` | `#2B6CB0` | `#E1EBF7` | `#1F5187` |

### When to use what

- **Brand teal never carries state meaning.** It marks *actions and location*
  (primary button, active tab, link, focus) — never success, never "selected
  because valid". A teal element must never be the only signal that something
  went right or wrong.
- **Semantic colors are never decorative.** Danger red appears only on actual
  failures and destructive actions (delete confirmation, failed request). If a
  surface just wants "some red", the answer is no.
- **Conflicts are warnings, not errors.** All conflict UI (banner, card badges,
  lens indicators) uses `warning` amber — conflicts are data with suggested
  resolutions (Invariant 3), not failures. Danger red on a conflict is a
  design-system violation.
- **Info marks time-travel and system notices.** Viewing a past state, a
  revert notice, a "projection rebuilt" banner: `info` blue.
- **Day columns stay neutral** (`moss`). Color encodes meaning here, not
  identity; per-day hue coding was considered (Wayfinding direction) and
  rejected at kickoff.
- **Gradients: none.** Phase 1 prohibits gradient fills outright — this is the
  gradient usage rule. Revisiting it is a design-system change, not a per-PR
  choice.

### WCAG AA contrast (documented combinations, computed)

Normal text needs ≥ 4.5:1; non-text UI boundaries ≥ 3:1. All pass:

| Combination | Ratio |
|---|---|
| ink on paper / white / moss | 15.81 / 16.84 / 14.91 |
| slate on paper / white / moss | 5.63 / 6.00 / 5.31 |
| white on brand (primary button) | 5.13 |
| brand on white / paper (links) | 5.13 / 4.82 |
| white on danger solid (destructive button) | 6.00 |
| danger / warning / success / info text on own tint | 6.72 / 4.77 / 6.39 / 6.74 |
| border-input vs white (non-text) | 3.16 |

Any new text/background combination added later must be computed and appended
here before use.

## Component inventory

All live in `apps/web/src/components/ui/` (shadcn-vendored files re-themed to
these tokens, plus our own additions). **UI code outside `ui/` never renders raw
`<button>`, `<input>`, `<textarea>`, `<select>`, `<label>`, `<h1>`–`<h6>`, or
`<table>` — lint-enforced.**

### Primitives

| Component | Notes |
|---|---|
| `Heading` | h1–h4, display face, owns the type-scale mapping |
| `Text` | Body/secondary/muted variants |
| `DataText` | Mono; the only way times, dates, and money render |
| `Label` | Form labels, tied to `FormField` |
| `Button` | `primary` (brand, max one per view) / `secondary` / `ghost` / `destructive` + `icon` size |
| `Input`, `Textarea` | Native elements, `border-input`, brand focus ring |
| `NativeSelect` | Styled native `<select>` — **not** Radix Select (keeps e2e `selectOption` semantics) |
| `Badge` | Semantic variants (danger/warning/success/info/neutral), pill |
| `Card` | Surface + hairline border + `rounded-md` |

### Composites

| Component | Replaces / skins |
|---|---|
| `FormField` | Label (**required**) + control + optional `description` (one-line explainer between label and control) + hint/error slot (no react-hook-form — existing form logic untouched) |
| `Dialog` | shadcn/Radix dialog; only where a modal already exists behaviorally |
| `Table` | Itinerary / daily / trip lenses, cost rollups; mono data cells |
| `Tabs` | Radix tabs; kept for cases without the fireEvent-safety requirement below |
| `TabStrip` | Non-Radix `role="tab"` button group, moss-pill skin of `Tabs`. Use for the trip lens switcher (Task P1) and anywhere tests must drive selection with `fireEvent.click` — Radix `TabsTrigger` is pointer-only and silently no-ops under `fireEvent` (comment #11 / Track-B1) |
| `SegmentedControl` | Non-Radix `role="radiogroup"`/`role="radio"` button group, same moss-pill skin. Use for two/three-way toggles (e.g. Calendar↔Timeline) where Radix `RadioGroup` would have the same `fireEvent` gap |
| `Banner` | Conflict banner (warning), info notices |
| `Panel` | History panel chrome |
| `PageContainer` | Centers + constrains page width; `width="content"` (default, 1120px) / `"measure"` (640px) / `"full"` (board/map); optionally `as="main"` |
| `Sheet` | Side-anchored Radix Dialog; activity editor, trip settings. State-controlled (`open`/`onOpenChange`), no `SheetTrigger` |
| `Popover` | Anchored Radix Popover; History, clear-date, row menus. State-controlled (`open`/`onOpenChange`), no `PopoverTrigger` |
| `EmptyState` | Empty trip list, empty day, empty backlog |
| `BudgetMeter` | Header spent-vs-budget glance (#30): fill bar (`bg-brand` under budget, `bg-warning` over, clamped at 100%) + `DataText` label (`cost of budget currency`, `text-warning-ink` when over). Fill width is computed geometry via inline `style` — same pattern as `TimelineLens`'s position math |

`TabStrip`/`SegmentedControl` are deliberately hand-rolled, not Radix — see
`apps/web/src/components/ui/tab-strip.tsx`. They are the one sanctioned
raw-`<button>` group outside individual primitives; feature code still never
renders a raw `<button>` directly — import `TabStrip`/`SegmentedControl`
instead of recreating one. Both are fully controlled: they only call
`onValueChange`, never hold their own selected-value state.

Adding a primitive or composite is a design-system change: update this
inventory in the same PR.

### Field-with-context convention

Established with `FormField`'s `description` slot (Task F4) and binding for
form fields going forward:

- **Label is mandatory.** Every `FormField` has a visible `label` — no
  placeholder-as-label, no bare inputs outside `ui/`.
- **`description` is for domain concepts**, not restating the label — use it
  when a field encodes a concept a first-time user won't already know (e.g.
  "Lock to a date rule" needs a sentence explaining what locking means).
  Validation/format guidance stays in `hint`; error state stays in `error`.
- **Search fields use a combobox**, not a bare `Input` with ad hoc
  autocomplete wiring. No combobox primitive exists yet — this convention is
  established here for Task C1 to implement against when it lands.

## Enforcement

Same spirit as the domain purity wall (`docs/guidelines/quality-enforcement.md`):

1. **No raw color literals** — CI grep: hex/rgb/hsl in `apps/web/src` outside
   `globals.css` fails the build. One narrow, deliberate second exception:
   `lib/sparklineColor.ts`, which hashes a city name to one of 8 validated
   categorical hues for the home hero's "Shape of the trip" sparkline — the
   one surface needing a color per real, unbounded city name rather than the
   5 reusable semantic tokens below. The 8-hue cap (not the app's 5, not an
   arbitrary/wider count) is a measured accessibility limit, not a style
   choice — see that file's header comment for the validation behind it.
2. **No inline `style={{…}}`** outside an explicit allowlist (drag transforms,
   maplibre container sizing) — ESLint `no-restricted-syntax`. The rule only
   applies to `src/**/*.tsx` outside `components/ui/**` (and outside
   `*.test.tsx`), so composites that live in `ui/` — e.g. `BudgetMeter`'s fill
   width — are structurally exempt and need no `eslint-disable` comment; a
   disable directive there would be flagged as unused. Components outside
   `ui/` that need an inline style still carry a line-level
   `eslint-disable-next-line no-restricted-syntax` with a reason, matching the
   enumerated-exception pattern used by `TimelineLens`/`MapLens`/`ActivityCard`.
3. **Raw elements banned outside `ui/`** (list above) — ESLint
   `no-restricted-syntax` on JSX element names.
4. **No arbitrary Tailwind values** (`[13px]`, `[#hex]`) — lint.
