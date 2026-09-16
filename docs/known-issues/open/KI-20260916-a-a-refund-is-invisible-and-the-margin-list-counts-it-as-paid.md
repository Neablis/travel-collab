### KI-2026-09-16-a — a refund is invisible to the product, and the margin analysis counts the refunded account as paying

- **Severity:** correctness of the operator console's money numbers (no user-facing defect; entitlements behave as designed). The overstatement is bounded by the refunded amount and self-corrects when the subscription lapses.
- **Area:** `apps/web/src/server/billing/webhook.ts` (`HANDLED`), `apps/web/src/server/billing/revenue.ts` (`monthlyMicroUsd`, `revenueSummary`, the underwater list), `apps/web/src/server/db/schema.ts` (`billing_events`)
- **Symptom / What happens:** a refund issued from the Stripe dashboard reaches
  `/api/stripe/webhook` as `charge.refunded`, which is not in `HANDLED`, so it
  is answered `ignored` with a 200 and **nothing is written**. Stripe does not
  cancel a subscription on refund and neither do we, so the account keeps its
  entitlements — which is the designed behaviour, not the bug. The bug is
  downstream: `monthlyMicroUsd` derives an account's worth from the **plan
  catalogue** (`version.price.minor`), never from what Stripe actually
  collected, so a refunded account continues to contribute its full price to
  MRR and to appear among the **paying** accounts in the underwater list.
- **Why it matters more than "MRR is $9 high":** MRR being unchanged by a refund
  is defensible on its own — MRR is a forward run-rate and refunds belong in a
  cash view. The defect is that **there is no cash view**, and link 7's margin
  analysis uses the run-rate as a stand-in for one. That analysis exists to
  answer *"is this account worth what it costs"*, and it currently compares a
  catalogue price against real AI spend in micro-USD for an account that paid
  nothing. `revenue.int.test.ts` already protects the related distinction that a
  **comped** account is not a payer; a **refunded** account is the same class of
  error and has no guard.
- **The same blind spot hides three other things**, which is why the fix is a
  ledger rather than a refund special case:
  - coupons and discounts — the catalogue price is charged in the model, whatever Stripe billed;
  - partial or failed-then-retried payments;
  - **proration, which the product already generates**: `planChange.ts` passes
    `proration_behavior: "always_invoice"`, so a mid-cycle upgrade bills an
    amount that nothing in this repository records.
- **What is NOT wrong, checked rather than assumed:** `billing_events` is an
  idempotency ledger by design — `id`, `type`, `event_at`, `received_at`,
  `applied_at`, and no payload. That is correct for what ADR-047 asks of it and
  should not be widened into a money table; the row *is* the idempotency
  guarantee. A cash ledger is a second store, not a wider first one.
- **How it was found:** Mitchell refunded the live $9 Plus purchase from the
  Stripe dashboard on 2026-09-16, immediately after the production walk that
  closed four exit-gate boxes, and asked whether refunds were handled. They are
  not, anywhere — `grep -rniE "refund|charge\.|credit_note|amount_refunded"`
  over `server/billing/` and `app/api/stripe/` returns nothing outside tests.
- **Why it was not fixed when it was found:** it is a schema change plus a
  revenue-derivation change plus a console surface, on a milestone whose gate is
  11/17 with the failure-path boxes still unwalked. Deciding *what* a refund
  means to access is also a business question nobody has been asked: today a
  refund leaves entitlements intact, and the alternative (a refund cancels
  immediately) is a decision, not a bug fix.
- **Fix path, if taken:**
  1. Handle `charge.refunded` in the webhook and record it. A `billing_charges`
     (or `billing_ledger`) table keyed on Stripe's `ch_`/`in_` id, carrying
     `amount_micro_usd`, `amount_refunded_micro_usd`, `currency`, `user_id` and
     `occurred_at`. Recording `invoice.payment_succeeded`'s amount at the same
     time is what makes the refund column mean anything — a refund with no
     charge to net against is half a ledger.
  2. Leave `monthlyMicroUsd` and MRR alone. Add **net collected over the
     trailing window** as its own figure, and switch the underwater/margin
     comparison to it. MRR stays a run-rate; margin becomes cash.
  3. Console: refunds belong on the operator surface (`RevenueStrip` /
     `UnderwaterPanel`), not on the customer's account sheet — Stripe's hosted
     portal already shows a customer their own invoices and refunds, and
     M21 deliberately keeps that surface Stripe's.
  4. A test in the shape of `revenue.int.test.ts`'s comped-account scenario: an
     account that paid and was fully refunded must not appear among the paying
     underwater accounts. Red-first, that test fails today.
- **Decision still owed before step 1:** does a refund revoke access? Today it
  does not, and Stripe's own model agrees (a refund and a cancellation are
  separate acts). If it should, that is a webhook effect and belongs in the same
  change; if it should not, say so in ADR-047 so the silence stops reading like
  an oversight.
- **Cross-reference:** ADR-047 (Billing is a module, the webhook is its sole
  writer); M21 link 7 (the unit-economics half this corrupts);
  `revenue.int.test.ts` (the comped-vs-paying distinction this one mirrors);
  `TODO.md` → *Candidate ideas* → the Stripe test-mode entry, which names the
  same missing `livemode` segmentation in the same tables.
