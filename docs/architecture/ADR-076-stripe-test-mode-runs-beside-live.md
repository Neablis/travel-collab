# ADR-076: Stripe test mode runs beside live, keyed by the secret that verified it

**Status:** **Accepted — 2026-10-17.** Mitchell answered M47's decisions 2, 3 and 4 that day.
Amends **ADR-047** (Billing is a module, its webhook is the only writer, and a lapse is a
derivation): decision 2's *"the one column outside that rule is `users.stripe_customer_id`"*
becomes a table, and the deployment gains a second, test-mode key pair.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-047** (amended here), **ADR-045** (Entitlements is a module; the tier panel lives
there), ADR-004 (production migrations are dispatched by hand), milestone
`docs/milestones/M47-the-business-over-time.md` (decisions 1 to 4),
`docs/guidelines/billing-without-spending-money.md` (the recipe this changes; see *What changes in
the billing guideline*).

## Context

Mitchell, 2026-09-16: *"i would like to be able to use test card without needing to take down prod
with new ENV variables."* Today a deployment has one Stripe key pair. `modeOfSecretKey` reads the
mode out of `STRIPE_SECRET_KEY`'s prefix (`server/billing/config.ts:63-72`), and the webhook
verifies against one secret (`app/api/stripe/webhook/route.ts:37`). So production can only take
live payments, and walking a paid flow there means spending real money.

Three facts make "just add the test keys" unsafe:

- **Nothing stores a mode.** `subscriptions` and `billing_events` have no `livemode` column, and
  nothing in the tree reads one. A test subscription on production would count as MRR
  (`server/billing/revenue.ts`, via `subscriptionsWithStatus`, `subscriptions.ts:56-60`).
- **The held plan does not know its mode.** The console's tier panel counts `users.plan_id`
  (`server/entitlements/admin.ts:211-219`), and `syncHeldPlan` (`server/billing/webhook.ts:295-311`)
  writes it for a test checkout exactly as for a live one.
- **The customer id is one column.** `users.stripe_customer_id` (`server/db/schema.ts:131`) holds
  one id, and Stripe's test and live modes are separate customer spaces. A test customer id written
  there would replace the live one, or be refused by the live key.

## Decision

1. **Every Billing row that came from Stripe records its mode.** `subscriptions.livemode` and
   `billing_events.livemode` are `boolean NOT NULL`. Existing rows are back-filled `true`:
   production has only ever had a live key, and preview and local databases are disposable.

2. **A Stripe customer is per account per mode**: `stripe_customers(user_id, livemode,
   customer_id)`, unique on `(user_id, livemode)`. Existing `users.stripe_customer_id` values are
   copied in as live. `stripeCustomerFor(userId, mode)` is still the sole reader and writer, keeps
   its insert-only-if-absent race handling, and puts the mode in `createCustomer`'s idempotency
   key. `users.stripe_customer_id` stops being read or written; it is dropped by a later migration
   once no deployed build reads it, because production migrations are dispatched apart from
   deploys (ADR-004). This replaces ADR-047 decision 2's *"the one column outside that rule"*: the
   exception is now this table, on the same argument. A customer id is who you are at Stripe, not
   what you may do.

3. **The held plan records its mode.** `users.plan_livemode boolean NOT NULL DEFAULT true`,
   written only by the webhook, in the same statement that writes `plan_id` and `plan_version`. It
   is the mode of the subscription that confers the held plan, or `true` when the account falls
   back to `free`. `soleWriter.test.ts` covers it as it covers `plan_id`.

4. **Every read that treats a subscription or a holding as money counts live only.**
   `subscriptionsWithStatus` filters `livemode = true`, so MRR, the underwater report and revenue
   by plan do; the console's accounts table's *paying* and *past due* columns (its own SQL,
   `admin.ts` `accountsMatching`) do; and the tier panel and the weekly rollup (M47 decision 1)
   count only `plan_livemode = true`. **What an account may do is not a money read**: the
   resolver, `standingFor` and the account sheet read a test subscription as they read a live one,
   so a test checkout confers the plan (decision 4 of the milestone). The literal is `true`, not
   "the deployment's own mode". On a deployment whose only keys are test keys (local, a preview)
   the console's money panels therefore show nothing bought there. The integration tests prove the
   reads, so the console needs no test-mode rendering of its own.

