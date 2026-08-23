# Phase 4 — Kill KI-13, the flake that makes every other signal untrustworthy

**Closes KI-13.**

**Why this gets its own phase.** KI-13 is not just slow tests — it is the reason
nobody can believe a red run, and that belief is what Phase 5 spends. The entry
itself names the real cost: *"a red `pnpm check` that is usually noise trains
everyone to wave it through — which is precisely how a real regression ships."*
KI-1 is the proof: a genuine correctness bug in the most-trusted subsystem sat
labelled "possible flake" for two weeks.

**What is already known — do not re-derive any of this.** Three independent
observations, one symptom:

| Date | Cause found | Signature |
|---|---|---|
| 2026-07-26 | fresh `CI=true pnpm install`, cold transform caches | `environment 701s`, 9 failures then 2 |
| 2026-07-28 | *could not reproduce* on a warm 10-core machine | 3/3 pass in ~10s, even with all cores saturated by spin loops |
| 2026-08-16 | an external CPU hog (a game at 85.8% CPU) + concurrent Claude sessions | `environment` elevated 8–30×, different random 6–9 failures each run |

Every failure is a generic `Test timed out in 5000ms` inside a `waitFor` /
`findByText`. **The symptom is wall-clock starvation of `waitFor` budgets.**
The 07-28 non-reproduction is the important data point: on a fast, idle machine
with warm caches the suite is fine, which is why this was never fixed — the bug
only exists when the machine is loaded, and CI (so far) is not.

---

## Task 4.1 — Reproduce it deliberately

You cannot fix a timing bug you cannot summon. Build the reproduction first:

```bash
# saturate the box, then run — this is the 2026-08-16 condition, on purpose
for i in $(seq 1 $(nproc)); do (while :; do :; done) & done
pnpm --filter web exec vitest run -c vitest.unit.config.ts --reporter=dot
kill %$(jobs -p | wc -l) 2>/dev/null; jobs -p | xargs -r kill
```

Record: does it fail? which files? what is `environment`? If it does **not**
fail under full CPU saturation, Phase 1's environment split may have already
fixed it by removing 35 jsdom worlds' worth of contention — in which case
verify that hypothesis by re-running against the pre-Phase-1 config, and close
KI-13 with that as the finding.

Script this as `scripts/repro-ki13.sh` so the next person confirming the fix
runs one command instead of reconstructing the conditions.

## Task 4.2 — Fix the cause, not the budget

Three candidate fixes, in descending order of preference. **Raising every
`waitFor` timeout is not on this list** — KI-13's own "why it isn't fixed" note
is right that it hides genuine regressions, and it treats the symptom.

1. **Remove the wait entirely where it is spurious.** Audit every `waitFor` and
   `findBy*` in the suite. A large fraction of them wait for something that is
   already synchronous by the time the assertion runs — a leftover from an
   earlier async shape. `findBy*` on already-rendered content costs a full
   MutationObserver cycle for nothing. Phase 0's inventory flags these; this is
   where the durable win is, and it makes the suite faster as a side effect.

2. **Fake timers for anything genuinely time-based.** Components with debounce,
   toast auto-dismiss, or polling should not be tested against the wall clock.
   Vitest's [`fakeTimers`](https://vitest.dev/config/faketimers) plus
   `user-event`'s `advanceTimers` option removes the budget from the equation:

   ```ts
   vi.useFakeTimers();
   const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
   // ...
   await vi.advanceTimersByTimeAsync(300);   // the debounce, not 300ms of real life
   ```

   Known candidates: `debounce.test.ts`, `toast.test.tsx`, `SyncIndicator`,
   `LocationInput` (geocode debounce), `MoneyInput`. `MoneyInput.test.tsx` is
   the file KI-13 recorded at **11,675ms inside a full run vs 191ms alone** —
   it is the canonical case.

3. **Only then, a floor on the timeout** — and if you get here, set it once
   globally in `vitest.unit.config.ts` (`testTimeout`) with a comment naming
   this phase, never per-test. A per-test bump is invisible to the next reader
   and accumulates.

## Task 4.3 — Make a flake impossible to mistake for noise

The standing rule KI-13 needs is not a config value, it is a decision
procedure. Write it into the guidelines (Phase 7) and enforce what can be
enforced:

- **Run the unit suite with `--retry=0`.** Never retry unit tests. Unlike e2e
  (where one CI retry produces a *labelled* flaky result), a retried unit test
  just hides a real timing dependency.
- **CI records `environment` time** for the unit job. A run where `environment`
  is 5× the recorded baseline is a machine problem, and the job should say so
  in its output rather than leaving the reader to guess. A tiny reporter
  wrapper or a `grep` on the footer is enough.
- **The rule, stated for a future agent:** a `fast-check` failure that
  reproduces from its own seed is a bug report, not noise. A generic
  `Test timed out in 5000ms` on a machine whose `environment` time is
  elevated is a machine problem. Anything else is a bug until proven
  otherwise. KI-1 and KI-13 are the two worked examples of getting this call
  wrong in each direction — cite both.

## Task 4.4 — Prove it, three times

KI-13's mitigation says *"do not trust a single `pnpm check` exit code."* The
fix has to clear the bar that advice sets:

- [ ] `pnpm check` green **3 consecutive runs** on an idle machine.
- [ ] `pnpm check` green **3 consecutive runs** under `scripts/repro-ki13.sh`'s
      full CPU saturation.
- [ ] Green immediately after a cold `CI=true pnpm install` with caches
      cleared — the 2026-07-26 condition, the one that has never been
      deliberately re-tested.

All three, or KI-13 stays open with the new findings appended. This entry has
been "probably environmental" twice already.

---

## Exit checklist

- [ ] `scripts/repro-ki13.sh` exists and reliably reproduces the failure on the
      pre-fix config (or the phase records why it no longer can).
- [ ] Spurious `waitFor`/`findBy*` calls removed; time-based components moved
      to fake timers.
- [ ] `MoneyInput.test.tsx` runs in roughly its isolated time inside a full run.
- [ ] Unit suites run with zero retries; CI surfaces `environment` time.
- [ ] The three-times-green proof above, all conditions.
- [ ] **KI-13 moved to Resolved** with the actual root cause recorded — or kept
      open with the new evidence, honestly. Do not close it on one green run.
