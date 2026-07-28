// A property test that skips every generated case still reports ✓.
//
// This is not hypothetical. While auditing the domain on 2026-07-27, a probe
// for the revert round-trip passed 400 runs having executed **zero**
// assertions: one field was named `seq` where the contract says `toSeq`, every
// command was rejected, and a `if (!x) return;` guard swallowed the lot. It was
// only caught by counting. The existing property tests here have no guard
// clauses and so cannot fail this way today — this exists so the next one that
// grows a guard cannot either.
//
// Two distinct failure modes, both silent:
//   1. assertions never run (a guard skips every case)
//   2. the *input space* quietly shrinks — e.g. a generator drifts so almost
//      every command it builds is rejected and skipped, and the test keeps
//      passing while exercising a fraction of what it claims to.
//
// NOTE: intentionally duplicated across packages/domain, packages/pages and apps/web rather than
// extracted into a shared package — it is ~20 dependency-free lines, and a
// fifth workspace package is a structural change (AGENTS.md's module map) that
// should be a deliberate decision, not a side effect of adding a test helper.
export function witness(label: string) {
  let observed = 0;
  return {
    /** Call at the point the property actually asserts something. */
    tick(): void {
      observed += 1;
    },
    get count(): number {
      return observed;
    },
    /**
     * Assert the property did real work. Call after `fc.assert`.
     *
     * **Measure the floor, don't guess it.** A vacuity check that flaps is
     * worse than none — it retrains everyone to ignore red, which is the exact
     * disease this is treating. The first draft of these floors was guessed and
     * three of five flapped within 15 runs (`decide purity` observed 194-211
     * against a floor of 200). Rule: log the real count over a few runs, then
     * set the floor near **half** the observed minimum. Vacuity collapses a
     * count to ~zero, so half is plenty of signal and leaves room for
     * fast-check's run-to-run variance. A property with no guard clauses ticks
     * exactly `numRuns` times and can use that number exactly.
     */
    atLeast(min: number): void {
      if (observed < min) {
        throw new Error(
          `${label}: ran ${observed} assertion(s), expected at least ${min}. ` +
            `The property is passing vacuously — a guard clause is skipping ` +
            `cases, or the generator has drifted and is producing inputs that ` +
            `are all filtered out.`,
        );
      }
    },
  };
}
