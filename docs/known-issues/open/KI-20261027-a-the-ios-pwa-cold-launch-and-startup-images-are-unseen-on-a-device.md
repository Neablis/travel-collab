### KI-2026-10-27-a — The iOS home-screen cold launch and its startup images have never been seen on a device

- **Severity:** cosmetic, unverified. Nothing is known to be wrong; nothing has been seen either.
  If the hand-off is wrong, an iPhone user who launches the installed app sees a blank or
  mismatched frame between iOS's own splash and the page, which decision 6 of the motion spec
  forbids.
- **Area:** `apps/web/src/lib/welcomeCue.ts` (`LAUNCH_SCRIPT`, the standalone test on
  `navigator.standalone` and `display-mode: standalone`), `apps/web/src/app/layout.tsx` (the
  inline script at :137, `LaunchOverlay` at :150, the `apple-touch-startup-image` links),
  `apps/web/src/components/welcome/WelcomeMoment.tsx` (`LaunchOverlay`, `LAUNCH_FAILSAFE_MS`),
  `apps/web/public/icons/startup-*.png` (20 images).
- **Symptom / What happens:** M54 part 5 (PR 607) paints a launch overlay before first paint on a
  home-screen cold launch and links one iOS startup image per device size. The images are held
  by `layout.test.ts` and the launch path by `WelcomeMoment.test.tsx` (jsdom only). No one has
  installed the app on an iPhone and cold-launched it, so whether iOS picks the right image, and
  whether its splash hands off to the overlay with no blank frame, is unknown. Mitchell's walk of
  `main` at `e9a46b0f` (2026-10-27) was on Android, in the browser, not the installed app.
- **Why not fixed here:** there is nothing to fix until it is seen. Mitchell, 2026-10-27, about
  02:00Z, waiving it at M54's gate: *"I don't have a iPhone so I can't test"*.
- **Fix path / Tripwire:** the first time anyone with an iPhone installs the app, cold-launch it
  from the home screen in light and dark, at two device sizes, and note what shows between the
  tap and the page. Playwright cannot do this (no standalone display mode, no iOS splash).
- **Cross-reference:** M54's *Sign-in has its cheer* box (waived on this);
  `docs/specs/2026-10-25-motion-pass-design.md` decisions 4 and 6; ADR-082 §4.
- **First noted:** 2026-10-27, M54 gate close, PR 593.
