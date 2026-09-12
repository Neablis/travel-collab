### KI-2026-09-05-b — the Reading/Editing toggle is unreachable without scrolling a long page — RESOLVED

- **Severity:** defect (UX). On a notebook longer than the viewport the only way to stop
  editing is to scroll back to the top, which is the wrong end of the page from wherever
  the author just finished typing.
- **Area:** `apps/web/src/components/pages/PageScreen.tsx` — the header row holding
  "Done editing" / "Edit page", and its spacing against the app's top bar.
- **What is wrong:** two things, reported together. The control sits flush against the
  top bar with no separating space, so it reads as part of the chrome rather than as part
  of the page; and it is pinned to the top of a scrolling document, so on a long page it
  leaves the viewport entirely and the mode cannot be changed from where the reader is.
- **Reported:** Mitchell, on the PR 141 preview (2026-09-04): *"Done editing shouldnt be
  up against top bar, it should also be togglable on a large page without having to
  scroll up and down."*
- **Why it is filed rather than fixed here:** the spacing half is a one-line change and
  the reachability half is not — it is a decision about what persists as the page
  scrolls, and SPEC §13.5 is explicit that **nothing floats over data and there is no
  floating action button**, which rules out the obvious answer. The candidates are a
  sticky page header (which costs vertical space on a phone, where §19 is already tight),
  or promoting the toggle into the app's top bar when a notebook is open (which makes a
  page-scoped mode live in global chrome). Neither is a change to make silently inside a
  PR about the widget vocabulary.
- **Fix path:** settle it against §13.5 and §19 — most likely a sticky page header on
  desktop with the phone keeping today's placement — then fix the spacing in the same
  pass. Wants an e2e assertion that the toggle is operable after scrolling to the bottom
  of a long page, which is the half a visual fix will not otherwise cover.
- **Cross-reference:** `.design-sync/handoff/SPEC.md` §13.5 and §19, Vercel toolbar thread
  `Ob2rk7o2oJa-`.
- **First noted:** 2026-09-04, on the PR 141 preview.

- **Resolved 2026-09-12.** The spacing half was already closed by the 2026-09-06 UI
  feedback round (PR #149, `mt-3` on the row — the comment still on that line). What
  remained was reachability, settled per this entry's own fix path: `md:sticky md:top-14`
  on the toggle row in `PageScreen.tsx`, pinned directly under `AppHeader` (which is
  itself `sticky top-0 h-14`) so the two bars stack rather than overlap. Below `md`
  (768px, the same breakpoint `useIsPhone` already draws) the row stays in normal flow,
  exactly as §19's phone Notebook describes and §13.5 requires (no floating control) —
  the "sticky page header on desktop, phone keeps today's placement" branch this entry
  named as most likely. The row's `mt-3 mb-3` MARGIN — which sits outside a sticky
  element's own painted box — is swapped for `md:my-0 md:py-3` PADDING at the same
  breakpoint plus `md:bg-paper`, so the pinned bar has an opaque background of its own
  and the document does not show through the seam while scrolling under it. No change
  to `globals.css` or to any widget-chrome file.
  - **Reproduced first**, via `@playwright/test`'s `chromium` driven directly against a
    real `next start` build (the `@playwright/test` CLI itself cannot select a single
    spec/grep in this environment — see the finding below): a 60-paragraph page, opened
    in Editing, scrolled to the bottom. Before the fix: `toggle boundingBox: { x:
    1067.14, y: -1270, width: 108.86, height: 36 }` against a 900px-tall viewport —
    1270px above the fold — `TOGGLE_IN_VIEWPORT_AFTER_SCROLL: false`. After the fix, same
    script, same page: `{ x: 1067.14, y: 68, ... }`, `TOGGLE_IN_VIEWPORT_AFTER_SCROLL:
    true`.
  - **Regression test added:** `apps/web/e2e/m14-notebook-widgets.spec.ts` — "the mode
    toggle stays reachable after scrolling to the bottom of a long page
    (KI-2026-09-05-b)". Builds a page directly against `PageDoc`'s shape (60 paragraphs)
    via the pages API, scrolls to the bottom in Editing, and asserts
    `toBeInViewport()` on "Done editing". It runs at the desktop viewport (1280×900, the
    suite's default project) where the sticky behaviour applies.
  - **Checks run:** `pnpm --filter web typecheck`, `pnpm --filter web lint`,
    `node scripts/check-color-wall.mjs` (new Tailwind color utility, `bg-paper` — already
    an established token), and `pnpm --filter web exec vitest run -c vitest.unit.config.ts
    src/components/pages/PageScreen.test.tsx` (26 passed, unchanged) — the narrowest
    subset covering both changed files, per `AGENTS.md`/the contracts exception not
    applying here.
  - **Left alone, and worth another entry:** in this environment, the
    `@playwright/test` CLI throws `Playwright Test did not expect test() to be called
    here` and then `No tests found` whenever ANY test selection filter is used (`-g`,
    a `file:line` target, or a lone `test.only`) — reproduced on entirely unmodified
    spec files (`m1-board.spec.ts`, plus every other file in the suite once one file's
    local match count is zero), while a filter-free invocation runs the whole 106-test
    suite normally. Not filed here (out of this entry's blast radius); the next KI sweep
    or the run's own board should pick it up.
