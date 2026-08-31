### KI-20260831 — Publishing your own day tells you someone else changed it
- **Severity:** cleanup (no data is wrong; the app reports a change to the person who made it)
- **Area:** `apps/web/src/components/playbooks/SharedDayScreen.tsx`, `apps/web/src/components/playbooks/useLibraryRead.ts`

- **What happens (2026-08-31, found while fixing pull request 102's review):**
  publish or withdraw your own saved day from the shared-day route and the
  screen answers with the external-change banner — *"its author published,
  withdrew or someone took it"* — about the button you just pressed.

- **Mechanism.** `setVisibility()` calls `feed.reload()` on success.
  `useLibraryRead`'s signature for this screen is `${visibility}:${adds}`, and
  `reload()` deliberately KEEPS its baseline so that a same-query re-read can
  still detect a genuine external change. Publishing changes `visibility`, so
  the comparison fires. Both halves are behaving as designed; the gap is that
  the hook cannot tell a **self-initiated** reload from a polling one.

- **Same species as the filter-change bug fixed on pull request 102**, and found
  by the same review. That one was a *query* change misread as a library
  change; this one is a *self-inflicted* change misread the same way. The fix
  there — resetting the baseline when `read` changes identity — does not reach
  this, because `reload()` does not change `read`, and must not: that is what
  makes the banner work at all.

- **Fix path — needs a hook API decision, which is why it is filed rather than
  fixed.** `useLibraryRead` needs a way to say "this reload is mine, do not
  compare": a `reload({ silent: true })` option, a separate
  `refreshWithoutComparing()`, or having the caller re-baseline explicitly
  after a write it initiated. All three change a shared hook used by three
  screens, so it is not a review-round fix. Whichever is chosen needs a test
  that a **genuine** external change still raises the banner afterwards —
  otherwise the fix silently disables the feature.

- **Not the same as:** Discover's `LibraryMoved`, which after pull request 102 is
  **unreachable** rather than wrong — Discover re-reads only when the query
  changes. The component is kept there deliberately (it is the shared
  project-rule-6 pair, and deleting a designed state is a gate conversation),
  and its test pins that behaviour. Do not conflate "unreachable" with "broken".
