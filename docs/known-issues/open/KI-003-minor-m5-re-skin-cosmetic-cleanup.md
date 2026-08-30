### KI-3 — Minor M5 re-skin cosmetic/cleanup notes
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Collected small findings from the Wave-1/Wave-2 reviews:
  - ~~Trip "currency" field label renders lowercase~~ — **FIXED** (Task 19,
    2026-08-09): `TripMoneySettings.tsx`'s `FormField` label and the
    `NativeSelect`'s `aria-label` both now read "Currency".
  - ~~Sign-in link (Track A) is a real `<a>` styled as a secondary button but
    missing the focus-ring / `cursor-pointer` a real `Button` has~~ — **FIXED**
    (Task 19, 2026-08-09): both sign-in links (`app/page.tsx` and
    `board/TripBoardScreen.tsx`, the latter previously fully unstyled) now
    reuse `buttonVariants({ variant: "secondary" })` from
    `components/ui/button.tsx` instead of a hand-rolled/missing className, so
    they get the same focus ring and `cursor-pointer` a real `Button` has.
  - `text-danger-ink` used as a raw utility instead of a `Text` variant —
    **RE-DEFERRED** (Task 19, 2026-08-09): re-checked against the current
    (post-M10-restyle) tree and this is no longer "a couple of places" — it's
    now used in 10+ files (`form-field.tsx`, `banner.tsx`, `badge.tsx`,
    `NextTripHero.tsx`, `PlaybooksStrip.tsx`, `LocationInput.tsx`,
    `ActivityEditor.tsx`, `PlaybookCard.tsx`, `KeepDayFlag.tsx`,
    `EmptyChip.tsx`, `TimelineLens.tsx`, `app/page.tsx`), mostly as static
    `Record<AccentFamily, string>` tone-lookup tables — a legitimate,
    repo-wide convention for accent/tone lookups now, not a stray
    inconsistency. Centralizing it into a `Text` variant would be a
    cross-cutting refactor of 10+ files, out of proportion to a cosmetic nit.
    Left open; revisit if a `Text`-variant-based tone system is designed
    deliberately rather than as a side effect of this cleanup.
  - ~~`Board.tsx` carries an unspecified `items-start` on its flex layout~~ —
    **CLOSED BY RESTYLE** (Task 19, 2026-08-09): Task 11's M10 restyle
    rewrote `Board.tsx`'s flex layout; `items-start` no longer appears
    anywhere in the file.
  - ~~Near-duplicate link-button `className` strings across 3 lens files
    (DRY)~~ — **CLOSED BY RESTYLE** (Task 19, 2026-08-09): the M10 restyle
    removed every `<Link>` from `apps/web/src/components/lenses/*.tsx`
    (confirmed via grep) — the surface this applied to no longer exists.
- **First noted:** 2026-07-11/12 (M5 Wave 1/2). **Partially resolved:**
  2026-08-09 (Task 19) — the `text-danger-ink` bullet stays open by
  deliberate re-defer; everything else above is fixed or closed by restyle.
