# ADR-047: Billing is a module, its webhook is the only writer, and a lapse is a derivation

**Status:** **Accepted — 2026-09-14**, with M21 Phase 2.
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-045** (Entitlements is a module — this one sits beside it and
must not be folded into it), ADR-025 (JWT sessions; no entitlement claim in a
token), ADR-008 (`Money` is minor units — and why a plan price is not one),
ADR-003 (the event log is scoped to planning), M21's milestone file (the seven
links and the exit gate this records the shape of)

## Context

M20 built what a subscription grants. M21 makes a subscription real: hosted
Stripe Checkout, a webhook, the customer portal, and what happens when a
payment fails. Three decisions in that work are irreversible enough to be worth
a record, and each of them looked like the obvious choice was fine.

## Decision 1 — Billing is its own module, and Entitlements does not know it exists

`subscriptions` is Billing's store. What an account may **do** stays the
Entitlements resolver's question, read exactly as it was before this milestone:
`can(ent, capability)` over the union of a pinned plan version and every active
grant. **M21 adds no entitlement and no gate**, and if its diff touches
`modelSelection.ts`, `quota.ts` or `members.ts` the split has failed.

The dependency runs **Entitlements → Billing**, one way. The resolver asks
`standingFor(userId)` whether a subscription is still conferring; Billing's
store imports no plan file and no resolver, so nothing closes a cycle. What
crosses the seam is a `planId` + `planVersion` **pin** and a status —
references, never resolved terms, which is ADR-045 rule 1 pointed the other
way.

**The rejected alternative was to make a subscription a grant**, with a fifth
`GrantSource`. It is a smaller diff and it is wrong twice: a grant is a
time-bounded gift with an operator behind it, and a subscription is a
continuing relationship with an external system that can change its mind about
the past; and it would have put "how did this account come to hold this" and
"what is Stripe currently saying" in one column, where the second one wins
silently.

## Decision 2 — The webhook is the sole writer, and Stripe is reached over REST

**A checkout redirect is a hint, never a grant.** A client returning from
Stripe proves only that a browser followed a URL, and deriving entitlement from
a success URL is the classic way a paywall becomes free. So one endpoint writes
`subscriptions` and `users.plan_id`, and `soleWriter.test.ts` sweeps the tree
for a second — because the second writer is never called "grant the plan from
the redirect"; it is a helpful success route that updates the row so the page
has something to show.

The one column outside that rule is `users.stripe_customer_id`, written by the
checkout route. It is not an exception in substance: a customer id is **who you
are at Stripe**, not what you are entitled to, and it has to exist before a
Checkout Session can name it.

**No Stripe SDK.** Six calls, all form-encoded POSTs or plain GETs — create a
customer, create a Checkout Session, create a Portal session, retrieve a
subscription, find a Price by lookup key, create a Price. The reason the
surface is that small is the reason the milestone is shaped as it is: **the app
never sees a card number**, so none of the SDK's client-side machinery has
anything to do here.

What an SDK would genuinely have bought is `webhooks.constructEvent`, and that
is where the argument turns. The gate box asks for an **ordering** claim — *"a
webhook with a bad signature is rejected before its body is parsed"* — and an
ordering claim is only provable if we control the order. `signature.ts` is
thirty lines of `node:crypto` and `signature.test.ts` proves the claim the only
way it can be proved from outside: hand it a body that is neither signed nor
parseable, and the error it raises is the signature's.

**The cost, stated plainly.** We now own the response shapes we read and the
API version we pin, and a Stripe change to either is ours to notice. Two things
bound it: the read shapes are declared narrow, so each one documents a field
this product depends on Stripe continuing to send; and the version is pinned in
code rather than inherited from whatever the dashboard is set to, so it cannot
be changed by someone who is not deploying. Interop with real Stripe is
unprovable from here and is the gate walk's job — no test in this repo asserts
it, and none pretends to.

## Decision 3 — A lapse is a derivation, not a write

M21 link 4 says the webhook is the sole writer. M21 link 5 says a lapse runs
*"through M20's existing resolver, with no separate downgrade path to keep in
sync"*. M21 link 6 sets a grace window of **3 days from the decline** — shorter
than Stripe's own retry schedule, so the account lapses while Stripe is still
retrying.

Those three look like they conflict, because the window ending is an event
nothing sends. If it had to be written down, something other than the webhook
would have to write it, on a schedule, three days after a moment nobody is
watching.

So it is not written down. The row keeps saying exactly what Stripe last said,
and what that **means** is computed against the clock at read time
(`standing.ts`). Nothing to schedule, nothing to miss, and no second copy of
the answer to drift. Three consequences, and all three are properties we wanted
anyway:

- **A card fixed inside the window costs the account nothing**, because nothing
  was taken away — there was no lapse to undo, only a status that went back to
  `active`.
- **A later successful retry restores a lapsed account through the ordinary
  webhook path.** Nothing special-cases it.
- **`GRACE_WINDOW_DAYS` is one constant with three readers** — the resolver,
  the copy the person reads, and the test — which is what M21 link 6 asks for,
  and it matters because 3 days is a guess that first contact with real
  declines will want to revise.

`users.plan_id` therefore moves on a purchase and on a **definitive** end
(`canceled`, `unpaid`, `incomplete_expired`) and not when a window closes. The
subtly wrong version — writing `free` the moment a subscription stops
conferring — is the one that would have needed the scheduler.

## Consequences

- One more module under `src/server/`, with its own store and no reach into
  planning. `moduleBoundary.test.ts`'s rule for Entitlements applies here by
  the same argument: Billing knows what a plan id is and nothing about a trip.
- **Two tables that nothing may sweep**, for two different reasons.
  `entitlement_grants` because the trial is one time ever;
  `billing_events` because the row *is* the idempotency guarantee, and deleting
  old rows re-opens replay for exactly the events old enough that nobody is
  watching.
- A price change is a **new plan version**, and there is no mechanism to move
  an existing subscriber onto one. *What you bought is what you get.*
- The consistency between what a page says and what a card is charged is
  checked in one place (`prices.ts`) and nowhere else, because a divergence
  errors nowhere and is the worst class of billing bug.
