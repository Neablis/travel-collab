### KI-2026-09-20-c — the Map lens's offline panel covers the day rail, leaving enabled controls that cannot be clicked

- **Severity:** real, and only invisible because the condition that triggers it
  is rare in the environments that run the tests.
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

- **Fix sketch (not done):** the decision is which of two things the offline
  state means. If "this lens is unavailable", the rail, legend and focus card
  should not render at all while `failed` — no purposeless UI (project rule 2),
  and nothing enabled sits under the panel. If "the basemap is unavailable but
  the day list still navigates", the panel should cover only the canvas and the
  chrome should sit above it. **Do not simply raise the rail's z-index**: that
  produces a working day rail floating over a "we could not load the map" panel,
  which reads as two surfaces disagreeing.

  Whichever is chosen, the constraint from build-check 5 is unchanged: the
  MapLibre container div must stay mounted. Only the chrome may be branched.

- **First noted:** 2026-09-20 (M26 link 4, found by the e2e lane after the
  shared-day map went in).
