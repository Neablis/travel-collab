### KI-85 — The Map lens reported as "no longer full height", not reproduced
- **Severity:** cosmetic — and **unconfirmed**; this entry exists so the report is not lost, not because a defect is established
- **Area:** `apps/web/src/components/lenses/MapLens.tsx`, `.map-lens` / `.map-lens-canvas` in `apps/web/src/app/globals.css`
- **Symptom as reported:** Mitchell, on PR #89's preview (2026-08-29), with a screenshot: the map does not fill the height it used to. Seen on his own trip at `?lens=Map`, in a **3440×1271** window.
- **What was checked, and what it rules out.** The report arrived on a PR that changed `DayChips`, which sits directly above the map, so the obvious suspect was a taller header squeezing a flex-sized lens. Measured both ways on the same page and viewport — with that change checked out, and with the previous version:
  ```
  pre-change   header 153px   map lens 630px   top offset 288px
  post-change  header 153px   map lens 630px   top offset 288px
  ```
  Not a pixel moved. PR #89's diff also contains no change to `MapLens.tsx`, to `globals.css`, or to any container above the lens. On `/demo?lens=Map` at 1200×900 the map ran to the bottom edge with the MapLibre attribution bar on it.
- **Why it is still filed.** Three things differ between that check and the report, any of which could carry it: a 3440px-wide window versus 1200px (a much wider aspect than anything tested), `/demo` renders a banner above the board that a real trip does not, so the offsets above the lens differ, and the report is against a Vercel preview rather than a local build. None of those were eliminated.
- **What would settle it:** open `/demo?lens=Map` at ~3440×1271. Full height there means it is specific to a real trip's header and this is a live defect; short there means it is width-dependent and reproducible without an account. Either way it is **not** PR #89's — that much is measured — so it belongs to whatever change did it, or to `main` as it stands.
- **Cross-reference:** KI-49 (the Map lens's tiles have never been confirmed to paint — a different and still-open claim about the same lens).
- **First noted:** 2026-08-29 (PR #89 preview review).
