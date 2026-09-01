# M19 — A cost knows who and what it is for

**Status:** Approved and placed 2026-08-31 by Mitchell. **Runs last**, after
M9: `M11a → M11b → M17 → M12 → M13 → M14 → M9 → M19`.

Last is a real position rather than a shrug. Link 3 (who an activity is for)
overlaps **M13**'s `add-stop-who`, and running after M13 lets M13 land that
field while M19 builds splits on top of it — instead of two milestones each
adding a per-stop person field, which is the drift `AGENTS.md` invariant 5
exists to stop. Move M19 earlier and that link has to be reassigned, not
duplicated.

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

> **Update, 2026-09-01 (pull request 104): the misnomer is gone; the model is
> still M19's.** Mitchell, reading the shared-day rail: *"why are we
> calculating per person in a notebook? just show total cost there, any per
> person logic and math should go into the future milestone around cost."*
> `SavedDayFacts.budgetPerPerson` is now `totalCost`, `DiscoverDay`'s wire
> field renamed with it, and the Discover card no longer renders "$27.00
> each" — the field, its docstrings and every surface now state what the
> computation actually does, which is sum a day's priced stops in one currency.
> **Nothing was divided and no person count was introduced**; a test now pins
> the card's line as a total so the word cannot come back unnoticed. That is
> the *"or no longer claims to"* half of this milestone's own gate box below,
> left **unticked** because closing a gate is Mitchell's call, not a side
> effect of a rename. Everything else here is untouched and still M19's: a
> cost's kind, its settled-vs-estimate state, who an activity is for, splits
> derived from that, and the shared-day cost presentation.

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
   never a second hand-maintained number. The renaming half is done (see §1's
   2026-09-01 note); what is left is the real per-head number, which needs
   link 3 before it can exist.
5. **The shared-day cost presentation.** M11b's rail shows a bare sum of the
   day's priced stops and now says only that (§1's note); with links 3 and 4 it
   can say something richer, and Discover's budget-band filter can band on
   something more than a total.

## Explicitly not here

- **Currency conversion.** ADR-008 makes currency trip-level; multi-currency
  trips are their own problem and `savedDayFacts` already refuses to add across
  currencies rather than guess.
- **Payments, settling up, or anything that moves money.** This models what a
  trip costs and who owes what. It does not collect.
- **Per-person budgets at trip level.** The trip's single `budget` stays one
  number until links 3 and 4 prove what a per-person one would mean.

## Exit gate

Not written — this milestone is **placed but not scoped**, and those are
different things. Placing it fixed when it runs; the gate needs the shape of
link 1 decided first (does a cost inherit its category from `ActivityKind` or
carry its own), which is a design question nobody has answered yet.

**Two boxes are already known**, because they are why it exists:

- [ ] `cost-estimate-state` and `budget-breakdown` are wired up or deleted — no
      M19-tagged entry remains in `preview-registry.ts`.
- [ ] `budgetPerPerson` either divides by a real person count or no longer
      claims to, and a test fails if that stops being true.

## Prerequisites

**Link 3 overlaps M13, and the placement settled which way.** M13 owns
collaboration and already holds `add-stop-who` for the same missing per-stop
person field. M19 now runs **after** M13, so the expectation is that M13 lands
that field and M19 builds splits on top of it. What must not happen is both
adding one — that is the drift `AGENTS.md` invariant 5 exists to stop. If M13
ships without it, link 3 comes back here and this note is what says so.

**Nothing else blocks it.** Trip members, roles and the money primitives all
exist; this milestone adds fields to them rather than needing anything new
underneath.
