### KI-2026-09-17-a — account settings has outgrown a side sheet and needs a page with tabs

- **Severity:** usability debt, and it compounds. Nothing is broken; the
  container is simply the wrong shape for what it now holds, and every
  milestone that adds an account-scoped capability makes it worse.
- **Area:** `apps/web/src/components/account/AccountSettingsSheet.tsx` and the
  three sections it stacks — `PlanSection.tsx`, `TokensSection.tsx`, and the
  identity/display fields it renders inline. Opened from the avatar menu in the
  header, on every route.
- **Symptom / What happens:** one scrolling `Sheet` now stacks four unrelated
  concerns in a single column:

  | Section | What it is | Size |
  |---|---|---|
  | Plan | tier, today's AI usage, referral code | 359 lines |
  | API tokens | mint, reveal once, list, revoke, eight scopes | 466 lines |
  | Identity | display name, home airport | inline |
  | Display | distance units | inline |

  That is ~1,100 lines of component behind one scrollport. Minting a token —
  name, eight scope checkboxes, a lifetime, then a secret shown exactly once
  that must be copied before dismissing — is a *task*, and it is being done in
  a drawer sized for "change your name". The one-time reveal is the sharpest
  case: it is the only place in the product where scrolling away loses data
  permanently.

- **Found by:** Mitchell, 2026-09-17, on PR 185's preview, while using the
  Tokens section on `/admin`. Verbatim: *"The account settings page is getting
  too busy for a side bar. Lets make it its own stand alone page, where it has
  tabs for each major functionality. Tab for account settings like kilometer
  and currency, Tab for making api tokens, etc"*.

  The same session produced a second, smaller piece of evidence for the same
  cause: the scope list needed *"select all/ select none"* because eight
  checkboxes in a drawer is a lot of scrolling. That one was small enough to
  fix in place (`bad0ae1`); this one is not.

- **Why it will recur:** the sheet grows by one section per milestone that adds
  an account-scoped capability, and each arrives as "one more block in the
  column" because that is the cheapest thing to do at the time. M20 added Plan,
  M22 added Tokens. Billing history, notification preferences, connected
  accounts and data export are all account-scoped and all plausible next.
  Nothing in the current shape resists the next addition, which is what makes
  this debt rather than a one-off.

- **Fix sketch (not done):** a real route — `/account` — with tabbed sections,
  each tab its own URL so a tab is linkable and the browser back button works:

  - `/account` → **Profile**: display name, home airport.
  - `/account/preferences` → **Preferences**: distance units, currency. (There
    is no account-level currency today — trip currency is per trip via
    `SetTripCurrency`. Mitchell named it as a tab, so deciding whether an
    account *default* currency should exist is part of this work, not an
    assumption to carry in silently.)
  - `/account/plan` → **Plan**: tier, usage, referral code. `PlanSection`
    already loads its own data and takes no props, so it moves as-is.
  - `/account/tokens` → **API tokens**: the full mint/reveal/revoke flow with
    room for it. `TokensSection` also self-loads.

  Both heavy sections already fetch their own data and accept only an
  `onNavigate` callback for dismissing the sheet, so the move is mostly
  deleting that prop and giving each a route. The identity and display fields
  are the part that has to be lifted out of `AccountSettingsSheet` into their
  own components first.

  **Keep the sheet or drop it — that is the open question.** The avatar menu
  opening a quick drawer for "change your name" is genuinely good, and a full
  page navigation for that is a regression. The likely answer is both: the
  sheet keeps identity and display and gains a "More settings" link to
  `/account`, while plan and tokens move to the page and out of the drawer
  entirely. That decision is Mitchell's and is not made here.

- **Cost of not fixing:** the next account-scoped feature lands as a fifth
  block in the same column, and the token flow keeps happening in a container
  that makes losing a one-time secret easier than it should be.

- **Fix:** M26 link 1, 2026-09-19, built to SPEC §34.4 rather than to the sketch
  above — the design answered the same complaint independently and is newer, so
  where the two differ the design won. Three differences worth naming, because
  each was an open question here:

  1. **Three tabs, not four, and `?tab=` rather than four paths.** There is no
     *Preferences* tab: distance units and home-time sit in **Profile**, whose
     brief is "who you are and how the app reads to you". And a tab is a query
     parameter on one route, not a nested route — still linkable, still walked
     by the back button, but the panels are siblings rather than pages, which
     is what lets a tab switch keep the header and the heading in place.
  2. **The sheet is DROPPED, not kept alongside.** This entry left that open
     ("the likely answer is both"). §34.4 replaces `AccountSettingsSheet`
     outright, and the "quick drawer for change your name" it was protecting is
     not lost: the avatar popover still holds the identity block and Sign out,
     and *Your account* is now a link rather than a drawer trigger. Keeping a
     sheet for two fields that also exist on the page would have been project
     rule 4 on the whole surface.
  3. **The currency question is answered NO, and not deferred** — the thing
     this entry explicitly asked not be carried in silently. Currency stays per
     trip. Every other Profile field is a property of the reader with no
     per-trip counterpart; a currency is a property of where the trip happens
     and the trip already carries one, so an account-level default would not
     replace it but sit above it and owe a precedence rule nothing has asked
     for. The reasoning is in `docs/milestones/M26-design-parity.md` link 1.

  The heavy sections moved as this entry predicted — both self-fetch, so the
  move was deleting the `onNavigate` prop that existed only to close the sheet.
  The identity and display fields were lifted into `ProfileSection` **with every
  PR-112 guard intact** (the per-field `editing.current` flags, revert on
  refusal, the surfaced unit error); their nine tests migrated unchanged and
  pass, which is the evidence rather than the claim.

- **Blast radius:** `e2e/m22-api-tokens.spec.ts` drives the token flow through
  the sheet, as do `TokensSection.test.tsx` and `PlanSection`'s tests. Any move
  has to bring those with it — the e2e in particular is M22's proof that a
  token can be minted and revoked by clicking, and it must keep proving that
  wherever the controls live.

  **All of it was brought.** Seven test files bound to the sheet and every one
  migrated rather than being deleted, behind one `openAccountPage` e2e helper.
  `m22-api-tokens.spec.ts` still proves a token is minted and revoked by
  clicking. `m21-plans.spec.ts` was scoped to `role="dialog"` and therefore
  **failed rather than drifted** when the dialog stopped existing, which is the
  outcome to want from a spec whose container is removed.

- **First noted:** 2026-09-17, on PR 185's preview. **Resolved:** 2026-09-19,
  M26 link 1.
