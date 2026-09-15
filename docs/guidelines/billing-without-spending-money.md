# Testing billing without spending a penny

Everything in M21 — checkout, the webhook, the grace window, a lapse, a
restore — can be walked end to end for **$0.00**, and the whole of the reason is
that Stripe ships a complete parallel universe called **test mode**. This file is
the recipe. Read it before touching a Stripe dashboard, because the two mistakes
that cost real money are both made in the first five minutes.

Related: `docs/milestones/M21-subscriptions-and-billing.md` (the exit gate this
lets you walk), **ADR-047** (why the webhook is the sole writer, and why there is
no SDK), `docs/guidelines/environments-and-deploys.md` (how a variable reaches a
deployment at all).

---

## The one rule

**A key beginning `sk_live_` must never be set anywhere except Production.**

Not in `.env.local`, not in a Preview environment, not "just to check something".
There is no test card that fails safely against a live key: a live key charges
the card it is given, and the card you will give it is yours.

The code refuses to help you get this wrong in the ways it can:

- `modeOfSecretKey` reads test-vs-live **out of the key itself**, so there is no
  `STRIPE_MODE` variable that can disagree with the key beside it. That variable
  not existing is the design.
- A publishable key (`pk_`), a restricted key (`rk_`) or a webhook secret in
  `STRIPE_SECRET_KEY` is refused at the first call with a message naming the
  mistake, rather than surfacing as a failed checkout later.
- A secret key in `STRIPE_WEBHOOK_SECRET` is refused too. Swapped round, it would
  verify no signature and reject every delivery — which looks exactly like Stripe
  being down.

What the code **cannot** check is that the live key is in the right *environment*.
Only you can, and the check is one command:

```bash
# Anything that prints sk_live_ outside Production is the mistake.
grep -r "sk_live" apps/web/.env.local .env.example 2>/dev/null   # must print nothing
```

---

## Setting up, once

1. **Get the test keys.** Stripe dashboard → toggle **Test mode** on (top right)
   → Developers → API keys. The secret one starts `sk_test_`.
2. **Put them in `apps/web/.env.local`**, which is gitignored and never reaches a
   deployment:

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...   # from step 3, not from the dashboard
   ```

3. **Forward webhooks to your machine.** Stripe cannot reach `localhost`, so its
   CLI tunnels for it:

   ```bash
   stripe login                                    # once, per machine
   stripe listen --forward-to localhost:3001/api/stripe/webhook
   ```

   It prints a signing secret of its own — `whsec_...` — **for that session**.
   That is the value `STRIPE_WEBHOOK_SECRET` needs locally; the dashboard's
   endpoint secret is a different string and will verify nothing here. Restart
   `pnpm dev` after setting it, because Next reads the file at boot.

4. **Check it is on.** `GET /api/account/plan` returns `billing.available: true`,
   and `/plans` stops showing the "not available on this deployment" banner.

**With no keys set, nothing here breaks.** That is a supported state, not a
half-configured one: every surface that would sell something asks
`billingConfigured()` first, `/plans` says so plainly, and the e2e suite walks
exactly that deployment. You only need this file when you want to walk the paid
half.

---

## The cards

Stripe's test cards are the whole game. Any future expiry, any CVC, any postcode.

| Card number | What it does | What it is for |
|---|---|---|
| `4242 4242 4242 4242` | Succeeds | The happy path, and the first purchase |
| `4000 0000 0000 0341` | Attaches fine, then **fails when charged** | The decline that starts the grace window |
| `4000 0000 0000 9995` | Declined: insufficient funds | A decline at checkout rather than at renewal |
| `4000 0025 0000 3155` | Requires 3D Secure | The authentication step, which hosted checkout handles |
| `4000 0000 0000 0069` | Expired card | A renewal failing months later |

**We never type one of these into this application**, and that is a gate box
rather than a convention: *"no card number, CVC or expiry is ever entered into,
posted to, or logged by this application."* Every one of them is typed on
Stripe's own hosted page, which is the entire reason checkout is hosted. If you
find yourself putting a card number into a field this repo renders, stop — the
milestone has gone wrong.

---

## Driving each exit-gate box

### A free account subscribes, and nothing is granted until the webhook

1. Sign in, open **Your account → Change plan**, pick `plus`, confirm.
2. Pay with `4242 4242 4242 4242`.
3. You land back on `/plans` in the **pending** state — *"waiting for Stripe to
   confirm"*. That is the build being honest: the redirect proved a browser
   followed a URL.
4. Watch `stripe listen`'s output. When `checkout.session.completed` is
   forwarded, the page moves to the result state on its own.

**To prove the redirect grants nothing** — the gate box's own wording, *"proven
by exercising the redirect without the webhook"* — stop `stripe listen` first,
then buy. You will sit in pending forever and `GET /api/account/plan` keeps
saying `free@v1`. Start the listener again and Stripe replays the backlog; the
account catches up with no further action. That is the whole architecture in one
observation.

You can also just type the URL, which is what a forger would do:

```bash
open "http://localhost:3001/plans?checkout=cs_test_i_made_this_up"
```

Pending, never granted. The e2e suite walks this one on every run.

### The same event twice applies once

```bash
stripe events resend evt_...     # the id is in `stripe listen`'s output
```

The endpoint answers `{"applied":false,"note":"replay"}` and the row does not
move. `billing_events` has one row for that id, and it always will.

### Out-of-order delivery converges

Hard to arrange by hand and already proven against a real database in
`webhook.int.test.ts` — the newer event wins whichever order the two arrive in,
because the comparison is in the UPDATE's own WHERE clause. If you want to see it
live, resend an **older** event after a newer one has landed and watch the reply
say `stale`.

### A bad signature is rejected before the body is parsed

```bash
curl -i -X POST localhost:3001/api/stripe/webhook \
  -H 'Content-Type: application/json' \
  -H 'Stripe-Signature: t=1,v1=deadbeef' \
  -d '{"id":"evt_forged","type":"customer.subscription.updated"}'
