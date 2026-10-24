### KI-2026-10-09-d — the full-screen phone form of `.assistant-rail` never renders — RESOLVED

- **Severity:** cleanup. Dead CSS that reads as live.
- **Area:** `apps/web/src/app/globals.css`, the `.assistant-rail` `max-width: 767px` block
  (~:1283-1300, `inset: 0`, now with M39 Part 7's safe-area padding).
- **Symptom:** after hydration every phone surface opens Ask as the `sheet` presentation
  (`.assistant-sheet`), so the full-screen rail form below 768px is never mounted. M39 Part 7
  inset it anyway and could only prove that with a probe element, not a real panel.
- **Why not fixed here:** confirming that no path (first paint, the demo, a notebook page) still
  mounts it takes a careful read, and deleting it was outside Part 7's scope.
- **Fix direction:** find every `presentation` value that can reach `AssistantRail` below
  768px, including before hydration. If none mounts the rail, delete the block and its probe
  assertion in `e2e/m39-installable.spec.ts`.
- **First noted:** 2026-10-09, M39 Part 7.
- **Proof (resolved 2026-10-24, KI sweep):** the read the entry asked for found no path. Only
  `presentation="docked"` draws `.assistant-rail` (`AssistantRail.tsx`'s class switch, and
  `AssistantRailSkeleton`, the board's Suspense fallback for docked only). The callers:
  `TripBoardScreen` gives `isPhone || isTabletWidth ? "sheet" : shape`, and its rail mounts
  only while `useAssistantVisibility`'s `open` is true. That is `useState(false)` with no
  restore, so it opens only on a click, after hydration, when `useIsPhone` has settled.
  `BeyondTripAssistant` (Home) gives `docks ? "docked" : "sheet"` from `useDocksAssistant()`,
  a `useSyncExternalStore` read that is right on its first client render, and also mounts only
  once opened. Its playbook form gives `phone ? "sheet" : "floating"`. `PageScreen` and
  `NotebookScreen` never give `docked`. The only moment left is one commit while a window
  already showing the docked rail is dragged below 768px, before `useIsPhone`'s effect turns it
  into the sheet. So the `max-width: 767px` block was deleted from `globals.css`, with the probe
  assertion in `e2e/m39-installable.spec.ts` that was its only reader. Its two lessons, `dvh`
  and the 30 tier, are already on `.assistant-sheet`. The comments that cited it are updated:
  `globals.css`, `PhoneTabBar.tsx` (its z-20 reason, now given against the sheet), `button.tsx`,
  `useIsPhone.ts`, `phoneTouch.test.tsx`, `TripHeader.test.tsx`. Dead code has no red to show,
  so the proof is that nothing that runs changed: `pnpm --filter web test:e2e:ci-like
  e2e/m26-phone-surfaces.spec.ts e2e/m39-installable.spec.ts e2e/m12-discover.spec.ts`,
  `32 passed`, no retries, including *Ask's sheet keeps its composer above the home indicator*
  and the docked rail cases.
