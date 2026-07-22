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
- **Fix path (not yet built; Mitchell's direction, 2026-07-20):** favor a
  synced/caught-up UI indicator over blocking navigation — surface `pending`
  (already exposed on `useTrip()`) as a visible "syncing…" / "all changes
  saved" affordance so the user can SEE when it's safe to navigate away,
  rather than a `beforeunload` prompt or forced queue flush. Worth deciding
  alongside M8 (collaboration), where concurrent multi-actor writes make
  silent client-side loss more consequential.
- **First noted:** 2026-07-20 (M6, post-merge CI investigation).

### KI-6 — `listPages` lazy-instantiation race on concurrent first visits
- **Severity:** correctness (non-atomicity), low likelihood
- **Area:** `apps/web/src/server/pages.ts` (`listPages`'s zero-rows guard
  that seeds a trip's default pages on first Notebook visit)
- **Symptom:** `listPages` seeds default pages (Trip Overview, Day Sheet)
  the first time it sees zero rows for a trip. Two concurrent first-visit
  requests (e.g. two tabs opened at once, or a double-fetch) can each
  observe zero rows before either has inserted, and both seed — producing
  duplicate default pages for the same trip.
- **Scope:** known and accepted at the point of writing `pages.ts` (Task
  3.2); the brief that specified `listPages` explicitly scoped a fix out
  ("a later task could add a unique partial index; out of scope now").
- **Fix path:** a unique partial index on `pages (tripId, title)` (or
  similar) scoped to system-seeded rows, or a transactional
  check-then-insert, would close the race.
- **First noted:** 2026-07-21 (M7 Task 3.2 / gate-close).

### KI-7 — `ai` / `@ai-sdk/gateway` provider-type version skew (V1 vs V2) — RESOLVED
- **Severity:** was assumed type-level only; turned out to be a genuine
  runtime incompatibility (see Correction below).
- **Area:** `apps/web/src/server/ai/handleAiRequest.ts` (`aiModel()` call
  site) — corrects the original entry's `route.ts` reference; the handler
  moved to its own module in a later fix (Next.js route-export rule).
- **Symptom:** the installed `@ai-sdk/gateway` resolved to `1.0.41`, built
  against `@ai-sdk/provider`'s `LanguageModelV2`, while the repo pinned
  `"ai": "^4.0.0"`, whose `LanguageModel`/`generateText` types are `V1`.
  `aiModel()`'s return type didn't structurally satisfy `LanguageModel` per
  TypeScript, bridged at the time with a documented cast.
- **Correction (2026-07-21, after a live call was made):** this was NOT
  type-level only. `ai@4`'s `generateText` checks a model's
  `specificationVersion` at runtime and throws `"Unsupported model version.
  AI SDK 4 only supports models that implement specification version 'v1'.
  Please upgrade to AI SDK 5 to use this model."` — the cast satisfied the
  compiler but not the actual runtime check, so every real (non-mocked) call
  through this path would have failed with a 422. Confirmed against npm:
  every published `@ai-sdk/gateway` version since its first 1.0.0 stable
  release targets the V2+ spec — there was no V1-compatible gateway version
  to pin to instead.
- **Fix:** upgraded straight to latest (`ai@^7.0.34`,
  `@ai-sdk/gateway@^4.0.26`) rather than stopping at v5, since three real
  breaking-change generations (v5/v6/v7) existed and stopping partway would
  have deferred two more migrations. The cast is gone; `aiModel()`'s return
  type now satisfies `LanguageModel` directly (both packages build against
  the same `@ai-sdk/provider@4.0.3`).
- **First noted:** 2026-07-21 (M7 Task 5.5 / gate-close). **Resolved:**
  2026-07-21 (AI SDK v4→v7 upgrade, post-merge PR fix).

## Deferred design work (tracked elsewhere, pointer only)

Not bugs — design decisions awaiting a brainstorm, so they live with the
feedback that raised them, not here:

- **M5 PR #11 Group-4 comments** (Map-lens rework, Schedule nested toggle,
  Timeline time-of-day axis, header cost-vs-budget clarity, full-width
  perception): `docs/design-feedback/2026-07-13-pr11-wave2-vercel-comments.md`.
