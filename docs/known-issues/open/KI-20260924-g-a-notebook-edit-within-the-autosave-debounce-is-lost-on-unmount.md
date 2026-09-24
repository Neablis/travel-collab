### KI-2026-09-24-g — a notebook edit made less than ~800ms before a reload or navigation is silently lost

- **Severity:** correctness (data loss, no error surfaced) — narrow window, but
  it is the user's own typing, on phone and desktop.
- **Milestone:** **M14, carried (assigned 2026-09-24, KI pass)** — the
  notebook editor is M14's surface. Not a gate box.
- **Area:** `apps/web/src/components/pages/PageScreen.tsx` (the 800ms debounced
  `saveContentRef` autosave, and its unmount cleanup
  `useEffect(() => () => saveContentRef.current.cancel(), [])`).
- **Symptom / What happens:** an edit schedules a save 800ms later. Unmounting
  `PageScreen` — client navigation away, or the component being torn down —
  **cancels** that pending save instead of flushing it, and a hard reload kills
  the timer outright. So the last edit made inside the debounce window never
  reaches the server, and nothing tells the user. Found by the KI-2026-09-15-b
  fixer: its e2e spec reloaded while the insert's own save was still pending,
  and the bound widget was gone after the reload.
- **Why not fixed here:** out of that fix's scope (the flake's cause was a
  stray save on mode switch, fixed in `PageEditor`). The fix wants a decision:
  flush on unmount (cheap, covers client navigation) plus a `pagehide` /
  `visibilitychange` flush via `fetch(..., { keepalive: true })` or
  `navigator.sendBeacon` for a real reload, and whether an unsaved-changes
  prompt is wanted at all.
- **Cross-reference:** KI-5 (the same class for board commands — the optimistic
  send queue lost on abrupt navigation), `resolved/KI-20260915-b-…`.
- **First noted:** 2026-09-24, KI pass.
