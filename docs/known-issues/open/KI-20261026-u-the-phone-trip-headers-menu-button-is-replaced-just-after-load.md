### KI-2026-10-26-u — The phone trip header's `⋯` button is replaced just after load, dropping its focus or open menu

- **Severity:** cosmetic, low reach. Only in the first moments after a trip page loads on a phone:
  a keyboard user who has already reached `⋯` loses focus to `<body>`, and a menu already open
  vanishes. A second try works.
- **Area:** `apps/web/src/components/trip/TripHeader.tsx` (`overflowMenu`, rendered by
  `{!isPhone && overflowMenu}` and, on a phone, as History's `Popover` `anchor`), with
  `useIsPhone` (`apps/web/src/lib/useIsPhone.ts`), which starts `false` and corrects in an effect.
- **Symptom / What happens:** at a phone width the first render places `overflowMenu` in the
  desktop slot; when `isPhone` turns true it moves into the popover's anchor, a different place
  in the tree, so React unmounts the `Menu` and its button and mounts new ones. Measured on PR 594
  (M54 part 1) at 76889d5 with a focus/mutation log: the focused `Trip actions` button got a
  `focusout` (relatedTarget null) from a React commit 10 to 300 ms after load, and in the run where
  the menu was already open, the menu node was removed although its exit was frozen. That made
  `m54-motion.spec.ts`'s keyboard menu test fail 1 in 10, and 4 in 20 under the extra logging.
- **Why not fixed here:** `TripHeader.tsx` is outside M54 part 1's scope. The spec now waits for
  the phone row to settle (`phoneHeaderSettled`) before it touches `⋯`, which took the rate to 0.
- **Fix path / Tripwire:** render `overflowMenu` in one place at every width and give the
  popover a `virtualRef` anchor (or an anchor element that wraps the same node), so `isPhone`
  never moves the button. Tripwire: drop `phoneHeaderSettled` from the two menu tests in
  `m54-motion.spec.ts` and run them `--repeat-each=20`; they stay green once this is fixed.
- **Cross-reference:** M54 part 1, PR 594; M39 D6 (the phone row's `⋯`).
- **First noted:** 2026-10-26, root-causing PR 594's flaky menu focus test.
