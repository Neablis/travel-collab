### KI-2026-09-05-b — the Reading/Editing toggle is unreachable without scrolling a long page

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
