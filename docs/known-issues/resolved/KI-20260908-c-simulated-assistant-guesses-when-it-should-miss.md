### KI-2026-09-08-c — the simulated assistant answers a library request with invented sample stops, and the card cannot tell the two apart — RESOLVED

- **Severity:** correctness (simulated path only — but `ai-live` is off on every Vercel environment, so this is the only path anyone can currently click)
- **Milestone:** **M9, carried (assigned 2026-09-24, KI pass)** — owned by M9, not a gate box. Parked under Mitchell's 2026-09-01 rule that every open AI known issue belongs to M9; filed after that audit, so it had no owner until now. Listed in `docs/milestones/M9-ai-planning-partner.md` § *Parked 2026-09-24*.
- **Area:** `apps/web/src/server/ai/simulatedModel.ts` — `PLAYBOOK_PROMPTS` / `asksForAPlaybookDay`, the branch order at `playbookCalls` vs `proposeCalls`; `apps/web/src/components/assistant/ProposalCard.tsx` (the surface that cannot distinguish them)
- **Symptom / What happens:** *"find me a day in Kyoto and add it"* matches `CHANGE_VERBS` but **not** `PLAYBOOK_PROMPTS` — it names no library concept — so the turn falls through the library branch into the generic planning branch and proposes **invented stops**: `Add "Sample: coffee stop" to day 1`, `Add "Sample: evening stroll" to day 1`. The proposal card renders that identically to a real library insert. A user asking in the most natural words for this feature gets a **plausible-looking wrong answer rather than an obvious miss**, which is the worse of the two failures.
- **Found by:** a browser walk of the PR #157 preview, 2026-09-08, using the phrasing the walk's own brief had suggested — so the brief that was meant to verify the feature would have demonstrated the wrong one.
- **Why it was not fixed there, and this is a judgement worth arguing with:** the obvious fix — widen `PLAYBOOK_PROMPTS` — was considered and rejected by the implementer. The phrase names no library concept, so matching it means matching on *"find … a day"*, which collides with `PLANNING_PROMPTS`' *"what could I do with"* territory and with the ordinary *"add a coffee stop"* case that `PLAYBOOK_PROMPTS`' own comment says it must not overlap. Their conclusion, recorded rather than smoothed over: **"I would rather it miss than guess"**, and the real defect is that a guess and a right answer are indistinguishable on the card.
- **The fix that is probably right:** not a wider regex. Either the simulated model should decline rather than invent when a request is library-shaped but unmatched, or the proposal card should show provenance — a library insert names a real saved day and its author, an invented stop names nothing — so the two stop looking alike. The second is worth having against a **real** model too, which is what makes it more than simulated-path polish.
- **Cross-reference:** ADR-042; KI-81 (a model guess laundered into a stored fact — the same species, one layer down, and the reason `ai-live` is still off); KI-2026-09-08-d.
- **First noted:** 2026-09-08.
- **Re-verified 2026-09-25 (overnight sweep):** STILL TRUE. `PLAYBOOK_PROMPTS` (`server/ai/simulatedModel.ts:468`) is unchanged; running both regexes on "find me a day in Kyoto and add it" gives `playbook false, change true`, so `askTurn` skips the library branch (:779) and reaches `proposeCalls` (:794 → :545), which emits `Sample: coffee stop` / `Sample: evening stroll` (:552-559). `components/assistant/ProposalCard.tsx` has no provenance field (`grep -n "playbook\|source\|author"` → nothing).
- **Re-verified 2026-11-14 (overnight KI sweep), left open:** STILL TRUE, in a smaller form. With editor tools plus `search_playbooks`, `insert_playbook_day` and `switch_persona` offered, "find me a day in Kyoto and add it" reads `[read_trip, find_free_time]` (no switch to Discover) and then proposes `AddActivity {"title":"Sample: coffee stop","dayRef":"day 1"}`: one invented stop now rather than two, since ADR-067 gave an ordinary change one stop. **There is no branch-order fix.** `askTurn` already checks the library branch before `proposeCalls`; the phrase reaches neither the library branch nor the Schedule-to-Discover switch because no predicate recognises it. Both of the entry's fixes need a decision first: "decline when library-shaped but unmatched" needs a rule for *library-shaped*, which is the widened regex this entry rejects under another name (it would have to cover "find … a day" without catching "add a coffee stop" or "find time for lunch and add it"), and provenance on `ProposalCard` is a design choice that also applies to a real model. Both are Mitchell's call; nothing changed in code.
- **Resolved 2026-11-14** (overnight KI sweep), by both fixes the entry names, as Mitchell decided.
  **Miss, don't guess:** `FIND_A_DAY` (`apps/web/src/server/ai/simulatedModel.ts`) joins
  `asksForAPlaybookDay`. It is not a wider `PLAYBOOK_PROMPTS`: it is anchored on a finding verb
  (`find|get|look for|search for`) whose object is an indefinite day, the app's own phrase for the
  library ("Find a day worth borrowing"), and a slot qualifier ("a free day", "an open day") or time
  ("find time for lunch") leaves it to the planning branch; "add a day in Kyoto" has no finding verb
  and stays ADR-067's new day. So "find me a day in Kyoto and add it" now reads `[read_trip,
  switch_persona, find_free_time]`, then `search_playbooks`, and proposes only a day the library
  returned; an empty search says "I couldn't find a day in the playbook library…", that nothing was
  drafted in its place, and to search Discover. **Provenance on the card:** `ProposalCard` lists
  each library insert as "From the library: “X”, a saved day by <author>." and every `AddActivity`
  whose location the server did not resolve (no `precision`, which only `groundCitedPlaces` writes
  at propose time) as "The assistant's suggestion: “…” is not a saved day or a place it looked up."
  The author is one additive optional contract field, `ProposedInsert.author` (CHANGELOG
  2026-11-14), read with the row by the `savedDays` port (`publicNamesOf`) and carried by
  `buildProposal`; the model's receipt is unchanged. Proven by: the reproduction
  (`[read_trip, find_free_time]` then `AddActivity "Sample: coffee stop"`) now red-then-green in
  `simulatedModel.test.ts` (*a request to find a day*), with the near misses ("add a coffee stop",
  "find time for lunch and add it", "find a free day…", "add a day in Kyoto", the empty-day chip)
  still proposing, and seen red with the qualifier lookahead removed; `ProposalCard.test.tsx`
  (*where each change came from*) red before the change, the grounded-stop case red with the
  `precision` check removed; `writeTools.test.ts` and `ask/route.int.test.ts` red with the author
  dropped from the tool, `buildProposal` or the port; and `m10-simulated-ai.spec.ts` (ci-like),
  which now asserts both lines on the two cards it walks: `7 passed`.