5. **The webhook tries both secrets, and the secret that verifies decides the mode.** The
   deployment has up to two key pairs:
   - `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. The pair's mode is read from the key's prefix,
     as today.
   - `STRIPE_TEST_SECRET_KEY` + `STRIPE_TEST_WEBHOOK_SECRET`, optional, and refused at first use
     unless the key begins `sk_test_`. The config also refuses two pairs of the same mode.

   The route verifies the raw body against each configured secret. Verification still happens
   before any parse. **The mode is the mode of the pair whose secret verified.** The verified
   event's own `livemode` field must agree with it. If it does not, or is missing, the delivery is
   refused **400 `mode-mismatch`** and nothing is written, `billing_events` included. Recording a
   disagreement as test instead would write a row whose mode two sources dispute; refusing it
   writes none, and Stripe's retries make the refusal visible in its dashboard. Every Stripe call
   the webhook then makes (re-fetching the subscription) uses that mode's key.

6. **The switch is per account, server-only and admin-only.** `users.stripe_test_mode boolean NOT
   NULL DEFAULT false` is set by `PUT /api/admin/accounts/[accountId]/test-mode` and read by its
   `GET`, both behind `requireAdminApi` (404 for anyone else), and drawn as a toggle on the
   console's account page. It is in no payload the account itself can read (`/api/account/plan`,
   the session, any page props outside `/admin`). Checkout, the portal and a plan change read it on
   the server and pick that mode's key, customer and Price. A change to an existing subscription
   uses that subscription's own `livemode`, because Stripe only knows it in its own mode. A test
   checkout then confers the plan through the ordinary webhook path, with `plan_livemode = false`.
   With the switch on and no test pair configured, the PUT answers 409 `test-mode-unavailable`.

7. **Prices are looked up per mode.** A lookup key names the same Price in both modes, but the
   Price ids differ between Stripe's two accounts, so `stripePriceFor` and `findPriceByLookupKey`
   take the mode. The console's price check (`priceConsistencyReport`) checks live only.

## What changes in the billing guideline

`docs/guidelines/billing-without-spending-money.md` stays true until part 2 merges, so it is
updated **in part 2**, not here:

- *"There is no `STRIPE_MODE` variable … That variable not existing is the design"* (lines 26-28)
  **stays true**. The mode is still read from a key's prefix, and the webhook reads it from which
  secret verified. Part 2 adds a sentence saying so, so nobody reads the second pair as a mode
  switch.
- *The one rule* (`sk_live_` only in Production) stands. Part 2 adds its pair: **`sk_test_` in
  `STRIPE_TEST_SECRET_KEY`, and never `sk_live_` there**, which the config refuses.
- A new section, *Testing on production*: register a **test-mode** webhook endpoint in Stripe's
  dashboard pointing at production's `/api/stripe/webhook`, set the two `STRIPE_TEST_*` variables
  in the Production scope, redeploy, switch an account on in the console, and buy with `4242…`.
  That is the M47 walk.
- `.env.example` gains the two variables, with the same comments.

## Consequences

- **A deployment can take live and test payments at once**, and the business numbers cannot tell
  a test card from nothing. The walk that used to need real money needs a console toggle.
- **Every new money read has to filter.** The filter is in `subscriptionsWithStatus` and in the
  two SQL reads that do not use it. A new read written directly against `subscriptions` would miss
  it, and nothing sweeps for that; review is the only guard. Part 1's integration tests cover the
  reads that exist today.
- **An account can hold a plan it paid nothing for**, with `plan_livemode = false`. That is the
  intended state for a tester, and the console's tier counts leave it out, so the panel's tiers no
  longer sum to every account.
- **The switch confers entitlements**, which is why it is admin-only and server-only. A non-admin
  reaching it would be a free-premium switch, and the route test checks both directions.
- **Local development changes slightly.** With only test keys set, purchases land with
  `livemode = false` and the console shows no MRR for them. Entitlement walks are unchanged.

## Rejected

1. **Recording a mismatched event as test** (the milestone's first wording allowed it). It is
   never wrong about money, but it writes a row whose mode the signature and the payload dispute.
   Refusing writes nothing, and a real mismatch means a configuration mistake worth a red delivery
   in Stripe's dashboard.
2. **A second column, `users.stripe_test_customer_id`.** One column per mode puts the mode in a
   column name, and every reader then branches on it. A table keyed on `(user_id, livemode)` is the
   fact's own shape.
3. **A `STRIPE_MODE` variable, or reading the mode from the payload.** The first is a second
   source for a fact the key already carries (the guideline's rule). The second trusts an
   unverified body, which ADR-047 rules out.
4. **Counting "the deployment's own mode" in the money reads**, so that local MRR shows test
   purchases. It is a second rule to get right on every read, for a convenience the integration
   tests already cover.
