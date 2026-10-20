### KI-2026-10-19-d — `LandingHeroArt.failed.test.tsx` times out locally under parallel load

- **Severity:** reliability. Local noise; not seen red in CI so far.
- **Area:** `apps/web/src/components/front/LandingHeroArt.failed.test.tsx:61`
  (`await desktop.findByRole("list", { name: "Day 7 timeline" })`, waiting for the real feature
  panels to load), and the lazy panel import in `LandingHeroArt.tsx` / `LandingFeaturePanel.tsx`
  that PR 494 memoised.
- **Symptom / What happens:** in a local unit run with other files in parallel, the test times
  out at `:61` waiting for the "Day 7 timeline" list. Run on its own it passes.
- **Why:** not proven. `findByRole`'s default timeout (1 s) has to cover a real dynamic import of
  the feature panels module; under parallel load that import can take longer. CLAUDE.md rule 2:
  record where it fails each time before calling it a timeout; so far it is the same line.
- **Why not fixed here:** found during M50's build; the close is prose-only.
- **Fix direction:** give that one `findByRole` a longer `timeout`, or preload the panels module
  in the test's setup so the wait does not include a cold import. Capture the failure text on
  the next occurrence.
- **Cross-reference:** KI-2026-10-14-c (the lazy-import race PR 494 fixed in the sibling
  `LandingFeatureBlocks.failed.test.tsx`).
- **First noted:** 2026-10-19, local unit runs during M50's build (recorded in the hand-off for the close).
