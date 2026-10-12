# ADR-071: A published plan may gain a permission that was free before — and nothing else

**Status:** **Accepted — 2026-10-11.** Mitchell, in session on M42 (PR 405 / part 8).
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-045** (entitlements is a module; *what you bought is what you get*; widening a plan
for existing holders "returns as its own decision with its own gate box" — this is that
decision, for one narrow case), **ADR-047** (billing without spending money),
milestone `docs/milestones/M42-the-front-door-shows-more.md` (D3, Mitchell's walk of part 7).

## Context

Leaving a playbook review (1–5 stars and a short note) is open to any signed-in account today;
nothing gates it but sign-in. Mitchell wants it on Plus and Premium only — "the cost keeps
spammers out". Reading reviews stays open, Free accounts' existing reviews stay, and **no paying
account may lose anything**.

ADR-045 makes a published plan version immutable and pins every holding to the version it was
bought on, with deliberately no way to move an account onto a newer version. So a new
`playbook.review` entitlement published only on new versions (plus@v2, premium@v3) would reach new
holders only: every current Plus holder (including every trial) and every Premium holder would
lose the ability to review the moment the gate shipped. The alternatives — moving holders onto new
versions, or one-off operator grants — are production data writes and mint new Stripe Prices on
first checkout. Gating on a permission paid plans already have (`ai.ask`) makes the tier the gate,
which ADR-045 rule 4 forbids.

## Decision

1. **A published plan version may be edited in place for exactly one kind of change: adding an
   entitlement that every account already had without one** — a capability that was ungated, now
   being gated, granted to existing paid versions so their holders keep it.
2. **Nothing else about a published version changes in place**: no price, no quota, no removal,
   no entitlement that was not previously free to everyone. Those still need a new version.
3. The edit lands in the same PR as the gate that makes the entitlement matter, so there is never a
   deploy where holders are gated without holding it.
4. `planVersions.noExtension.test.ts` and its frozen record are updated in that PR, and the test
   (or a sibling) asserts that each in-place change is an *added* entitlement, recorded with a
   reference to this ADR — so the exception cannot grow silently.
5. First use: `playbook.review` added to plus@v1, premium@v1 and premium@v2 (and to new versions
   going forward). Free has none of it; studio (disabled) is decided in the PR.

## Consequences

- Current subscribers keep reviewing with no migration, no Stripe change and no data write.
- *What you bought is what you get* still holds in the direction that matters: nobody gets less.
  What changes is that a paid holding can now *gain* something that was free when they bought it.
- M20's immutability gate box is amended by reference to this ADR.
