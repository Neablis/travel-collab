# Phase 5 — Prune to the minimum set that catches regressions

> **SUPERSEDED 2026-08-31. Do not execute this phase.**
>
> Its required precondition — a fresh Phase 0 inventory — was run on
> 2026-08-30 (`phase-5-inventory-2026-08-30.md`) and found the criteria below
> no longer describe this tree. Category (c) is empty, (a) is 7 assertions,
> (b) is 60, and (d) — the big lever, claimed at 152 tests — is **nine false
> positives**. `TripBoardScreen.test.tsx`, named below as the flagship case at
> "581 lines", is now 1,579 lines with 292 comment lines organised into
> intent-scoped describes. Read the inventory, not this file, and note in
> particular the two recorded false positives (`MapLens` and category (d))
> which exist so the same seductive heuristic is not re-derived and mis-cut.
>
> Kept for the reasoning and the safety protocol in Task 5.3, which remain
> correct and should govern any future prune.

**Do not start this phase until 0–4 have landed AND M10 Wave 2's gate has
closed** (see the index's Sequencing section). Two reasons: you are deleting
tests on the strength of the layers beneath them, which Phases 3 and 4 make
trustworthy — and M10 Wave 2 Phases 5–8 rewrite eight of the components whose
tests this phase would otherwise prune twice.

**Re-run the Phase 0 inventory against the post-M10 tree before executing.**
M10 will have added tests of its own; the verdicts must describe the tree in
front of you.

**There is no deletion target. Apply the criteria and report the number.**
(Decision, Mitchell, 2026-08-23.) The earlier draft of this plan carried a
"≥35%" figure; it was removed deliberately, because a quota is exactly the
pressure that pushes a cut past what the safety protocol in Task 5.3 supports.
Run every file through the criteria below, execute what they call for, and
state the resulting count change in the PR — up, down, or flat.

The one hard floor is **`packages/domain` coverage must not drop.** That is a
measured gate, not a judgment call.

**Where the bloat is.** `apps/web` carries 11,341 lines of test against 13,369
lines of source — 85%. `packages/domain` carries 2,259 against a far smaller
surface and runs in 2.6s. The domain suite is not the problem; it is the model.
**Almost all cutting happens in `apps/web/src/components`.**

---

## Task 5.1 — Cut the four categories that are always safe

Work the Phase 0 inventory. These four verdicts need no case-by-case argument
because the coverage they claim is either false or held elsewhere:

### (a) Tests of the framework, not of us

```ts
// ui/primitives.test.tsx — real example
it("Heading renders the semantic tag in the display face", () => {
  render(<Heading level={2}>Trips</Heading>);
  expect(screen.getByRole("heading", { level: 2 }).tagName).toBe("H2");
});
```

This asserts that a one-line wrapper around `<h2>` renders an `<h2>`. It cannot
fail without the wrapper being deleted, which TypeScript catches. Same species:
"Radix opens the dialog", "the link has an href", "the button calls onClick".

### (b) `className` assertions

```ts
expect(screen.getByRole("button", { name: "Add activity" }).className).toContain("bg-brand");
```

Nine `src/components/ui/*.test.tsx` files (424 lines) are substantially this.
These test Tailwind's output and break on every restyle — the exact "breaks on
small changes" complaint. The design-system contract is **already enforced by
`scripts/check-color-wall.mjs`**, which is a better mechanism: it is exhaustive,
it is a lint, and it does not need a jsdom world.

**Delete every `className` assertion.** Where one genuinely encodes a
behavioral contract (a disabled state, an error state), assert the *behavior*
instead — `toBeDisabled()`, `toHaveAccessibleDescription()`,
`aria-invalid` — which is both more robust and more accessible.

### (c) Re-proofs of domain rules through the UI

Any component test that constructs a conflict/cost/date scenario and asserts
the *rule's* outcome is re-testing `packages/domain` through three extra
layers. The component's job is to render what it is given. Assert the component
renders a conflict it was handed; do not assert that two overlapping activities
produce one.

Phase 2's scenario factories make this cut mechanical: if the test needs
`scenarios.overlappingDay()` to *derive* a conflict, it is a domain test; if it
takes a trip that already has one, it is a component test.

### (d) Per-prop render tests

Files with N tests that each render once and assert one prop's effect. Merge
into one test that walks the component through a real sequence. `Sparkline.
test.tsx` (235 lines), `DayChips.test.tsx` (181), `TripViewTabs.test.tsx` (113)
are shaped like this — verify against the inventory before cutting.

## Task 5.2 — Merge the survivors into flow tests

For each remaining component, ask: **what is the one sequence a user performs
that, if broken, matters?** Write that as a single test using Phase 2's
scenarios, and delete the fragments it subsumes.

`TripBoardScreen.test.tsx` at 581 lines is the flagship case. It almost
certainly contains several near-duplicate renders differing in one prop.
Consolidate to a handful of flows — open a trip, move a stop, see the conflict,
dismiss it, undo — each of which is worth more than the fragments and reads as
documentation of the feature.

**Keep tests separate when they assert genuinely independent failures.** A flow
test that dies at step 2 tells you nothing about steps 3–7, so a 40-step
mega-test is its own antipattern. Rule of thumb: one flow per *user intent*,
not one flow per component.

## Task 5.3 — The safety protocol (this is what makes the cut defensible)

Deleting tests is easy; deleting only redundant tests is the job. Three checks,
in order:

**1. Domain coverage must not drop.** Re-run Phase 0 Task 0.4's coverage
measurement after each batch. `packages/domain` line and branch coverage is a
hard floor. This is cheap and catches the worst mistakes.

**2. Mutation spot-checks on the load-bearing modules.** Coverage says a line
ran; it does not say a test would have noticed it change. Run
[StrykerJS](https://stryker-mutator.io/) against a *narrow* target — not the
whole repo, which would take hours for little benefit:

- `packages/domain/src/trip/decide.ts`
- `packages/domain/src/trip/evolve.ts`
- `packages/domain/src/trip/conflicts.ts`
- `packages/domain/src/trip/diff.ts` (KI-1's home)

Record the mutation score before and after the prune. [The retention criterion
is that removing a test must not produce a surviving
mutant](https://arxiv.org/pdf/2301.13615) — if the score drops, you cut
something load-bearing; put it back.

**Do not add Stryker as a CI job.** It is a one-off measurement instrument for
this phase. A permanent mutation-testing gate is a new tax, and this plan is
about removing taxes. Note the before/after scores in the phase's commit so a
future session can re-measure without re-deciding.

**3. The delete-and-confirm-red drill, for anything you are unsure about.**
Before deleting a test you think is redundant, break the code it claims to
protect and confirm *another* test goes red. If nothing else fails, the test is
not redundant — keep it. This is slow, so use it on the ~10 judgement calls,
not the 200 obvious ones.

## Task 5.4 — Cut e2e only where it is genuinely duplicative

The e2e layer is 15 tests. **It is not the bloat and should mostly survive** —
`AGENTS.md`'s "one happy-path script per milestone, kept green forever" is a
good rule and these are the tests Phase 5 is spending to justify unit cuts.

Two exceptions worth checking:

- `m7-solo-delight.spec.ts` has 3 tests in 217 lines and `m6-optimistic.spec.ts`
  has 2 in 78. If any assert something a component test now covers better
  (and faster), move it down a layer.
- Overlap between `m1-board` (drag) and `m10-unscheduled-rack` (drag) — both
  exercise `dragCardTo`. Keep both if they cover different drop targets; merge
  if they do not.

Net e2e change should be roughly zero, possibly +1 from Phase 3's
`responsive.spec.ts`. **A shrinking e2e layer during this phase is a red flag**,
not a win.

## Task 5.5 — Delete the dead scaffolding the cuts expose

Once the tests are gone, their support code often is too. Check and remove:

- `src/mocks/handlers.ts` entries no test uses any more (MSW handlers outlive
  their tests silently).
- `preview-fixtures.ts` files that only existed to feed deleted tests — but
  **check `preview-registry.ts` first**: some feed the in-app `<Preview>`
  treatment and are production code.
- `vitest.setup.ts` shims (`setViewportMatches`, `triggerResize`) if nothing
  calls them any more. If something still does, leave the comments intact —
  `triggerResize`'s "do not reintroduce the IntersectionObserver fixture that
  fed fabricated positions" note records a real bug and must survive.

---

## Exit checklist

- [ ] Every Phase 0 inventory row with a `cut`/`merge` verdict executed, or
      re-argued in writing if kept.
- [ ] The resulting test-count change reported in the PR, whatever it is. No
      target was set and none should be inferred from the numbers in the index.
- [ ] `packages/domain` coverage flat or up.
- [ ] Mutation score on the four domain modules flat or up; before/after in the
      commit message.
- [ ] Full suite green: unit, int, and `test:e2e:ci-like` twice.
- [ ] Unit suite wall time re-measured — this is where the second big speedup
      lands, since fewer jsdom files is the other half of Phase 1's argument.
- [ ] No orphaned MSW handlers, fixtures, or setup shims left behind.
