# ADR-045: Entitlements is a module with two stores — the file says what a plan is, the table says who holds what

**Status:** **Accepted — 2026-09-13.** Mitchell's decision the same day to run M20 and M21
next, ahead of M9's remaining work, is what opens the milestone this ADR is a prerequisite
for; kicking off that branch against this ADR is the acceptance.
**Deciders:** Mitchell (product/eng); Claude (architect) — drafted
Related: ADR-003 (the event log is scoped — Identity/Access/Community are ordinary CRUD, and
this module joins them), ADR-019 + its 2026-08-25 and 2026-09-08 amendments (entitlement is
**not** a flag; the kill switch and the gateway chokepoint are unchanged by this),
ADR-024 (the Edge proxy has no database), ADR-025 (`users` exists and sessions stay JWT-only),
ADR-043 (the assistant is a kernel — the `TurnLedger` this module's cost ledger stores)
Milestones: **M20** — `docs/milestones/M20-account-tiers-and-entitlements.md`;
**M21** — `docs/milestones/M21-subscriptions-and-billing.md`
Module map: `AGENTS.md` — this ADR adds the **Entitlements** row.

## Context

`AGENTS.md`'s module map is structural law, and M20 adds a module to it. M20's own
prerequisites say so and say why it must be settled here rather than mid-build:

> **An ADR, due before the milestone opens — not written mid-build.** `AGENTS.md`'s module
> map is structural law and this adds a module to it: **Entitlements** — owns plans, grants
> and capability resolution; CRUD with audit fields; and, like Identity, **explicitly does
> not know what a trip is.**

Three facts about the code as it stands, and none of them is a gap to be filled casually:

1. **The seam has been waiting since M16 and is deliberately not a flag.**
   `apps/web/src/server/ai/modelSelection.ts:88` declares `AiEntitlementCheck`, `:89` stubs
   it `EVERYONE_IS_ENTITLED`, and `:47` records the intended shape — *"the day a pro-tier
   check exists it lands inside `isEntitled` below, not as a signature change."*
2. **Sessions cannot carry entitlement.** ADR-025 keeps JWT sessions; `authConfig.ts:124-138`
   puts an id in the token and nothing else. ADR-024 leaves the Edge proxy without a
   database, and its matcher covers no `/api` path (`proxy.ts:131-133`).
3. **Plan definitions are a committed file, not a table** — Mitchell, 2026-09-02:
   *"Lets keep entitlements being a static file thats commited to change with versioning,
   but the admin ui just shows whats currently live."* That amendment removed the
   `plan_versions` table from M20 after the milestone was scoped around one.

Fact 3 is what makes this ADR necessary rather than clerical. A module that reads its
definitions from git and its holdings from Postgres owns **two stores of different kinds**,
which is precisely the thing a module map exists to be explicit about. M20's prerequisites
name that as the question to answer here.

## Decision

**Entitlements is a module in `AGENTS.md`'s map**, alongside Identity, Trip Planning,
Access & Membership, History, Conflict Engine and Community:

| Module | Owns | Storage model | Explicitly does NOT know about |
|---|---|---|---|
| **Entitlements** | plans, plan versions, grants, capability resolution | committed file (definitions) + CRUD with audit fields (holdings) | trips, invites, days, activities, costs — anything travel |

Six rules follow, and each one exists because its opposite is the cheap move.

### 1. Two stores, and each is authoritative for exactly one question

- **The committed plan-version file is authoritative for *what a plan is*** — which
  entitlement strings and which ceiling numbers a named version bundles. It is immutable and
  append-only: changing a price, a quota or an entitlement **publishes a new version** and
  never edits a published one. The audit trail is git, and mutating a published entry shows
  up in a diff, which is a stronger guarantee than a table with a convention.
- **The grant table and the `users` columns are authoritative for *who holds what*** —
  `entitlement_grants` plus `plan` and `is_admin` on `users`. CRUD with audit fields, per
  ADR-003's scoping: this is not planning state and it is not event-sourced.

Neither store answers the other's question. A plan definition never records who holds it; a
grant never restates what it grants, only which version it pins.

### 2. The resolver reads both, on every request, from the database

`entitlementsFor(userId)` is the module's one entry point for reading. It resolves the
account's pinned version out of the file, unions the active grants out of the table, and
returns the effective set — **per request, never from the JWT and never in the proxy.** A
plan claim baked into a token lets a downgraded account keep paid access until the token
refreshes, which is an entitlement bug that reads as a billing bug. Facts 2 and 3 above make
this the only implementation available anyway; stating it here is what stops a later
"optimisation" from reintroducing the defect.

### 3. A pinned version reference must resolve, or fail loudly

A version string in a grant, a `users` row or (at M21) a `subscriptions` row is a **reference
into the committed file**. It must resolve to an entry, and a reference that does not resolve
is a startup-or-request-time error, never a silent fall back to the newest version and never
an empty entitlement set.

This is the one failure mode the 2026-09-02 move introduces, and it is the reason it is a
numbered rule: a table with a foreign key cannot lose the row a subscription points at, and a
file someone tidied can. Deleting a published entry is therefore forbidden by the same rule
that makes them immutable — append-only means entries are never removed either.

### 4. `can(ent, capability)` — a plan is a set, not a rank

Code asks `can(ent, "ai.ask")`. Nothing compares plans. `accessPolicy.ts:11`'s
`RANK = { viewer: 0, editor: 1, owner: 2 }` is the right shape for *roles inside one trip*
and the wrong shape here: Mitchell's requirement is that tiers are *"not necessarily subsets
— each have their own access and functionality."* A comparison operator anywhere near a plan
forces every later tier to be a superset of an earlier one, permanently, and it does it
quietly. The ladder a buyer sees is presentation; no authorisation path may read a display
order as authority.

### 5. Entitlements does not know what a trip is

It answers `can(account, "trip.collaborators")`. The **caller** knows that capability is
about invites. The string is an opaque token to this module — it owns the vocabulary, not the
domain meaning behind any member of it.

This is what keeps M20 link 6 (the collaboration gate) from being a boundary violation: the
gate lives in Access & Membership, reads a boolean from Entitlements, and Entitlements never
imports a trip type. Identity has carried the same rule since the map was written, and this
module is the second one that will be tempted to break it.

### 6. The vocabulary is code; the offers are data

`packages/contracts` owns the entitlement strings, because a capability no code checks is
meaningless and a check for a capability that does not exist must fail to compile. The plan
file owns which entitlements and which numbers each version bundles. Both are now code, so
both are typed — an entitlement string outside the contracts enum cannot reach a published
version, because it does not compile. That moves M20's "a typo must not silently grant
nothing" check from runtime to the type checker, which is strictly earlier.

## What M21 adds to this module, and what it must not

M21 makes a subscription real: Stripe checkout, the webhook, the portal, failed payments. Two
boundary rules, recorded here so the split survives contact with the implementation.

- **Division of authority.** The plan version is the source of truth for **what is granted**;
  Stripe is the source of truth for **what is charged**. They must agree, and a check asserts
  that every published priced version's `stripe_price_id` resolves to a Stripe Price with the
  same amount and currency. A divergence errors nowhere — the pricing page and the card
  statement simply disagree.
- **The webhook is the sole writer of subscription state**, and it writes only that. It
  creates no entitlement, moves no account between versions, and touches no gate. A checkout
  redirect is a hint, never a grant. Cancelling and lapsing both run through **this module's
  resolver** — there is no second downgrade path to keep in sync, which is the property that
  makes "access ends at the end of the paid period" a consequence of rule 2 rather than a
  feature someone has to remember to write.

## Consequences

**A price change costs a deploy.** Versions became data specifically so publishing would not
need one, and the 2026-09-02 amendment gives that up on the record. What it buys is the
removal of the entire publish path — a UI, its authorisation surface and its validation — none
of which now has to exist or be defended.

**Nothing implicitly re-reads the newest version.** There is no union with the latest, no
"highest wins", and no mechanism to move an existing account onto a newer entry. *What you
bought is what you get* is absolute, because the thing that would have moved you left M20
with the table. If widening a plan for existing subscribers is ever wanted — a price cut they
should get rather than a rise they should be spared — it returns as its own decision with its
own gate box.

**The resolver is on every authenticated request's path.** It reads one row set per request;
grants are few per account and the file is in memory. If that ever stops being cheap, the fix
is a request-scoped cache, never a token claim — rule 2 is about correctness, not cost.

**One module, two stores, is a documented exception rather than a precedent.** No other module
in the map reads its definitions from git. The justification is that plan definitions are
*offers*, which are reviewed, versioned and argued about in pull requests, and holdings are
*account state*, which is not.

## Alternatives considered

**A `plan_versions` table, as M20 was originally scoped.** Rejected by Mitchell 2026-09-02.
It keeps price changes deploy-free and gives referential integrity for rule 3 — but it needs a
publish UI, an authorisation model for it, and validation that a file gets from the type
checker for nothing. The immutability guarantee also weakens: a table enforces append-only by
convention, a reviewed file by diff.

**An entitlement claim in the JWT.** Rejected — fact 2, and the downgrade window in rule 2.

**Extending `AccessPolicy` rather than adding a module.** Rejected. `AccessPolicy` answers
"may this actor do this *to this trip*" and is Access & Membership's. Entitlements answers a
question with no trip in it. Fusing them would put the rule-5 violation in the type signature
on day one.

**Plans as a rank, with tiers as supersets.** Rejected — rule 4. It is what the product
*looks* like to a buyer and it is a one-way door in code.
