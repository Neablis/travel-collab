# M19 — A cost knows who and what it is for

**Status:** Approved 2026-08-31 by Mitchell. **Minted, not placed** — creating
it was the decision; where it runs in the order is a separate one.

**Opened by:** M11b's gate sweep of `preview-registry.ts`. Two shells,
`cost-estimate-state` and `budget-breakdown`, had been tagged M11 since M10 and
are not M11's work — they are blocked on cost fields that do not exist. Asked
where to retag them, Mitchell's answer was that they do not belong to an
existing milestone at all:

> *"mint a milestone around cost overhaul, atm it does feel very much like a
> tacked on concept, we could have something more akin to splitting cost, see
> cost per person based on whos attached to what activity and better sharing
> cost in the shared day ui. More to say theres a lot more we can do there that
> we havent and that can be part of the milestone"*

## Why this exists

The entire cost model is one optional scalar:

```ts
Money = { amountMinor: number, currency: string }   // packages/contracts/src/money.ts
cost?: Money                                        // on an activity
budget: Money | null                                // one number, on a trip
budgetRemaining = budget − total                    // detail.ts
```

M4 shipped that and nothing has revisited it. Three things follow, all true in
`main` today.

### 1. `budgetPerPerson` has no person in it

`apps/web/src/lib/savedDayFacts.ts` computes the number M11b's shared-day rail
renders as what a day costs *each*:

```ts
for (const stop of stops) { ... amountMinor += stop.cost.amountMinor; }
budgetPerPerson: { amountMinor, currency }
```

It is a **plain sum of the day's stops**. Nothing divides by anybody, because
there is nobody to divide by. The field name asserts a per-person semantic that
the computation does not have, and it is only right at all under an unwritten
assumption — that a price entered on a stop is already a per-person price.
Nothing states that assumption and nothing enforces it, which is this repo's
named defect class (KI-1, KI-14): an invariant asserted by a name with no test
behind it.

This is the concrete form of "tacked on". It shipped in M11b and is live.

### 2. Nobody is attached to an activity

Grep `packages/contracts/src/activity.ts` for `attendee`, `participant`,
`assignedTo` — nothing. A trip has members (M11 shipped roles and invites), but
an **activity** has no relationship to them. So "cost per person based on who's
attached to what activity" is not a computation waiting to be written; the
field it would read does not exist.

`add-stop-who` (`preview-registry.ts`, tagged M13) describes the same absence
from the other side: *"per-stop attribution — no field records who a stop is
for."* Whichever milestone lands participation, both surfaces unblock together.

### 3. A cost has no kind and no state

The two shells this milestone was minted for:

| Shell | Blocked on |
|---|---|
| `cost-estimate-state` | a confirmed-vs-estimate flag per cost |
| `budget-breakdown` | Booked / Holds / Travel / Other — nothing classifies a cost |

`ActivityKind` already carries `booked`/`hold`/`idea`/`transit` for the **stop**
(M18), and `activity.ts` explicitly warns against a second field that could
disagree with it. So the classification question here is genuinely open: does a
cost inherit its category from the stop's kind, or does a cost carry its own?
That is a design decision this milestone must make rather than assume — the
M18 comment is the argument for inheriting, and a stop with two costs of
different kinds is the argument against.

## Scope

Five links. The first two are contract-and-migration work; the rest stand on
them.

1. **A cost knows what kind of thing it is.** Booked / Holds / Travel / Other,
   or inheritance from `ActivityKind` — decided, not assumed. Unblocks
   `budget-breakdown`.
2. **A cost knows whether it is settled.** Confirmed vs estimate, so a trip
   total can say what is committed and what is still a guess. Unblocks
   `cost-estimate-state`.
3. **An activity knows who it is for.** Participation against the trip's
   existing members. Also unblocks `rack-provenance` and `add-stop-who` if it
   carries provenance with it — coordinate with M13 rather than building twice.
4. **Cost splits.** Even split, per-head, or one payer — derived from link 3,
   never a second hand-maintained number. `budgetPerPerson` becomes true or is
   renamed.
5. **The shared-day cost presentation.** M11b's rail says "budget each" from a
   sum; with links 3 and 4 it can say what it actually means, and Discover's
   budget-band filter can band on something real.

## Explicitly not here

- **Currency conversion.** ADR-008 makes currency trip-level; multi-currency
  trips are their own problem and `savedDayFacts` already refuses to add across
  currencies rather than guess.
- **Payments, settling up, or anything that moves money.** This models what a
  trip costs and who owes what. It does not collect.
- **Per-person budgets at trip level.** The trip's single `budget` stays one
  number until links 3 and 4 prove what a per-person one would mean.

## Exit gate

Not written — this milestone is minted, not scoped. Writing the gate is part of
placing it, and the shape of links 1 and 3 (inherit vs carry; participation in
this milestone vs M13) has to be decided first.

**Two boxes are already known**, because they are why it exists:

- [ ] `cost-estimate-state` and `budget-breakdown` are wired up or deleted — no
      M19-tagged entry remains in `preview-registry.ts`.
- [ ] `budgetPerPerson` either divides by a real person count or no longer
      claims to, and a test fails if that stops being true.

## Prerequisites

**Link 3 overlaps M13.** M13 owns collaboration and already holds
`add-stop-who`. Whether participation lands here or there is a placement
decision, but it must land in exactly one — two milestones each adding a
per-stop person field is the drift `AGENTS.md` invariant 5 exists to stop.

**Nothing else blocks it.** Trip members, roles and the money primitives all
exist; this milestone adds fields to them rather than needing anything new
underneath.
