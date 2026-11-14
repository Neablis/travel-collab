### KI-2026-11-11-b — e2e "Add › Trip from Home is Home's own button" intermittently finds no "New trip" dialog

- **Severity:** reliability. One desktop spec in an e2e shard fails after its retry, so `ci-ok` goes
  red on a PR whose code is fine; a re-run with no code change passes.
- **Area:** `apps/web/e2e/m41-command-palette.spec.ts` (the test at line 106, assertion at line 117),
  `HomeScreen.startNewTrip` (the *New trip* handler the `add trip` palette command reaches).
- **Symptom / What happens:** `[desktop] › e2e/m41-command-palette.spec.ts:106:1 › Add › Trip from
  Home is Home's own button` fails at line 117, `await expect(page.getByRole('dialog', { name:
  'New trip' })).toBeVisible()`: `Error: element(s) not found`, `Timeout: 5000ms`. Retry #1 failed
  the same way. The test creates its own trip, opens `/home`, sees the "Your trips" heading and its
  own trip link, runs the palette command `add trip`, then waits for the dialog. Everything before
  line 117 passed, so Home had rendered with a list.
- **Occurrences (each read from the job's check-run annotations):**

  | Date | Run | Job | Head / branch |
  | --- | --- | --- | --- |
  | 2026-11-01 | 41331348336 | 124922070546, `test / e2e (1/2)` | `a1c66de`, `claude/m57-part6-console-personas` |
  | 2026-11-01 | 41352389671 | 124985237121, `test / e2e (1/2)` | `85c6202`, same branch |
  | 2026-11-10 | 42758239323 attempt 1 | 129637582293, `test / e2e (1/2)` | `7838c65`, PR 716 |
  | 2026-11-11 | 43037550861 attempt 4 | 130706775704, `test / e2e (1/2)` | `9748638`, PR 717 |

  In each, the failure annotation is this test alone (`1 failed`, 214 passed). Run 41352389671's
  other shard, job 124985237068, failed a different spec (`m16-mobile-assistant.spec.ts:478`); that
  is not this entry. Run 42758239323 passed on attempt 5 with no code change.
- **Why it is a flake, not a regression:** PR 718 (`claude/m60-part5-tasks-feedback`) ran the same
  spec with the same code and passed it, in run 42738117635 (2026-11-10) and run 43037721098
  attempt 4 (2026-11-11). It is also not caused by M60: `git diff --name-only
  origin/main...origin/claude/m60-part5-tasks-feedback` lists no Home, palette, command or new-trip
  file, and no e2e spec.
- **Not KI-20261024-p:** that entry is the keyboard-walk test at line 48 (focus assertions on the
  palette option and the day column). This one is the line-106 test and fails on a dialog that never
  opens, not on focus.
- **Candidate cause (unverified):** the test's own comment says that on a Home with no trips *New
  trip* moves the cursor into the inline first-run conversation and opens no dialog
  (`HomeScreen.startNewTrip`), and that alice is shared, so which trips exist depends on other
  workers. The test now makes its own trip, which should rule that out; but if `add trip` runs before
  Home's trip list has hydrated into the state `startNewTrip` reads, it would take the first-run
  branch and open no dialog. Nothing here has shown which.
- **Why not fixed here:** no report artifact has been read for any occurrence, so the failing state
  (dialog absent, or first-run conversation shown) is not known, and a guessed wait would hide a
  real ordering bug.
- **Fix path / Tripwire:** on the next occurrence, download the Playwright report artifact from the
  failed job and read the trace and screenshot at line 117: first-run conversation visible means
  the command ran before the list hydrated (wait on the state `startNewTrip` reads, not on the
  heading), and nothing visible means the palette never ran the command. Tripwire: the next
  occurrence.
- **Cross-reference:** KI-20261024-p (sibling flake in the same spec file); KI-20261101-u (CI
  infrastructure failures that also turn e2e red, a different symptom).
- **First noted:** 2026-11-11, while closing M60 part 0, from PR 717's run 43037550861 attempt 4;
  the three earlier occurrences were found by searching the runs of the same spec.
