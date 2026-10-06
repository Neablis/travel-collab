# A referral pays out when the invited account first pays, as a free month that stacks

**Status:** Design approved by Mitchell, 2026-10-06, in conversation. No plan yet. Not on a
milestone: Mitchell asked for it directly while M34 is current. Amends **M20 link 8** and
reverses two of its 2026-09-01 decisions (below). The decision wants an ADR at build time
(next free number is ADR-066).

Mitchell's ask, in three messages: referral rewards should run back to back instead of
overlapping; a referral should count when the invited account first makes a payment, not when
it signs up; the reward is a real free month, for a free referrer too; refunds are not clawed
back yet but must be tracked, because a ban rule is coming.

Facts below were checked against `main` at `bc11ebc2`.

---

## 1. Where things stand

- **The reward fires at signup.** `recordSignIn` calls `rewardReferrer(code, identity.id)` when
  a brand-new account was admitted `via === "invite-code"` (`server/users.ts:438`).
- **The reward is an entitlement grant**, 30 days from the redemption, of the plan the referrer
  holds (`server/entitlements/referrals.ts:219`). Grants union in the resolver, so three
  rewards in one month overlap and end 30 days after the last one.
- **It never touches billing.** Nothing under `server/billing/` reads a referral grant. A
  subscriber who earns one is still charged, so the reward only matters if they cancel or lapse
  inside the 30 days.
- **A free or trial-only referrer earns nothing** (`referrer-holds-no-paid-plan`). That rule
  existed because a signup was farmable.
- **Caps:** 10 rewards per rolling 30 days, 5 unredeemed codes outstanding, both under a
  per-account advisory lock (`withAccountLock`).
- **Who invited whom is already recorded:** `invite_codes.created_by` and `redeemed_by`
  (`db/schema.ts:985`). ADR-063 kept the claim when it opened signup.
- **The webhook handles six event types** (`billing/webhook.ts:66`), including
  `invoice.payment_succeeded`. It handles no refund or dispute event.
- **`stripeApi.ts` has no customer-balance call** and no refund read.
- **There is no ban or suspension field** on `users`.

## 2. Decisions (approved)

1. **The reward is earned on the invited account's first successful payment**, not at signup.
   Renewals earn nothing. One reward per invited account, ever.
2. **For a referrer with a paying subscription, the reward is a Stripe account credit** worth
   one month of the plan version they hold at that moment. Stripe applies a customer balance to
   the next invoice and carries any remainder forward, so several rewards run back to back
   without code for it.
3. **Every paying referral is worth the same: one free month of the referrer's plan**, whatever
   the invited account bought. A `plus` purchase earns a `premium` referrer a `premium` month.
4. **A free referrer earns a free month too.** (Reverses 2026-09-01's *"a `free` account earns
   nothing"*. The reason for that rule was that signups could be farmed. A payment cannot be
   farmed for free.)
5. **No clawback on refund in v1**, and the 10-per-30-days cap stays as the bound.
6. **Refunds are tracked against referrals from day one**, so a later rule can ban on a history
   of *referred signup, payment, refund*. The ban itself is not in this work.

## 3. Working decisions (made while designing; Mitchell has not seen these)

1. **A free referrer's month is a 30-day `plus` grant.** There is no bill to credit, and `plus`
   is what the trial already hands out. "Free referrer" here means anyone without a conferring
   paid subscription at that moment: free, trial-only, or lapsed.
2. **Grants stack by chaining expiry.** A new referral grant expires 30 days after the later of
   *now* and the referrer's latest unexpired referral grant. No `starts_at` column.
3. **A referrer who earned grant months and then subscribes keeps them as grants.** They are
   not converted to credit. Converting is a second reward path for a rare case.
4. **"First successful payment" is the first `invoice.payment_succeeded` with `amount_paid > 0`
   for the invited account.** A $0 invoice does not count.
5. **No time limit between signup and first payment.** An account invited in October that first
   pays in March still earns its inviter the month.
6. **The cap counts rewards, of either kind, on the new ledger** (below), not grant rows.
7. **A referrer already rewarded at signup under the old rule is not rewarded again** when that
   same invited account later pays. The migration backfills a ledger row for each existing
   `source = 'referral'` grant so the once-per-invited-account constraint covers them.
