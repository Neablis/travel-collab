### KI-2026-09-24-j — tablets (768–1100px) get the desktop layout with mouse-sized controls, and the Ask button covers stop costs

- **Severity:** usability on tablets — works, but built for a mouse.
- **Area:** the `md:min-h-0` switches that turn SPEC §13.1's 44px floor off at 768px (`apps/web/src/components/ui/*`, board and lens controls), the floating Ask button and the docked assistant rail (`apps/web/src/components/assistant/`), `apps/web/src/components/board/Board.tsx`.
- **Symptom / What happens:** measured 2026-09-24 at 820×1180 and 1024×768: on Plan 244 of 287 controls are under 32px (account menu 30×30, lens tabs ~26px tall, stop Edit/Remove ~28px, quick-ask buttons ~20px); the floating Ask button sits over the right-hand stop column's costs; with Ask docked at 820 the board gets ~440px (one and a half columns); at 1024×768 only ~220px of board shows above the fold.
- **Why not fixed here:** a breakpoint/design decision (does a touch tablet keep the 44px floor, and what does the tablet board look like) rather than a bug fix. KI-46 framed "≥1100px is fine" and never looked at this band.
- **Cross-reference:** KI-46, `m26-phone-targets.spec.ts` (the phone floor, which this band skips), screenshots `06-plan-fold-1024.png`, `10-ask-820.png` from the check.
- **First noted:** 2026-09-24, mobile check.
