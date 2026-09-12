### KI-2026-09-08-d — the simulated assistant proposes the day the trip was built from, and the user's own day — RESOLVED

**Resolved 2026-09-12**, for the "user's own day" half. `playbookCalls()`
(`apps/web/src/server/ai/simulatedModel.ts`) now picks `found.days.find((day)
=> !day.mine)` instead of `found.days[0]`, so the picker skips a result that
is the searcher's own — the case `addCounts` (`savedDayAdds.ts`) never
credits anyway. When every result is `mine`, it now returns `null` (the same
"nothing to insert" path an empty library already took), and the turn says
so instead of proposing an add that can never count.

**The other half — "days already in this trip" (the duplicate-day symptom) —
is NOT fixed here** and remains open in spirit, exactly as the entry's own
"Why it was not fixed" already said: nothing `playbookCalls` sees (`read_trip`'s
`TripReadout`, or the domain model behind it) records which `savedDayId` a
trip's own days were inserted from, so excluding "already in this trip" needs
new state this fix does not add. Filtering `mine` was the one-line half the
entry described; the state-needing half is left for a future entry with that
narrower scope, rather than guessed at here.

**Reproduced first**, with the two-day scenario the entry describes: a
`search_playbooks` result with a `mine: true` day sorted first and a
`mine: false` day second. Before the fix:
```
FAIL  src/server/ai/simulatedModel.test.ts > simulatedModel — proposing a change > skips the searcher's own day and picks the first day that is not theirs
AssertionError: expected { savedDayId: 'mine-1' } to deeply equal { savedDayId: 'theirs-1' }
- Expected
+ Received
  {
-   "savedDayId": "theirs-1",
+   "savedDayId": "mine-1",
  }
```
and, for the all-mine case:
```
FAIL  src/server/ai/simulatedModel.test.ts > simulatedModel — proposing a change > proposes nothing when every result found is the searcher's own day
AssertionError: expected [ { type: 'tool-call', …(3) } ] to deeply equal []
- []
+ [
+   {
+     "input": "{\"savedDayId\":\"mine-1\"}",
+     "toolCallId": "42201b5e-0071-43f0-b004-7754ba037d84",
+     "toolName": "insert_playbook_day",
+     "type": "tool-call",
+   },
+ ]
```
Both are **permanent regression tests**, added to `simulatedModel.test.ts`
("skips the searcher's own day and picks the first day that is not theirs",
"proposes nothing when every result found is the searcher's own day"). With
`found.days.find((day) => !day.mine)` reverted to `found.days[0]`, both fail
with the output quoted above; with the fix in place, both pass.

The e2e coverage the entry flagged as the real constraint — `m10-simulated-ai.spec.ts`'s
`"a playbook day the assistant found reaches the board once it is approved"` —
had its actor publish and then find their **own** day under a minted city,
which the fixed picker now refuses to propose. Rewrote it to `m11b-playbooks.spec.ts`'s
two-actor idiom: the original `page` (alice) keeps and publishes the day, and a
brand-new second account (`browser.newContext({ storageState: undefined })` +
`signInAsDevUser`) is the one that asks the assistant and approves. This e2e
edit was typechecked and linted clean but **not run** — this sandbox has no
`DATABASE_URL`/Postgres available for `test:e2e:ci-like`, so per CLAUDE.md
rule 1 this is not a verdict; it is recorded as unverified at the e2e layer,
to be confirmed on the next run that has a database.

**Proof:** `pnpm --filter web exec vitest run -c vitest.unit.config.ts
src/server/ai/simulatedModel.test.ts` — 56 passed (56), including both new
regression tests; `pnpm --filter web typecheck` and `pnpm exec eslint
src/server/ai/simulatedModel.ts src/server/ai/simulatedModel.test.ts
e2e/m10-simulated-ai.spec.ts` (from `apps/web`) both clean.

Files touched: `apps/web/src/server/ai/simulatedModel.ts`,
`apps/web/src/server/ai/simulatedModel.test.ts`,
`apps/web/e2e/m10-simulated-ai.spec.ts`.

The original entry follows, unchanged.

---

### (original) the simulated assistant proposes the day the trip was built from, and the user's own day

- **Severity:** cleanup (cosmetic, but it is exactly what a demo shows)
- **Area:** `apps/web/src/server/ai/simulatedModel.ts` — `playbookCalls()` takes `found.days[0]`
- **Symptom / What happens:** the simulated picker takes the **first** `search_playbooks` result with no exclusions. Observed on the PR #157 preview, 2026-09-08:
  - on a trip that had just been **created from** "Tokyo to Hakone, slowly", it proposed *that same day again*, producing a duplicate Day 2;
  - on another trip it proposed the **signed-in user's own** day — which then correctly credited nobody, because `addCounts` excludes an author adding their own day, so the assistant proposed an add that could never count.
- **Why it was not fixed with the review findings:** neither is wrong per the code, and both are behaviour decisions rather than defects. Excluding "days already in this trip" needs state `playbookCalls` does not have. Excluding the user's own days is one line — the readout already carries a `mine` flag — but it would change what the new e2e sees, since `m10-simulated-ai.spec.ts` deliberately has its actor publish and then find **their own** day under a minted city.
- **Note for whoever takes it:** the e2e coupling above is the real constraint. Filtering `mine` in the picker means that spec needs a second actor, which is `m11b-playbooks.spec.ts`'s two-actor idiom — not hard, but it is the reason this is not a one-line change.
- **Cross-reference:** ADR-042; `addCounts` in `apps/web/src/server/savedDayAdds.ts`; KI-2026-09-08-c (found in the same walk).
- **First noted:** 2026-09-08, browser walk of PR #157.

- **The rewritten e2e spec has now been executed, 2026-09-12.** `m10-simulated-ai.spec.ts`'s playbook test had one actor publish and then find *their own* day — exactly what this fix excludes — so it had to be rewritten to `m11b-playbooks.spec.ts`'s two-actor idiom, and the fixing session could not run it (no Postgres in that worktree). Run since on the lane that counts: `CI=true pnpm --filter web test:e2e e2e/m10-simulated-ai.spec.ts e2e/m16-mobile-assistant.spec.ts` → `13 passed (28.3s)`, including `m10-simulated-ai.spec.ts:218 › a playbook day the assistant found reaches the board once it is approved`. The rewrite holds.