```

`400 bad-signature`. Send it with no signature header at all, and with a body
that is not JSON — same answer, because verification happens first and there is
no other path from a body to an event in the application.

### Failed payment, the three-day grace window, and the lapse

This is the one that would need you to **wait three days**, and you do not have
to. Stripe has **Test Clocks**: a simulated clock you can advance, with
subscriptions attached to it.

```bash
# 1. A clock, starting now.
stripe test_helpers test_clocks create --frozen-time $(date +%s)

# 2. Make the subscription against that clock. In the dashboard:
#    Customers → the customer → ⋯ → "Attach to test clock",
#    or create the customer with `test_clock=clock_...` and buy as usual.

# 3. Put a card on it that will fail at renewal: 4000 0000 0000 0341.

# 4. Jump to just after the period end so the renewal is attempted and fails.
stripe test_helpers test_clocks advance --frozen-time <period_end + 60>
```

`invoice.payment_failed` arrives, the status becomes `past_due`, and
`past_due_since` is stamped with **that event's time**. Now the interesting part
needs no Stripe at all, because **a lapse is a derivation, not a write**
(ADR-047 decision 3): the row never changes again, and what it *means* is
computed against the clock every time anyone reads it.

So walk the window with your own clock:

- **Day 2** — open the account sheet. The banner names the decline date, the date
  the window ends, and what stops then, including the collaborators. Nothing has
  been taken: the assistant still answers, invites still work.
- **Day 3** — still nothing taken. The instant the window ends is the last
  instant inside it.
- **Day 4** — `/ask` answers 402, the invite form is gone, and collaborators on
  your trips can read and not edit. **Nothing ran to make that happen.** No job,
  no cron, no scheduled write — check `subscriptions` and see the row is
  byte-identical to how it was on day 2.
- **Fix the card** (Stripe's portal, `4242…`, then advance the clock to trigger a
  retry). `invoice.payment_succeeded` clears `past_due_since`, and everything is
  back — including the collaborators, with nobody re-invited.

To check the boundary without any of this, `standing.test.ts` walks it to the
millisecond and `lapse.int.test.ts` walks it through the real resolver against a
real database. The clock recipe above is for seeing it, not for proving it.

### Cancelling runs to the end of the paid period

Account sheet → **Payment and invoices** → cancel in Stripe's portal. The webhook
records `cancel_at_period_end`, the sheet says *"Ends on 20 October. Until then
nothing changes"*, and everything keeps working. Advance the test clock past the
period end and it lapses **through M20's resolver** — there is no second
downgrade path, which is exactly why there is nothing else to check.

### A price change leaves an existing subscriber alone

1. Buy `plus` at $9.
2. Publish a new version in `planVersions.ts` — append a `plus` entry at
   `version: 2` with a different price. **Never edit the v1 entry**; a test fails
   if you do, which is the point.
3. `pnpm dev` picks it up. The existing subscriber's row still pins `plus@v1`,
   their bill does not move, and their terms do not move.
4. Buy `plus` on a second account: it pins `v2`, pays the new price, and gets a
   **different Stripe Price**, because the lookup key is derived from the amount.

---

## Walking it on a preview deployment

Everything above forwards webhooks to **your machine**. A preview is the one
thing local cannot show you: Stripe's hosted Checkout page, in a real browser,
against a real deployment with the real CSP. It works, and there is exactly one
thing that makes it different from local.

**The database is safe.** A preview points at a disposable Neon branch, never
production (`environments-and-deploys.md`), and its build applies pending
migrations itself when `PREVIEW_DB_IS_DISPOSABLE=true` — so `0021` and `0022`
are already there. Test-mode subscription rows land somewhere throwaway.

### The thing that is different: Stripe cannot reach the webhook

Preview URLs sit behind **Vercel Authentication** (`ssoProtection`, scoped
`all_except_custom_domains`). Your browser can get past it. Stripe's webhook
POST cannot: it is an unauthenticated server-to-server request, so it 302s to
`vercel.com/sso-api` and your endpoint never runs.

**That matters more here than anywhere else in the app**, because the webhook is
the *sole writer* (ADR-047). Without it a checkout completes, Stripe takes the
test payment, and the account is granted nothing — which looks exactly like a
broken product and is really a blocked request.

> #### Do not put the bypass secret in the webhook URL
>
> Vercel accepts `?x-vercel-protection-bypass=<secret>` as a query parameter, and
> **the first version of this section told you to register that as your Stripe
> endpoint. That was wrong.** Mitchell caught it. It is written down rather than
> quietly deleted, because the URL form is genuinely convenient and somebody will
> reach for it again.
>
> A query parameter is not a private channel:
>
> - **Stripe stores the endpoint URL** and shows it to anyone with dashboard
>   access — in the endpoint's settings, and beside every delivery attempt.
> - **Vercel logs the request line**, query string included, so the secret lands
>   in runtime logs and anything they drain to.
> - The blast radius is not this preview. `environments-and-deploys.md` says it
>   plainly: *"anyone holding it can reach every protected deployment this
>   project has"* — production's `vercel.app` URL among them, since that is
>   protected by the same `all_except_custom_domains` rule.
>
> A credential that unlocks every deployment does not belong in a field two
> systems log and one of them displays.

### Three ways that do not leak it

**1. Keep the webhook local, even while the browser is on the preview.**
`stripe listen` forwards wherever you point it, and nothing says that has to be
the host you are clicking on. Sign in to the preview, start checkout there, pay
on Stripe's real hosted page — and let the event land on your machine, where no
bypass is involved at all. What you give up is that the grant lands in your local
database rather than the preview's. For *"does Checkout render, redirect, and
come back"* that is usually the whole question.

**2. Forward to the preview with the bypass as a HEADER.** The header form is
what Vercel intends for automation: not stored by Stripe, not part of the logged
request line. `stripe listen` may be able to attach one — **check
`stripe listen --help` for a headers flag before relying on it.** This guide
cannot verify it from a sandbox, and an unverified flag inside a security
workaround is exactly how the mistake above happened. If the flag is there, the
secret lives in your shell for that session and nowhere else.

**3. Give the preview a custom domain.** `all_except_custom_domains` means a
custom domain is not protected at all, so Stripe reaches it with no credential of
any kind. Heaviest to set up, and the only durable answer if preview webhooks
become routine rather than a one-off.

**If none of those are worth it**, walk the preview without a webhook and know
what you are looking at: Checkout renders, takes the test card, and returns to
`?checkout=cs_…`; the pending screen waits, and after twenty polls says it is
taking a while. That is the honest failure of a webhook that never lands — what a
real user would see if the endpoint were down, and worth seeing once on purpose.

### Setting it up

1. **Set the keys in Vercel's Preview scope** — `STRIPE_SECRET_KEY` (`sk_test_`,
   and read *The one rule* again before you paste) and `STRIPE_WEBHOOK_SECRET`.
2. **Point Stripe at whichever route you chose.** With `stripe listen` there is
   nothing to register; with a custom domain it is a dashboard endpoint there.
   Subscribe to the five types `HANDLED` lists in `webhook.ts`:
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
   `invoice.payment_failed`, `invoice.payment_succeeded`.
3. **Take the signing secret from whichever one you used.** `stripe listen`
   prints its own `whsec_` per session; a dashboard endpoint has a different one.
   They are not interchangeable, and the wrong one verifies nothing — a failure
   that looks like Stripe being down rather than like a wrong variable.
4. **Redeploy**, because the deployment reads its environment at build.
5. **Check it took**: sign in, open `/plans`. The "not available on this
   deployment" banner is gone when `billingConfigured()` is true.

**A dashboard endpoint pointed at a branch alias must be deleted when the branch
merges.** It retries forever against a URL that no longer deploys, and the
failures sit in the Stripe dashboard looking like a product that is broken.

### Getting yourself in

A `?_vercel_share=` URL (23 hours, minted per deployment by the Vercel MCP's
`get_access_to_vercel_url`) or the bypass secret as an
`x-vercel-protection-bypass` **header**, with `x-vercel-set-bypass-cookie: true`
if you want the rest of the browsing session to carry it. A browser is a place a
header is easy to send and a URL is easy to paste somewhere it should not be —
prefer the share link for anything you might screenshot.

### What to walk here, and what not to

Walk the things that only exist on a deployment: the hosted Checkout page
rendering and returning, the `?checkout=cs_…` return landing on the pending
screen, the webhook arriving and the account being granted, the Billing Portal
opening.

**Leave the rest local.** Test Clocks, out-of-order delivery, a bad signature and
the three-day grace window are all faster and more controllable through
`stripe listen` and `stripe trigger`, and none of them look any different on a
deployment. A preview is for proving the hosted pieces, not for re-walking the
suite.

---

## Things that cost money and how not to do them

- **Do not use your own card to "check the real thing works".** If you need
  confidence in live mode, Stripe's own dashboard shows a successful test-mode
  charge with the same code path. The only thing live mode adds is a real bank.
- **Do not point a live key at a preview deployment.** Preview URLs are shared,
  and a preview with live keys is a checkout anyone with the link can complete.
- **Do not leave a test clock attached to anything that matters.** Clocks can be
  advanced by anyone with dashboard access, and a subscription on a clock is a
  subscription whose dates are somebody's toy.
- **Do not create Prices by hand in the dashboard.** `stripePriceFor` creates
  them from the committed plan file under a derived lookup key, and a hand-made
  Price carrying the same key is how the pricing page and the card statement end
  up disagreeing — the one billing bug that errors nowhere. If you have already
  done it, delete it in test mode and let the code make it.

---

## Cleaning up

Test mode is disposable and deleting it costs nothing:

```bash
stripe customers list --limit 100      # test-mode customers only
stripe customers delete cus_...        # takes its subscriptions with it
```

Locally, `pnpm db:reset` clears `subscriptions` and `billing_events` with
everything else. **On preview and production, `billing_events` must never be
swept** — the row *is* the idempotency guarantee, and deleting old rows re-opens
replay for exactly the events old enough that nobody is watching.
