# Known issues & tech debt

Durable register of **known-but-unfixed** problems and deferred cleanups, so
findings survive past the PR / session ledger that first surfaced them. Add a
row when you knowingly leave something unfixed; remove it (in the fixing PR)
when it's resolved. This is not the roadmap (`TODO.md`) and not a bug tracker —
it's the standing record of things we know about and have chosen not to fix
yet, with enough detail to act without re-deriving.

Severity: **correctness** (wrong behavior / failing invariant) ·
**reliability** (flaky / intermittent) · **cosmetic** (visual / copy) ·
**cleanup** (refactor / DRY, no user impact).

## Open

### KI-1 — `diffTripStates` round-trip property test is intermittently failing
- **Severity:** reliability (possibly correctness — unconfirmed)
- **Area:** `packages/domain` · `packages/domain/test/diff.property.test.ts`
  ("diffTripStates round-trip — THE M2 invariant")
- **Symptom:** fails ~1-in-5 runs. It's a `fast-check` property test (300
  runs, **no fixed seed**), so each run explores different inputs; the failure
  reproduces **deterministically** when re-run with its own reported seed —
  i.e. a genuine counterexample, not load/timing flake.
- **Scope:** **pre-existing**, predates M5. Confirmed by diffing this branch's
  `packages/domain` against `origin/main` (zero diff) and reproducing the same
  intermittent failure against a pristine `origin/main` worktree.
- **Open question:** is the M2 round-trip invariant (`applyDiff(a,
  diff(a,b)) == b`) actually violated for some trip-state shape, or is the
  test's generator producing states the invariant was never meant to cover?
  Either way it needs a dedicated domain-package investigation (out of scope
  for the UI-only M5 work that surfaced it).
- **First noted:** 2026-07-12 (M5 Wave-2 integration). **Repro:** run
  `pnpm --filter @tc/domain test` a handful of times, or capture a failing
  seed and pin it.

### KI-2 — Money formatting differs between UI and domain conflict text
- **Severity:** cosmetic
- **Area:** `apps/web/src/components/lenses/formatMoney.ts` vs. the domain's
  `fmt` in `packages/domain/src/trip/conflicts.ts`
- **Symptom:** the UI groups thousands (`1,111,106.00 USD`, added in M5 Wave-3
  for comment #22), but the **over-budget conflict banner text is generated in
  `packages/domain`** and stays ungrouped, so the same amount can render two
  ways. Accepted knowingly: `packages/domain` was off-limits to that UI-only
  wave. **Fix path:** when a domain change is next in scope, group `fmt` to
  match (or move money formatting to a shared contracts-level helper).
- **First noted:** 2026-07-13 (M5 Wave-3).

### KI-3 — Minor M5 re-skin cosmetic/cleanup notes
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Collected small findings from the Wave-1/Wave-2 reviews, none blocking:
  - Trip "currency" field label renders lowercase — pre-existing copy, not a
    re-skin change; reads as a raw word, not "you're setting the trip budget".
  - Sign-in link (Track A) is a real `<a>` styled as a secondary button but
    missing the focus-ring / `cursor-pointer` a real `Button` has.
  - `text-danger-ink` used as a raw utility in a couple of places instead of a
    `Text` variant.
  - `Board.tsx` carries an unspecified `items-start` on its flex layout.
  - Near-duplicate link-button `className` strings across 3 lens files (DRY).
- **First noted:** 2026-07-11/12 (M5 Wave 1/2).

### KI-4 — Minor M5 Wave-3 cosmetic/dead-code notes
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Non-blocking findings from the Wave-3 per-task + final whole-branch reviews
  (all shipped as-is by decision — no wrong behavior reachable by a user):
  - `board/Column.tsx` — the `sectionRef` prop is now dead (its only caller,
    the removed day-pager `scrollToDay`, is gone); safe to delete the prop,
    its type, and the `ref={sectionRef}` wiring in a cleanup pass.
  - `lenses/MapLens.tsx` — the `grow` class on `.map-lens-canvas` is inert (no
    flex/bounded-height ancestor); the `minHeight`/`height: 70vh` inline styles
    do the sizing. Harmless dead class.
  - `lenses/TimelineLens.tsx` — the hour-gridline `<div>`s lack
    `pointer-events-none`; non-blocking today (buttons paint on top), but worth
    adding before any click-to-create-at-time affordance lands on the bar.
  - `lenses/TimelineLens.tsx` — axis tick labels are left-aligned at their
    `left:%`, so the last label ("9p") can clip against the row's right edge at
    narrow widths (centering needs an inline `translateX(-50%)`, which is
    allowed under the geometry inline-style exception).
  - `ui/segmented-control.tsx` — a redundant `gap-0.5` base class is overridden
    in the subtle variant (cosmetic).
- **First noted:** 2026-07-13 (M5 Wave 3).

### KI-5 — Optimistic commands can be silently lost on abrupt navigation before the send queue drains
- **Severity:** correctness (data loss, no error surfaced)
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` /
  `optimistic.ts` (M6's optimistic-update overlay + sequential send queue)
- **Symptom:** every trip-mutating command now applies to the UI instantly
  (client-side prediction) while the real persist happens in the background,
  one command at a time. If the user (or a script) fires several commands in
  quick succession and then navigates away, reloads, or closes the tab
  **before the queue has drained**, every command still queued behind the one
  currently in flight is silently dropped from the server's event log — with
  no error, no warning, and no visual difference from a fully-persisted state
  (the UI already showed everything as "done"). Root-caused by reproducing a
  CI-only e2e failure (`m2-history.spec.ts`, initially misdiagnosed as a
  narrower pre-existing reload/in-flight-request race — see below): throttling
  the commands endpoint by 400ms and replaying the spec's rapid drag+dismiss
  sequence deterministically reproduced the loss — after `page.reload()`, the
  persisted history contained **only the very first command** of six; the
  other five (two `AddActivity`, two `MoveActivity`, one `DismissConflict`)
  never reached the server at all.
- **Not a data-integrity violation of the event log itself** (Invariant 1
  holds — nothing partially-written, nothing corrupted; commands that never
  arrive simply never get an event) but is a real UX/correctness gap: the
  optimistic overlay gives no user-visible signal that unconfirmed work exists
  before a destructive-to-in-memory-state action (navigation, reload, tab
  close), unlike e.g. a native app's "unsaved changes" prompt.
- **The e2e test symptom is fixed** in this same change
  (`apps/web/e2e/m2-history.spec.ts` now waits for each mutating action's
  confirming response before proceeding, matching the pattern already used in
  `m6-optimistic.spec.ts`), so the CI flake itself is resolved. This entry
  tracks the underlying **product** risk, which is not fixed.
- **Fix path (not yet built):** a `beforeunload` warning while `pending` is
  true, and/or blocking/queuing navigation until the send queue drains, and/or
  a `navigator.sendBeacon`-based best-effort flush on unload. Worth deciding
  alongside M8 (collaboration), where concurrent multi-actor writes make
  silent client-side loss more consequential.
- **First noted:** 2026-07-20 (M6, post-merge CI investigation).

## Deferred design work (tracked elsewhere, pointer only)

Not bugs — design decisions awaiting a brainstorm, so they live with the
feedback that raised them, not here:

- **M5 PR #11 Group-4 comments** (Map-lens rework, Schedule nested toggle,
  Timeline time-of-day axis, header cost-vs-budget clarity, full-width
  perception): `docs/design-feedback/2026-07-13-pr11-wave2-vercel-comments.md`.
