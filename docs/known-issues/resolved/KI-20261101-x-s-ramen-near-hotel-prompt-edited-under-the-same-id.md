### KI-2026-11-01-x — `s-ramen-near-hotel` keeps its id but its prompt was edited, against the live set's "never edit, only add" rule — RESOLVED

- **Severity:** cleanup (the live set is a baseline; an edited prompt under an old id weakens comparisons with earlier runs).
- **Area:** `apps/web/src/server/ai/eval/live-set.json` (the `s-ramen-near-hotel` row; the file's `about` says "a prompt is never edited, only added under a new id").
- **Symptom / What happens:** the prompt was reworded in PR 674 (`85c6202`) to name Trunk Hotel, because the seed has no day-2 hotel, and now expects options rather than a proposal, like `d-coffee-near-now`. The id was kept. Any earlier run of that id graded a different prompt.
- **Resolution (2026-11-01):** Mitchell ruled to **keep the edit**. The reworded prompt stays under `s-ramen-near-hotel`; the original is not restored and no new id is added. Runs of that id before `85c6202` graded a different prompt, so compare across that commit with care. Nothing changed in code.
- **Cross-reference:** `docs/milestones/M57-assistant-personas.md` (retro), PR 674.
- **First noted:** 2026-11-01, M57 close.
