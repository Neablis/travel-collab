# M10 — Visual craft pass

**Status:** Not started. Phase 2, after M9.

## Why this is separate, and why it is here

M5 was a full design milestone — tokens, a documented palette, shadcn adoption,
three waves, a re-skin of every surface — and Mitchell still does not like how
the product looks or feels. That is not because it was done badly. **M5 answered
"is it consistent." The open question is "is it obvious," and then "is it
beautiful."** Three different questions; running the first one twice does not
answer the other two.

So the work is split deliberately:

- **"Is it obvious"** is interaction design and lives inside **M8** and **M9**,
  inseparable from the features it shapes.
- **"Is it beautiful"** is this milestone.

It comes *after* M9 rather than before because M9 adds an entire new interaction
surface — conversation, streaming progress, a proposal diff. M5's own history is
the argument: Wave 1's re-skin was partly redone in Waves 2 and 3 because the
layout moved underneath it. Polishing before the surface inventory is stable
means polishing twice.

**Accepted cost:** the product stays visually unsatisfying through M8 and M9.
The alternative considered and rejected was slotting this immediately after the
Phase 1 gate, where the single-player structure is settled but M9's surfaces do
not exist yet.

## Scope

- A craft pass over the stable surface inventory, driven by the existing
  design-sync project **"travel-collab UI baseline"** — set up in M7 explicitly
  as an accurate baseline to iterate *away from*, not to preserve.
- Revisit the M5 aesthetic decisions with real usage behind them, including
  whether "Field Kit" is still the right direction.
- Motion, density, and hierarchy — the things a token pass cannot reach.
- Clear the accumulated cosmetic debt: **KI-2** (money formatted two ways in the
  same screen), **KI-3**, **KI-4**.

## Exit gate

- [ ] Every surface reviewed against the chosen direction, with before/after
      captured.
- [ ] KI-2, KI-3, KI-4 closed or explicitly re-deferred with a reason.
- [ ] No behavior change: zero diff to `packages/`, `src/server`, and the API
      routes. Presentational only — the M5 Wave-1 rule, which M5 Wave 2 had a
      documented reason to break and this milestone does not.
- [ ] Retro appended at gate close.
