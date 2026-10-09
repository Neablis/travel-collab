### KI-2026-10-09-d — the full-screen phone form of `.assistant-rail` never renders

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