8. **A reward that fails to apply is kept, not lost.** The ledger row is written first as
   `pending`, then the Stripe credit or the grant is applied and the row marked `applied`. The
   webhook never fails because a reward did. A `pending` row is retried on the next webhook
   event for either account, and is visible in the operator console.
9. **Founder-grant holders are not special-cased.** An account whose founder grant already
   confers everything gets a `plus` grant that changes nothing for it.

## 4. Shape

### Storage (one migration)

`referral_rewards`, owned by Entitlements:

| column | notes |
|---|---|
| `id` | uuid |
| `referrer_id`, `referee_id`, `code` | from `invite_codes` |
| `referee_id` | **unique**. This is the once-per-invited-account rule |
| `kind` | `credit` or `grant` |
| `plan_id`, `plan_version` | what the month was of |
| `amount_minor`, `currency` | for `credit`; null for `grant` |
| `stripe_invoice_id` | the payment that earned it |
| `stripe_balance_transaction_id`, `grant_id` | whichever was written |
| `status` | `pending`, `applied`, `legacy` (backfilled) |
| `created_at`, `applied_at` | |
| `refunded_at`, `disputed_at` | set by the refund tracking below; null otherwise |

### Server

- **`billing/stripeApi.ts`:** `creditCustomerBalance(customerId, amountMinor, currency,
  idempotencyKey)`, a `POST /v1/customers/{id}/balance_transactions` with a negative amount.
  The idempotency key is the reward row's id.
- **`billing/webhook.ts`:** on `invoice.payment_succeeded` with `amount_paid > 0`, after its
  existing work, call the reward function with the paying account and the invoice id. Add
  `charge.refunded` and `charge.dispute.created` to `HANDLED`. Each resolves the customer to an
  account and stamps `refunded_at` or `disputed_at` on that account's reward row, if one exists.
- **`entitlements/referrals.ts`:** `rewardReferrer` takes the paying account instead of a code.
  It finds the code that account redeemed, refuses self-referral, takes the referrer's lock,
  checks the cap on `referral_rewards`, inserts the `pending` row (the unique constraint makes a
  replay a no-op), then applies a credit or a chained grant and marks it `applied`.
- **`users.ts`:** the signup-time call is deleted. The code claim stays.
- **Boundary:** the webhook is still the only writer of Billing's tables (ADR-047).
  `referral_rewards` is Entitlements' table, and the balance credit is an outbound Stripe call,
  not a local billing write. The ADR should say so.

### Operator console

On the account page (M36): rewards earned, how many were credits and grants, how many are
`pending`, and how many of the invited accounts later refunded or disputed. That last count is
the input the ban rule will read.

### Copy

Every place that describes the reward changes meaning and needs rewording: the account sheet's
referral block (`PlanSection.tsx`), the signup field (`ADMISSION_FIELD_COPY`), the plans screen,
and the referral link-preview card (`server/og/copy.ts`, `referral.ts`).

## 5. What a person clicks to see it

Walked with Stripe test mode per `docs/guidelines/billing-without-spending-money.md`.

1. A `premium` subscriber mints a code. A new account signs up with it. The subscriber's account
   sheet shows nothing earned yet.
2. The new account subscribes to `plus`. The subscriber's Stripe customer shows a $19 credit,
   and their next invoice is $0.
3. Two more invited accounts pay. The balance is $38 and the next two invoices are $0.
4. A free account does the same once. Its account sheet shows `plus` for 30 days; a second
   paying referral extends that to 60.
5. One invited account is refunded. The referrer keeps the month, and the operator console shows
   one refunded referral against them.

## 6. Out of scope (v1)

- The ban rule, and any suspension mechanism. Only the data it needs is built.
- Clawing back a credit or a grant.
- Capping the credit at what the invited account paid. Mitchell chose a flat free month. The
  known cost: a second account paying $9 for `plus` earns a `premium` referrer $19, up to ten
  times in 30 days. The refund tracking and the cap are what watch it.
- Annual plans, multiple currencies, and converting grant months to credit.
