# ADR-008: Money as integer minor units, single currency per trip

**Status:** Accepted — 2026-07-10; amended 2026-09-07 (see the Amendment)
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

M4 adds costs on activities, a trip budget, and cost rollups to per-day
subtotals and a trip total (foundation §6). Two representation questions must be
settled before any cost is stored, because **events are forever** (AGENTS.md):
the shape chosen here is written into `events.payload` jsonb permanently and into
the `trip_details` projection guarded by the golden rebuild test.

1. **How is a money amount represented?** Floating-point money accumulates
   rounding error under repeated addition — unacceptable for a stored projection
   that must rebuild bit-identically from the log (Invariant 2). A money value
   also needs to record *which* currency it is, or a total is meaningless.

2. **How many currencies does a trip have?** Real trips incur costs abroad.
   Supporting arbitrary per-cost currencies means converting them into one
   display currency for the rollup, which drags in an FX-rate source and the
   "which rate, as of when?" problem — a stored, replayable projection cannot
   call a live rate API (same purity constraint as ADR-006).

Options weighed for representation: **(A)** integer minor units + an ISO-4217
code; **(B)** a decimal string; **(C)** a floating-point number. Options weighed
for scope: **(S1)** one currency per trip, conversion deferred; **(S2)**
multi-currency now with an injected FX oracle; **(S3)** no trip currency — each
cost carries its own, totals grouped per currency.

## Decision

**Representation: A — integer minor units + ISO-4217.**

```ts
Money = { amountMinor: int ≥ 0; currency: /^[A-Z]{3}$/ }
```

`amountMinor` counts **hundredths of the currency unit, for every currency** —
cents for USD/EUR, and hundredths of a yen for JPY, *not* whole yen. All
arithmetic — rollups, budget deltas — is integer addition/subtraction: exact,
deterministic, and safe under the golden rebuild. Every `Money` is
self-describing via its `currency`.

> **Amended 2026-09-07.** This paragraph said "the currency's smallest unit
> (cents for USD/EUR, whole yen for JPY)", which no code has ever done: every
> writer multiplies by 100 and every reader divides by 100 regardless of
> currency. See the Amendment below for what that cost and why the ADR moved
> to the code rather than the other way round.

**Scope: S1 — single currency per trip, conversion deferred.**

`TripState.currency` is a plain string defaulting to `"USD"` (the default is
applied in `evolve` at `TripCreated`, never stored in that event) and changed by
a new `SetTripCurrency` / `TripCurrencySet` event (modeled on
`SetTripStartDate`). Every cost the UI emits is in the trip currency, so the
rollup sums `amountMinor` directly with no conversion. `Money` **still carries a
`currency` code** even though the trip is single-currency, so the stored data is
already multi-currency-shaped.

**Rollups are derived, not stored** (a direct consequence, recorded here): a pure
`rollupCosts(state)` computes the subtotals/total, exposed on `TripDetail`; no
total is ever an event or a stored state field. This is the `deriveDayDates`
precedent from M3.

## Consequences

- **Exact, replayable money.** Integer math means the rebuilt projection equals
  the stored one to the unit; the golden rebuild test stays meaningful for costs
  and the budget.
- **Multi-currency is additive later, not a rewrite.** Because every stored cost
  already records its currency, enabling multi-currency is: add an injected
  FX-rate oracle (the ADR-006 `ConflictContext` shape — a deterministic,
  offline-at-rebuild source), a per-cost currency picker, and a per-currency or
  converted rollup. No stored data migrates. Recorded constraint: any future FX
  source, like the holiday oracle, must be deterministic at rebuild time.
- **A trip currency change does not convert existing amounts** in M4. The
  `amountMinor` values are unchanged and re-presented under the new code — a
  known single-currency simplification, acceptable because the demo/dogfood flow
  sets the currency before entering costs.
- **Two decimals everywhere, input and display alike** (amended 2026-09-07;
  this read "Display carries a 2-decimal assumption in M4 … a currency-exponent
  map (JPY = 0, BHD = 3) is a noted follow-up"). The money input divides typed
  input by 100 and the planning prompt tells the model to multiply by 100, for
  every currency, so 2 decimals is not an assumption display makes on its own —
  it is the representation. Formatters must therefore say
  `minimumFractionDigits: 2` rather than let `Intl` apply the currency's ISO
  exponent. A currency-exponent map is still a possible follow-up, but it is a
  change to the **input and the prompt** first and the formatters second; the
  **stored** shape supports any exponent, so it remains a data-preserving
  change if a non-decimal currency ever becomes a real use case.
- **New trip-attribute events.** `TripCurrencySet` (and M4's `TripBudgetSet`)
  follow the established `TripStartDateSet` pattern — diffable, undo/revert-
  correct via ADR-005 with no new machinery.

## Amendment (2026-09-07) — `amountMinor` is hundredths for every currency

This ADR said `amountMinor` counts *the currency's* smallest unit, "whole yen
for JPY". **No code has ever done that**, in either direction:

- `apps/web/src/components/board/MoneyInput.tsx` stores `Number(trimmed) * 100`
  whatever the trip currency is;
- `apps/web/src/server/ai/planningTools.ts` tells the model to "multiply a
  decimal amount by 100", with no currency condition;
- every reader divides by 100 — `packages/domain/src/trip/conflicts.ts`,
  `apps/web/src/components/lenses/formatMoney.ts`, `packages/pages/src/format.ts`.

No stored value is or was numerically wrong: the round trip is consistently
×100 in, ÷100 out, so the projection and the golden rebuild are unaffected. The
prose was simply false, and it cost something concrete — the notebook's
formatter (`packages/pages/src/format.ts`) handed the amount to `Intl` with no
fraction-digit option, so `Intl` applied ISO 4217's exponent, which for JPY is
0. The same stored field then rendered **`¥1,235` in a notebook cost widget and
`¥1,234.56` on the board**; for 150, `¥2` against `¥1.50`
(KI-2026-09-05-y / F-G04, from the 2026-09-05 overnight review).

**Decision: the code is right and the ADR was wrong.** `amountMinor` is
hundredths for every currency; the ADR now says so, and
`packages/pages/src/format.ts` passes `minimumFractionDigits: 2` so the two
surfaces agree. `packages/pages/src/format.test.ts` pins the JPY output against
the board's, and `apps/web/src/components/lenses/formatMoney.test.ts` pins the
same values from the other side.

**Rejected: currency-aware minor units.** Making JPY genuinely zero-exponent is
not a formatter change — it is the money input, the planning prompt, both
formatters and the interpretation of every already-stored JPY amount. This app
is single-currency per trip with a seven-currency picker, none of them
non-decimal; a real non-decimal currency is the event that should reopen this,
and the stored shape still supports any exponent when it does.
