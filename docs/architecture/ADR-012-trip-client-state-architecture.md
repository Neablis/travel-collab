# ADR-012: Trip client-state architecture — a context spine, URL-as-truth

**Status:** Accepted — 2026-07-12
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

`TripBoardScreen` prop-drills dispatch, history, preview state, and every
callback through the board. The surfaces model (ADR-011) needs any component to
read trip state and raise the portable editor. We need shared UI state without
turning it into a second source of truth (the event log is Invariant 1) and
without reintroducing the Radix-trigger test breakage documented for the lens
switcher.

## Decision

A hierarchy of UI-layer React contexts: `TripProvider → EditorHost →
LensRouter`. Three binding invariants:

1. **TripProvider is a server-cache + dispatch, never a store.** It wraps the
   fetched `TripDetail`/`TripHistory` + preview state + `dispatch`. Trip state is
   mutated ONLY by `dispatch(command)` → refetch. No direct context writes.
2. **View state is URL-as-truth, unidirectional.** `LensRouter` derives `{ lens,
   view }` from `useSearchParams()` each render — no `useState` mirror, no
   state→URL effect. `setLens`/`setView` call `router.replace(..., { scroll:
   false })` and nothing else. The URL is the log; the context is its projection.
3. **Overlays are opened by owned state, never a library `*Trigger`.** Sheet /
   Popover `open` comes from `EditorHost` or local state; triggers are plain
   `<Button onClick>`. Radix `*Trigger` components respond only to pointer
   events, so `fireEvent.click` would silently fail to open them.

## Consequences

- `components/trip/context/{TripProvider,EditorHost,LensRouter}.tsx` with hooks
  `useTrip()`, `useEditor()`, `useLens()`.
- Deep-linkable tabs + Calendar↔Timeline toggle + refresh-survival fall out of
  invariant 2 for free.
- Validation (gated independently in the Wave-2 exit gate): grep shows no direct
  trip-context writes; `LensRouter` has no `useState`; a test proves
  `fireEvent.click` opens every overlay.
- No contract/domain change; UI layer only.

## Note, 2026-09-24 — how trip detail stays fresh (KI-2026-09-05-i item 5)

Invariant 1's "→ refetch" has a second trigger since M13: **news that the trip
moved**, from `useTripBroadcast` (`components/trip/context/broadcast.ts`,
ADR-049). It is the only freshness mechanism for trip detail, and every surface
that reads the trip subscribes to it rather than growing its own. `TripProvider`
does. So does the notebook (`PageScreen`), which is **not** under
`TripProvider` because it never writes planning data. It keeps its own read of
`trip` and `globals`, refetches both on news, and never refetches the page
document, so an author mid-edit is not clobbered. The gates are ADR-049
Decision 2's. Every reader asks once on coming back to the tab or window, and
only a multi-member trip polls on a timer. The demo trip never polls.
