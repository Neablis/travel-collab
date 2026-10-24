### KI-2026-10-19-g — Share's "Copied" is not announced to screen readers — RESOLVED

- **Severity:** cosmetic (accessibility). A sighted user sees the confirmation; a screen-reader
  user hears nothing after pressing *Copy share link*.
- **Area:** `apps/web/src/components/trip/ShareButton.tsx:160-167`: the button carries a fixed
  `aria-label="Copy share link"`, and its visible text swaps to "Copied". Compare
  `apps/web/src/components/account/ReferralNudge.tsx:36`, which puts its status in a
  `role="status"` region.
- **Symptom / What happens:** press *Copy share link* with a screen reader on. The visible text
  reads "Copied"; the accessible name stays "Copy share link" and no live region speaks.
- **Why not fixed here:** found during M50 part 8 (PR 498), which added the nudge beside it; not part 8's change, and the close
  is prose-only.
- **Fix direction:** add a `role="status"` region (as `ReferralNudge` does) that says "Link
  copied" after a successful copy, or drop the fixed `aria-label` so the name follows the text.
  Test: assert the status text with `getByRole("status")`, seen red first.
- **Cross-reference:** M50 part 8 (PR 498).
- **First noted:** 2026-10-19, during M50 part 8 (PR 498).
- **Proof (resolved 2026-10-24, KI sweep):** `ShareButton.tsx` now mounts an empty
  `role="status"` region in the share panel, as `ReferralNudge` does; a copy fills it with
  "Link copied.", a refused clipboard with "Couldn't copy it. The link is in the box below." The
  button keeps its stable `aria-label`. Reproduced first: the new `ShareButton.test.tsx` case
  *announces a successful copy in a status region* failed on the old code with `Unable to find an
  accessible element with the role "status"`. With the region's contents disabled, it and the
  extended *reveals the link… when the clipboard is denied* failed with `expected '' to be 'Link
  copied.'`; both pass with the fix (14/14).
