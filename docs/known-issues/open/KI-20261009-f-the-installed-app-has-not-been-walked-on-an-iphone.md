### KI-2026-10-09-f — the installed app has not been walked on a real iPhone

- **Severity:** unverified. Nothing is known to be broken; the iPhone install path has simply
  never been tried on a device.
- **Area:** the PWA install on iOS Safari: `apps/web/src/app/manifest.ts`, `public/sw.js`, the
  root layout's `viewport` (`cover` and the safe-area insets), and the *Install app* steps sheet
  in `components/install/InstallApp.tsx`.
- **Symptom:** none observed. M39's gate asked for an install to a real iPhone and a real Android
  home screen, with sign-in, an emailed invite link and long-press drag walked on each. Only the
  Android half was walked (Mitchell's Pixel, 2026-10-09; all three worked). There was no iPhone.
- **What to walk:**
  1. Safari → Share → *Add to Home Screen*. The icon should be the two-stroke caesura.
  2. Check that the steps sheet's wording still matches Safari. It says *Tap Share in Safari's
     toolbar*, and on iOS 26 the compact tab bar may put Share behind the "•••" menu.
  3. In the installed app, sign in. Open an emailed invite link and note whether it opens in the
     installed app or in Safari, and whether it lands signed in on the trip.
  4. Long-press and drag a stop on the Plan board.
  5. Check that nothing sits under the notch or the home indicator: the header, sheets, toasts
     and the Unscheduled rack.
- **Why not fixed here:** no iPhone was available at M39's gate close. Mitchell accepted the
  Android walk as enough to close the milestone.
- **First noted:** 2026-10-09, M39 gate close.
