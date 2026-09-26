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

1. ~~**A cost knows what kind of thing it is.**~~ **Shipped outside M19,
   2026-09-26 — see the note at the end.** A cost inherits its stop's
   `ActivityKind` (Planned / Pending / Travel, M28's three), and the breakdown
   is the notebook widget "Spend by kind" (`cost.byKind`), not the Settings
   sheet's `budget-breakdown` shell, which is deleted.
2. **A cost knows whether it is settled.** Confirmed vs estimate, so a trip
   total can say what is committed and what is still a guess. Unblocks
   `cost-estimate-state`.
3. **An activity knows who it is for.** Participation against the trip's
   existing members. Also unblocks `rack-provenance` and `add-stop-who` if it
   carries provenance with it — coordinate with M13 rather than building twice.

   **Two relations, not one — Mitchell, 2026-09-03**, deferring M14's person
   widgets onto this link: *"we need activities to have owners (and i think
   participants that are going to that activity)"*. Who **booked** a stop is not
   who is **going** to it, and **link 4's splits need the participants, not the
   owner**. A single `assignee` field would satisfy `add-stop-who`'s wording and
   still be wrong for every split built on it.

   **This link also unblocks two Notebook widgets.** `w-person` ("what one person
   is in for") and `w-personline` ("a line for everything one person booked") left
   M14 on 2026-09-03 because this field does not exist —
   `docs/specs/2026-09-03-notebook-widget-catalogue.md`. They are not this
   milestone's to build, but they are what makes the participants half
   load-bearing rather than optional.
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
      M19-tagged entry remains in `preview-registry.ts`. *(Both are deleted as
      of 2026-09-26 and no M19 entry remains; left unticked because closing a
      gate is Mitchell's call.)*
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

## 2026-09-19 — one shell left, and the other is gone

From M26's design-parity survey (`docs/milestones/M26-design-parity.md`). Two
corrections to what this milestone believes it inherits.

*(Superseded 2026-09-26 — see "the breakdown shipped as a notebook widget"
below.)* **`budget-breakdown` is still shelled and still M19's.** It renders at
`SettingsSheet.tsx:342` and waits on a cost's **kind** — Booked / Holds /
Travel / Other — which no field classifies. The build deliberately keeps the
honest total, the meter and the over-budget banner **outside** the shell, so
what is shelled is exactly the part that would be invented.

**`cost-estimate-state` no longer exists as a shell.** It was deleted rather
than re-pointed, on the same grounds as `timeline-ghost`: SPEC §24 deleted the
surface it was waiting for. **The work did not go anywhere — M19 link 2 still
owns settled-vs-estimate** — but the seam that used to hold its place is gone,
so nothing in `preview-registry.ts` will remind anyone it is owed. That is the
whole reason this note exists.

**And a third consumer, from the map side.** SPEC §16 and the Map rail's
designed copy both split a leg into *on foot* and *by train or taxi*, and the
rail's total reads `… · N min moving`. Neither is derivable: `map-legend-modes`
is tagged **`unplaced`** because **no milestone owns per-leg transport mode**.
It is not cost, so it is not obviously M19's — but it is the same species as
link 1's cost *kind*: a classification a stop does not carry, blocking a
presentation that is already drawn. **Worth deciding at this milestone's
kickoff whether link 1 takes it or whether it stays unplaced**, rather than
letting a third milestone rediscover it. `routeLegs()` splits on
`kind === "transit"` as a coarser proxy that exists today; using it would state
something the data does not, and M26 declines to.

## 2026-09-26 — the breakdown shipped as a notebook widget

Mitchell, looking at the Settings sheet's `budget-breakdown` shell: *"Dont we
have everything to implement that now? Also Maybe that isnt the correct place
for it. Lets remove it there, and implement it as a PIE chart widget for
notebooks"*.

We did have everything. M28 (ADR-054) gave every stop one of three kinds —
`planned`, `pending`, `transit` — and link 1's open question ("does a cost
inherit its category from `ActivityKind` or carry its own") is answered
**inherit**, which is what `activity.ts` already argued for. The shell's
fourth category, *Other*, has no kind behind it and is gone.

- **Removed:** the mocked rows in `SettingsSheet.tsx` and the
  `budget-breakdown` entry in `preview-registry.ts`. The sheet's real total,
  meter, over-budget banner and unpriced count are unchanged.
- **Added:** the "Spend by kind" preset over a new `@tc/pages` primitive,
  `cost.byKind` (`macros/primitives/spendByKind.ts`) — a donut and a key of
  each kind's amount and share, filterable by day, dates, city and tag, in the
  trip's currency only (other currencies are named, `cost.chart`'s rule). It
  is in the insert rail and in the "Full trip breakdown" gallery template.

**What this does NOT take from M19:** a stop with two costs of different kinds
(the argument against inheriting) still has no model, and neither does
settled-vs-estimate (link 2). If `pending` later splits by *why* it is pending
(ADR-055's `pendingReason`: to book vs maybe), the widget's slices are the
place that split would show — not built here.
