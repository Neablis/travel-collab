### KI-2026-09-24-g — a notebook edit made less than ~800ms before a reload or navigation is silently lost

- **Resolved 2026-09-24 (M14 T14, link 9).** The 800ms debounce is gone with ADR-036's one clock, and `lib/debounce.ts` with it. `useEditSession` holds the edit session's one pending document and **commits** it on unmount and on `pagehide`, where the debounce was **cancelled** on unmount. The `pagehide` commit is sent with `fetch(..., { keepalive: true })`, so it outlives a reload or a closed tab; a body over the spec's 64 KiB `keepalive` cap goes without it. It also commits on leaving Editing and after 60s idle. No unsaved-changes prompt was added. **Proof:** `useEditSession.test.tsx`, *"commits on unmount rather than dropping the edit"*: with the cleanup's `settle(false)` deleted (`pnpm redfirst`), it fails at line 55 (`- Expected [[doc, { keepalive: false }]] + Received []`). *"commits on pagehide, with keepalive"*: with the listener made a no-op, it fails at line 65 (`- "keepalive": true + "keepalive": false`, i.e. only the unmount caught it). One layer up, `PageScreen.test.tsx`'s *"keeps the last edit when the page is left mid-session"* inserts a widget and unmounts; with the same cleanup deleted it fails with `expected "vi.fn()" to be called 1 times, but got 0 times`. **Not proven in a browser:** no e2e reloads mid-session, because the `keepalive` PATCH and the reloaded page's GET race by design. The specs that reload now leave Editing first. **Checks:** web unit `src/components/pages` + `src/lib` (613/613), `pnpm --filter web test:int` (1001/1001), web typecheck and lint.

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
