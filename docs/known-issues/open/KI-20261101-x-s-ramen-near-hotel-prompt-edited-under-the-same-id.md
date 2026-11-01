### KI-2026-11-01-x — `s-ramen-near-hotel` keeps its id but its prompt was edited, against the live set's "never edit, only add" rule

- **Severity:** cleanup (the live set is a baseline; an edited prompt under an old id weakens comparisons with earlier runs).
- **Area:** `apps/web/src/server/ai/eval/live-set.json` (the `s-ramen-near-hotel` row; the file's `about` says "a prompt is never edited, only added under a new id").
- **Symptom / What happens:** the prompt was reworded in PR 674 (`85c6202`) to name Trunk Hotel, because the seed has no day-2 hotel, and now expects options rather than a proposal, like `d-coffee-near-now`. The id was kept. Any earlier run of that id graded a different prompt.
- **Why not fixed here:** Mitchell has not ruled. Options: accept the edit and note it in the file's `about`, or restore the original under its id and add the reworded prompt under a new id.
- **Cross-reference:** `docs/milestones/M57-assistant-personas.md` (retro), PR 674.
- **First noted:** 2026-11-01, M57 close.
