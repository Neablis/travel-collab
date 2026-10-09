### KI-2026-10-09-a — some pinned and fixed layers ignore the safe-area insets that `viewport-fit=cover` now exposes

- **Severity:** cosmetic, installed app only, and latent today. The top inset is
  non-zero mainly in an iOS standalone app with the `black-translucent`
  status-bar style. M39 Part 4 sets no `appleWebApp` metadata, so iOS keeps its
  default status bar. Landscape left/right insets are real on a notched phone.
- **Area:**
  - `apps/web/src/components/pages/PageScreen.tsx`: `md:sticky md:top-14`
    (~:1215) and `sticky top-29` (~:1499) still assume a 56px AppHeader.
  - `apps/web/src/components/front/PhoneFrontDoor.tsx` (~:365): `sticky top-0
    pt-6`, the top of `/` for a signed-out phone. Its stage's `pt-16` is sized
    to it, so the two change together.
  - The fixed layers: the Unscheduled rack, Ask's floating card, toasts, sheets
    and the phone's full-screen Ask (`.assistant-rail` `inset: 0`). Only the
    phone tab bar takes an inset (the bottom one).
  - Stale comments in `globals.css` (~:627, the widget rail) and PageScreen
    still describe AppHeader as `sticky top-0 h-14`.
- **Symptom:** with a non-zero top inset, AppHeader grows by the inset (M39 Part
  4, `--app-header-height`). The notebook editor's pinned bars, which hard-code
  `top-14`, tuck under it by the inset. The phone front door's header and the
  fixed layers draw under the status bar or notch.
- **Why not fixed here:** found by M39 Part 4's implementer and
  outside that part's scope, which was the manifest, the worker and the
  headers' insets. Each site needs its own look on a device, and the gate's
  real-device walk is where that happens.
- **Fix direction:** replace `top-14` / `top-29` with named rules in
  `globals.css` that offset by `--app-header-height` (the colour wall bans
  arbitrary values in a className, as `.below-app-header` already shows). Give
  the phone front door and the fixed layers
  `env(safe-area-inset-*)` padding the way `.phone-tab-bar` has the bottom one.
- **First noted:** 2026-10-09, M39 Part 4.
