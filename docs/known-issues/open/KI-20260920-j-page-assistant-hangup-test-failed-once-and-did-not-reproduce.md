### KI-2026-09-20-j — the assistant's "hangs up on a turn in flight" test failed once in a full-directory run and has not reproduced

- **Severity:** unknown, and that is the entry. Either a real race in the
  hang-up path or a scheduling artefact of running twelve files together. One
  observation is not enough to say which.
- **Area:** `apps/web/src/components/pages/PageAssistant.test.tsx` → *"hangs up
  on a turn in flight when the assistant is closed"*.

- **Symptom / What happens:** one run of
  `vitest run -c vitest.unit.config.ts src/components/pages` reported
  `1 failed | 145 passed`, that test being the failure. The same file run alone
  immediately afterwards passed 10/10, and a repeat of the full directory run
  passed 146/146.

- **How it was found:** incidentally, during PR #198 (the widget rail), in the
  scoped subset for a change that touches **none** of the assistant path —
  `WidgetPicker.tsx`, its test, and an e2e spec. Recorded rather than dropped
  because a failure seen once and then explained away is how a real race earns
  another six months.

- **RULE 2 WAS FOLLOWED AND FOUND NOTHING.** `docs/known-issues/open/` was
  grepped for the symptom before calling it anything; the only hit was
  `KI-20260907-d`, which is about where the verification loop runs, not about
  this test. So this is a new observation, not a known one.

- **What the repo's own rule says about it, and why that is not conclusive
  here.** `CLAUDE.md` rule 2: *"a failure whose location moves between runs is a
  timeout; a real defect fails in the same place every time."* This failed in
  the same place — but only once, so the rule's discriminator does not apply.
  **What distinguishes the two cases is isolation**: it failed only when twelve
  files shared a worker and passed alone, which is the signature of a test whose
  timing depends on the machine rather than on the code.

- **What it would take:** run that file under load in a loop
  (`vitest --repeat`, or the whole directory a dozen times) and see whether it
  comes back. If it does, the hang-up path's cancellation is worth reading
  closely — a turn in flight being cancelled as the component unmounts is
  exactly the shape that races. **Do not "fix" it by adding a wait**; that
  converts a race into a slower race.

- **Deliberately not chased in PR #198.** That PR is a widget rail; the
  assistant is not in its diff, and chasing a one-off there would have widened
  it for something it did not cause.
