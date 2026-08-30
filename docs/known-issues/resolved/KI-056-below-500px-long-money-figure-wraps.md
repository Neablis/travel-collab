### KI-56 — Below ~500px a long money figure wraps, so the KI-28 reserved slot grows and the menu drifts again — RESOLVED by reserving two lines below the width where the slot is wide enough for one
- **Severity (as filed):** reliability (the KI-28 defect, reintroduced at narrow widths only)
- **Area:** `apps/web/src/components/home/TripCard.tsx`, `apps/web/src/components/home/NextTripHero.tsx`
- **Reproduced in a real browser before fixing** — production build, Chromium, seeded trips, measuring the actual KI-28 invariant (card height with the slot EMPTY, as before its `TripDetail` resolves, against the height once the line lands):
  ```
  viewport 341px   hero  slot 222px   reserved 20 -> withReal 40   card growth 20.0px
  viewport 341px   card  slot 246px   reserved 20 -> withLongJPY 40   card growth 20.0px
  ```
- **Worse than the entry recorded, in one specific way.** The entry framed this as a large-figure-currency problem ("JPY especially"). It is not: the hero grew 20px with the **real seeded USD line** `$9,085.00 planned of $16,400.00`, which wraps at a 222px slot. No exotic currency is needed to reach it.
- **The wrap is bounded at two lines, measured rather than assumed.** Slot height per slot WIDTH at 13px IBM Plex Mono (what `DataText size="sm"` actually resolves to — not 14px):
  ```
  slot width                            180 222 246 260 277 301+
  "$9,085.00 planned of $16,400.00"      40  40  20  20  20  20
  "¥1,234,567 planned of ¥5,000,000"     40  40  40  20  20  20
  "¥12,345,678 planned of ¥50,000,000"   40  40  40  40  20  20
  ```
  Nothing reaches three lines even at a 180px slot, far narrower than any reachable card — so `min-h-10` bounds the slot at every real width, not merely at the ones measured.
- **Fix (2026-08-29):** candidate **(2)** from this entry — reserve two lines at narrow widths, one where the slot is provably wide enough. `min-h-10 md:min-h-5` in TripCard, `min-h-10 sm:min-h-5` in NextTripHero.
- **The two breakpoints differ on purpose, and the first attempt got this wrong.** A trip card's slot does NOT widen monotonically with the viewport, because its grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — every extra column makes each card narrower again:
  ```
  viewport   341  500  640  1024  1440
  card slot   246  426  263   290   322
                        ^ sm: 2 cols   ^ lg: 3 cols
  ```
  So the slot is narrower at 640px (263) than at 500px (426). Shipping `sm:min-h-5` reintroduced the defect in a ~640-670px band — **caught by measuring the fix rather than by reading it**, and closed by moving that one component to `md`. The hero has no such band (222px at 341, 402px at 500, 542px at 640), so `sm` is correct there.
- **Verified after the fix, same method, six widths:** card growth **0.0px** for the real USD line, the entry's JPY line and a larger JPY line at **341, 500, 640, 768, 1024 and 1440px**, for both the hero and the card. 1440px is byte-identical to before (hero slot 523px, one line reserved), so desktop is untouched.
- **Accepted cost, stated rather than discovered later:** below the breakpoint the slot keeps 20px of blank space even when the line is short or absent. That is this candidate's known price. Candidate (1) `truncate` would render `planned of ¥5,00…` and hide the budget on the screens least able to recover it; candidate (3) (shortening the string in `lib/cost.ts`) is a product-visible choice about how money reads, and was deliberately left to be chosen rather than defaulted into. Per KI-46 there is no designed card below ~1100px yet, so the blank space sits where design will revisit it anyway.
- **Regression cover, added here rather than deferred.** `responsive.spec.ts` gains three narrow-viewport guards — the card at **320px** and **640px**, the hero at **360px** — each injecting a long money figure into the real rendered slot and asserting the surface's height does not move. **All three were confirmed RED against a deliberately reverted build (20.19px of growth each)**, which is the only reason they can be claimed as guards. Earlier drafts at 500px, 700px and 360px-for-the-card all PASSED against that same broken build — the slot is simply wide enough there — and were dropped for it; the widths that matter come from the measured slot-width table, not from the breakpoints. `m8-make-it-real.spec.ts`'s KI-28 guard at 1280px continues to pass.
- **Cross-reference:** KI-28 (resolved — this was the residue outside its measured bound), KI-46 (below ~1100px is undesigned).
- **First noted:** 2026-08-28 (KI sweep, PR #73 review). **Resolved:** 2026-08-29 (KI cluster).
