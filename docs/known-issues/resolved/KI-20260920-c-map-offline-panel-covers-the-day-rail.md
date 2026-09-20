### KI-2026-09-20-c — the Map lens's offline panel covers the day rail, leaving enabled controls that cannot be clicked

- **Severity:** real, and only invisible because the condition that triggers it
  is rare in the environments that run the tests. (As found.)
- **Area:** `apps/web/src/components/lenses/MapLens.tsx` (the `failed &&
  <MapOfflineState … />` overlay and the rail/legend/focus-card branch below
  it), `apps/web/src/components/lenses/MapOfflineState.tsx`.
- **Symptom / What happens:** when MapLibre reports a fatal style or source
  error, `MapOfflineState` renders as `absolute inset-0 z-10` over the lens.
  That is deliberate and documented — *"over the canvas and not instead of it
  (SPEC §13)"*, because a React conditional around the container detaches the
  node mid-style-load and the load aborts with no error (DRIFT §6 build-check
  5, on its third recurrence). **But `inset-0` is the whole lens, not the
  canvas**, so it also covers the day rail, the legend and the focus card,
  which are siblings rendered after it at a lower stacking level.

  The rail's buttons stay mounted, visible and enabled underneath. Playwright
  reports them as *"visible, enabled and stable"* and then retries a click 170
  times until the test times out, because the overlay eats every one. A person
  sees the same thing: a day list that looks live and does nothing — the exact
  *"control that appears to do something and does nothing"* that `MapLens`'s own
  `readOnly` comment refuses a few hundred lines further up.

- **How it was found:** `e2e/m10-map-rail.spec.ts:52` in a cloud session,
  2026-09-20. **It passes in CI**, where the tile host is reachable and the lens
  never reaches `failed`.

- **This is NOT KI-49, though KI-49 is why it was visible.** KI-49 is the egress
  proxy blocking `tiles.openfreemap.org` from a cloud session's browser. That is
  what puts the lens into `failed` here. The covered rail is a separate
  behaviour that would do the same thing to any genuinely offline person, in any
  environment, and it arrived with `MapOfflineState` in M26 (this branch) — the
  older behaviour was a blank canvas with working chrome over it.

  **Consequence for the lane:** `m10-map-rail` is red in every cloud session
  regardless of how this entry is fixed, because the tiles still will not load.
  Fixing this does not turn the lane green here; it stops an offline person
  being handed dead controls.

- **Fix:** the chrome is not rendered while `failed`. One guard in
  `MapLens.tsx` wraps the phone strip / rail+card+legend branch, so nothing
  enabled is left underneath the panel.

  **Option A of the two the sketch named** ("this lens is unavailable"), chosen
  because option B's premise is mostly false: when `failed` is set the style
  never parsed, so there are no markers and no route lines to navigate between.
  A live rail would have been steering an empty canvas, and two surfaces
  disagreeing is worse than one saying the lens is unavailable.

  **The container div is untouched and still renders unconditionally** — the
  constraint from DRIFT §6 build-check 5 that the sketch flagged. Only the
  chrome is branched, so retry still has a node to rebuild into.

  **Seen to fail** (CLAUDE.md rule 3): replacing the guard with `true` turns
  the new test red — *"expected `<div aria-label="Days">` to be null"*. The
  assertion is deliberately "the rail is GONE" rather than "the panel is on
  top", because a z-index assertion would pass while the dead control was still
  there, which is the defect. A second test pins the container's continued
  presence so a future tidy-up cannot branch it by accident.

  `MapLens.test.tsx` 45 passed (was 43); all lenses 329 passed.

- **Still open, and separate:** `isFatalMapError` treats ANY source-attributed
  error as fatal, which is `MapLens`'s shipped coarseness carried over
  deliberately. It means a single tile 404 blanks the lens even though the
  style loaded and pins would have drawn over a grey basemap. Narrowing it to
  style-only failures is probably right, and needs a reproduction proving the
  map stays useful in that state — which KI-49's browser-trust fix would make
  possible for the first time.

- **First noted:** 2026-09-20 (M26 link 4, found by the e2e lane after the
  shared-day map went in). **Resolved:** 2026-09-20, same day, Mitchell's call
  to pick whichever option was right.
