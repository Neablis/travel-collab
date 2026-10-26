### KI-2026-10-26-pm — the m17 clock test fails whenever its base-36 timestamp username holds "pm" — RESOLVED
- **Severity:** reliability (a time-of-day failure that is not the PR's: the
  same test went red on seven unrelated PRs at once)
- **Area:** `apps/web/e2e/m17-account-preferences.spec.ts` — *"account
  preferences: the board's clock follows the Time setting"*
- **Symptom / What happens:** `test / e2e (1/2)` failed on PRs 594, 595, 600,
  601, 605, 606 and 607 at once, all at the same line,
  `expect(card).not.toContainText("pm")` (`:168`), after the switch to 24-hour
  had worked (`:167`, `09:00 – 14:30`, passed). Every run that started
  between 18:47:48Z and 19:15:48Z on 2026-10-26 failed it. Re-running the
  failed jobs after that window is enough to clear it.
- **Cause:** the dev username was `m17t${Date.now().toString(36)}-…`. In that
  window `Date.now()` in base 36 runs from `mvplzzmo` to `mvpmzzxc`, which
  contains `pm`. The board card prints who added a stop (`RiverBlock.tsx`,
  "added by <name>"), so the username was inside the card. The assertion was
  meant to say "no 12-hour clock here", but it checked for the substring `pm`
  anywhere in the card. The same thing happens whenever two adjacent base-36
  digits read `pm` (or, for a check on `am`, `am`).
- **Fix (this PR):** both halves.
  1. The username is `m17t` plus 20 hex digits from `randomUUID()`, the same
     shape as the `freshUsername()` that `m11a-invite-gate.spec.ts`,
     `m49-cover-reposition.spec.ts` and `responsive.spec.ts` each declare.
     Hex has no `p` and no `m`, so it can never spell `pm` or `am`.
  2. The assertions are scoped to the time window, not the whole card. The
     window must be exactly `09:00 – 14:30`, and no 12-hour time
     (`<digit> am|pm`, with the space the 12-hour format prints) may appear
     on the card. A username has no space, so it can never match.
- **Proof:** red first, with the old assertion and a username hard-coded inside
  the window (`(1793041200000).toString(36)`, i.e. 19:00:00Z, `mvpmfog0`):
  `pnpm --filter web test:e2e:ci-like e2e/m17-account-preferences.spec.ts`
  failed at `:168`, both attempts: `Expected substring: not "pm"` /
  `Received string: "Tsukiji breakfast09:00 – 14:30m17tmvpmfog0-a8b2d001 added this"`.
  Then the scoped assertions went in with the same "pm" username still
  hard-coded, and the same command passed (3 passed). A temporary probe in that
  run, `expect(card.getByText(/\d (am|pm)\b/)).not.toHaveCount(0)` while the
  card was still 12-hour, also passed, so the new negative assertion does find
  a 12-hour time when there is one. The probe and the hard-code were then
  removed, and the final spec passed the same command again (3 passed).
  Checks: `eslint` on the spec, plus that ci-like run.
- **Other specs checked for the same shape** (a name built from
  `Date.now().toString(36)`, then a `not.toContainText` on a short word):
  - `m14-notebook-widgets.spec.ts` (`m14wx…`, `m14clk…`). The name is used only
    to sign in, and neither test negates text on a surface that shows it. Not
    at risk.
  - `m22-api-tokens.spec.ts` (`m22…`). No negative text assertion. Not at risk.
  - `m26-phone-surfaces.spec.ts` (`m26p…`, `m26s…`, `m26d…`). No negative text
    assertion. Not at risk. (They also have no random suffix, so two workers
    in the same millisecond would share an account. That is a separate
    matter, not this entry's.)
  - `m17-account-preferences.spec.ts`'s first test (`m17…`). It negates
    `/· \d+(\.\d)? km/`, which no username can match. Not at risk.

  None needed changing. The general rule: never assert the *absence* of a
  short word across a region that also renders a generated name. Scope the
  negation to the element the word would appear in.
- **Cross-reference:** `docs/guidelines/testing.md` §5 (finding vs asserting).
- **First noted:** 2026-10-26, seven M54 parts and siblings red on the same
  line within one half hour.
