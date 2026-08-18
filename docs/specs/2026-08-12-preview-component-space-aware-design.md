# Preview component: space-aware not-implemented indicator

**Date:** 2026-08-12
**Status:** Approved

## Problem

`Preview` (`apps/web/src/components/ui/preview.tsx`) is the shared wrapper used to mark not-yet-implemented UI. Today, regardless of what it wraps, it renders a single treatment: a `position: absolute` text pill (`Preview · M11`) pinned to the top-right corner via negative offsets, over dimmed/pointer-events-disabled children.

That one-size treatment doesn't fit the range of things `Preview` actually wraps — from a single `<Button>` (e.g. `ShareButton`) up to an entire dialog body or route screen (e.g. `PlaybooksScreen`). On small targets, the text pill can visually overwhelm or overflow what it's labeling. There's no way today to give small and large targets different, more space-appropriate treatments.

## Goals

- Small wrapped content (a button, a small control) gets a minimal single-icon indicator instead of the current text pill.
- Large wrapped content (a section, dialog, route) gets a dotted border around the whole thing, signaling "everything inside is under construction," in addition to today's indicator.
- The choice between these two treatments is explicit and predictable, not inferred at runtime.
- Removing `Preview` later (when a feature ships) stays a trivial one-line change — wrapped content must render identically to its un-wrapped form today, just dimmed/disabled.

## Non-goals

- No visual redesign of the badge/tooltip content itself (still `Preview · {milestone}`, still driven by `PREVIEW_REGISTRY`).
- No auto-detection of size from rendered dimensions (see Alternatives).
- No changes to `PREVIEW_REGISTRY` or the id/milestone data model.

## Design

### API

`Preview` gains a new **required** prop:

```ts
size: "compact" | "container"
```

Required, no default — every call site must explicitly declare which treatment it wants. This matches the codebase's existing preference for explicit-over-inferred values (e.g. the color-wall lint that forbids literal color values outside the token file).

### Shared behavior (unchanged in both variants)

- Children render fully, wrapped in the existing `pointer-events-none` dimming div.
- `role="group"`, `aria-disabled="true"` on the outer element.
- `title={note ?? "Coming in " + milestone}` tooltip, unchanged.
- The existing outer-wrapper position-detection logic (`POSITION_KEYWORD` check that decides whether to inject `relative`) is untouched.

### `size="compact"`

Replaces the current text pill with a small circular badge containing only a `Construction` icon (`lucide-react`, already a project dependency).

- Same corner position as today: `absolute -right-1.5 -top-1.5`.
- Same badge chrome: `bg-ink/80`, `rounded-full`.
- Icon sized small (e.g. `size-3`/`size-3.5` — pick to visually balance inside the existing circular badge dimensions), `aria-hidden` (the `title` tooltip still carries the actual info for assistive tech).
- No border added.

### `size="container"`

Keeps the current text pill (`Preview · {milestone}`) completely unchanged. Additionally:

- The outer wrapping div gets `border border-dotted border-border-strong rounded-lg`.
- No extra inset/padding is added — content that already has its own padding (dialogs, cards) doesn't need the wrapper to add more.
- `border-border-strong` (neutral token) rather than `border-brand`, so the indicator doesn't visually compete for attention the way an actionable/brand-colored dashed border does elsewhere in this codebase (e.g. `GhostProposal`, add-buttons).

### Call-site migration

All current usages of `<Preview>` get the `size` prop added:

**`size="compact"`**
- `components/trip/ShareButton.tsx` — Share button
- `components/trip/AddSavedDayButton.tsx` — Add a saved day button
- `components/lenses/TimelineLens.tsx` — Ask button (per-activity)
- `components/lenses/TimelineLens.tsx` — `KeepDayFlag`
- `components/assistant/AssistantRail.tsx` — quick-ask chip button row

**`size="container"`**
- `app/page.tsx` — `PlaybooksStrip` section
- `app/page.tsx` — `WorthYourAttention` section
- `app/playbooks/page.tsx` — whole `PlaybooksScreen` route content
- `components/assistant/AssistantRail.tsx` — "What I noticed" suggestion cards div
- `components/home/NextTripHero.tsx` — the "need a decision" `StatTile`
- `components/trip/InsertPlaybookDialog.tsx` — dialog body
- `components/trip/KeepDayDialog.tsx` — dialog body
- `components/lenses/TimelineLens.tsx` — `GhostProposal` card

(Exact file:line references should be re-verified at implementation time against current `main`, since this branch may have moved since the design conversation.)

### Testing / verification notes

- There is an existing test that keeps `PREVIEW_REGISTRY` keys in sync with actual `<Preview id>` usages in the codebase. Confirm it doesn't assert on the full prop shape in a way that breaks once `size` becomes required — if it does, update it alongside the call-site migration, not as an afterthought.
- Visual check: verify both variants in the running app — one compact call site (e.g. `ShareButton`) and one container call site (e.g. a dialog) — to confirm the icon badge renders legibly at its shrunk size and the dotted border doesn't visually clash with existing dashed-border UI elsewhere on the same screen (empty states, add-buttons).

## Alternatives considered

**Auto-detect size at runtime** (e.g. `ResizeObserver` measuring rendered children, switching treatment past a pixel threshold). Rejected: adds runtime measurement and mount-time flicker to what's otherwise a pure-CSS component, and the threshold would be an arbitrary guess rather than something the caller is actually asserting. Every current call site already knows statically what it's wrapping, so there's nothing to infer.

**Icon-replaces-content for compact** (icon fully replaces the wrapped element rather than overlaying it). Rejected per explicit direction: wrapped content must stay exactly as it renders today so that removing `Preview` later, once a feature ships, is a trivial no-op change rather than requiring the caller to reconstruct what the unwrapped element looked like.

**Corner icon on `container` too** (pairing the dotted border with the same small icon used in `compact`, dropping the text pill). Rejected per explicit direction: containers have enough space to keep the existing, more informative text pill (`Preview · {milestone}`), so it's retained unchanged and the dotted border is purely additive.
