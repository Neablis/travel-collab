### KI-2026-09-08-d — the simulated assistant proposes the day the trip was built from, and the user's own day

- **Severity:** cleanup (cosmetic, but it is exactly what a demo shows)
- **Area:** `apps/web/src/server/ai/simulatedModel.ts` — `playbookCalls()` takes `found.days[0]`
- **Symptom / What happens:** the simulated picker takes the **first** `search_playbooks` result with no exclusions. Observed on the PR #157 preview, 2026-09-08:
  - on a trip that had just been **created from** "Tokyo to Hakone, slowly", it proposed *that same day again*, producing a duplicate Day 2;
  - on another trip it proposed the **signed-in user's own** day — which then correctly credited nobody, because `addCounts` excludes an author adding their own day, so the assistant proposed an add that could never count.
- **Why it was not fixed with the review findings:** neither is wrong per the code, and both are behaviour decisions rather than defects. Excluding "days already in this trip" needs state `playbookCalls` does not have. Excluding the user's own days is one line — the readout already carries a `mine` flag — but it would change what the new e2e sees, since `m10-simulated-ai.spec.ts` deliberately has its actor publish and then find **their own** day under a minted city.
- **Note for whoever takes it:** the e2e coupling above is the real constraint. Filtering `mine` in the picker means that spec needs a second actor, which is `m11b-playbooks.spec.ts`'s two-actor idiom — not hard, but it is the reason this is not a one-line change.
- **Cross-reference:** ADR-042; `addCounts` in `apps/web/src/server/savedDayAdds.ts`; KI-2026-09-08-c (found in the same walk).
- **First noted:** 2026-09-08, browser walk of PR #157.
