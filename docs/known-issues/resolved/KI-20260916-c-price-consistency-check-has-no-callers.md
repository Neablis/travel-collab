### KI-2026-09-16-c — `checkPriceConsistency` is "the gate box, as a function" and nothing ever calls it — RESOLVED

**Resolved 2026-09-24 — the operator-console row shape, not the deploy check.**
`adminOverview()` (`server/entitlements/admin.ts`) now carries
`prices: PriceConsistencyReport`, produced by a new non-throwing wrapper in
`prices.ts`, `priceConsistencyReport()`: `unconfigured` when
`billingConfigured()` is false (Stripe is not asked at all — the state every
local, CI and e2e run is in), `unavailable` with Stripe's error message when
the sweep throws, and `checked` with `checkPriceConsistency()`'s rows otherwise.
`/admin` renders it as `PriceCheckPanel`; `lib/adminOverview.ts` mirrors the
type, pinned by the existing `adminWireShape.test.ts` identity check. The
console shape was chosen because the function *reports* by design (`missing` is
ordinary) and a deploy gate against a live vendor would make every deploy
depend on Stripe answering. It is read-only: `createPrice` is never reached.
**Proof:** `adminPrices.int.test.ts` failed 3/3 before the fix
(`TypeError: Cannot read properties of undefined (reading 'status')` — the
console never asked) and passes 3/3 after; with the caller unwired back to a
constant it goes red again (`expected 'unconfigured' to be 'checked'`).
`PriceCheckPanel.test.tsx` goes red when the mismatch row stops saying so.
Stripe is mocked and `fetch` stubbed to throw, so no test reaches the vendor.

- **Severity:** correctness, latent — the check is written, correct, and dead.
  The failure it exists to catch is one its own header calls *"the worst class
  of billing bug because nothing errors"*, and a check nobody runs reports
  nothing, which is the same outcome as not having written it.
- **Area:** `apps/web/src/server/billing/prices.ts:184-213`
  (`checkPriceConsistency`), and the absence of any caller anywhere.
- **Symptom / What happens:** the function is documented as —

  > **The gate box, as a function**: every published priced version's Stripe
  > Price resolves to one with the same amount and currency.

  **Its only callers are its own unit tests.** Verified 2026-09-16:
  `grep -rn "checkPriceConsistency" --include=*.ts --include=*.tsx --include=*.mts .`
  outside `node_modules` returns four lines — the definition, and three in
  `prices.test.ts`. **No production caller exists**: no script, no route, no
  admin surface, nothing scheduled, nothing in a deploy. The only other mention
  in the repository is prose, in
  `docs/milestones/M21-subscriptions-and-billing.md`.
- **Why it matters more than an unused export usually would.** M21 link 2's
  stated division of authority is that the plan version says **what is granted**
  and Stripe says **what is charged**, and that *"this module is the only thing
  that checks."* If the only thing that checks is never run, the pricing page and
  the card statement can disagree indefinitely with nothing erroring — which is
  precisely the scenario the module's header describes. `assertPriceMatches`
  **is** reached on every checkout via `stripePriceFor`, so a mismatch on a
  version somebody is actively buying does throw; what is unreachable is the
  **sweep across every published version**, which is the half that catches a
  version nobody has bought lately.
- **What is genuinely covered, so the gap is narrower than "dead code" suggests:**
  - `prices.test.ts` exercises `checkPriceConsistency` directly, so the function
    is tested. It is the *invocation in production* that does not exist.
  - `assertPriceMatches` runs on the live path (`stripePriceFor`, called by
    `startCheckout`), so any version being sold right now is checked at the till.
- **What is NOT covered:** every published priced version that nobody is
  currently buying. Today that is `premium@v1`, whose Stripe Price has never been
  created at all — `checkPriceConsistency` would report it `missing`.
- **Found by:** M22's reorder analysis, 2026-09-16 — establishing whether M21's
  second gate box could be closed for `premium@v1` without a purchase. The answer
  is no, and finding out why turned up that the function built to answer exactly
  this question is never invoked.
- **Fix sketch (not done):** give it a caller. The two shapes that fit the repo
  are an operator-console row (it returns a table an operator reads, which is
  what the reporting-rather-than-throwing design is *for*) or a startup/deploy
  check that refuses to ship past a `mismatch` verdict while treating `missing`
  as ordinary. Not fixed here because it is M21's surface, and M21 is paused.
- **Filed, not fixed.** Outside M22's scope.
