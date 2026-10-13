### KI-2026-10-13-d — the playbook pages' classifier calls a change request a `question`, so it runs on the cheap tier

- **Severity:** correctness (routing, not output). The turn still offers the right tools and
  can propose a card, but the class picks the model tier, so a change request on a playbook page
  runs on the tier meant for a question.
- **Area:** `apps/web/src/server/ai/askIntent.ts:242-249` (`PLAYBOOK_INTENT_INSTRUCTION`), `:309-310`
  (`ACCOUNT_INTENT_OUTPUT`, whose only choices are `off_topic` and `question`) and `:527` (the
  `playbook` variant reuses that output); `apps/web/src/server/assistant/taskClass.ts:54`
  (`TIER_FOR`: `question` → `cheap`, `edit` → `mid`) and `:68` (`tierFor`, which raises an unsure
  verdict to `mid`).
- **Symptom:** the live eval's `p-add-to-trip` ("add this to my Kyoto trip on day 2") logged
  `taskClass: "question"` on the cheap tier (Haiku 5.5) at `main` `940df19`. At PR 429's head
  `87c01b0`, both playbook change prompts (`p-add-to-trip` and `p-start-trip`) logged the same.
  The tool call was right both times, and at `87c01b0` the turn proposed a card. The miss at
  `940df19` was the trip-name matcher, which PR 429 fixes, and not the class. So nothing has
  failed because of this yet. The ledger's `task_class` for these turns reads `question` too,
  which skews any cost-by-class reading of the playbook surface.
- **It is by construction, not a model error.** The playbook variant has no change class to
  choose. Its instruction tells the model that a request "to add one to a trip or start a trip
  with it" is a `question` (`askIntent.ts:245`), and its output schema could not hold `edit` even
  if the model answered it. What the grant offers does not depend on the class: each playbook
  surface's tools are the same whatever the classifier says (`grants.test.ts:491`). What the
  class decides is the tier.
- **Why not fixed here:** found by the live eval at M45's close. Filing it was Mitchell's call
  (2026-10-13), and part 0 is prose only. **The fix needs a decision first:** whether a playbook
  change request should run on `mid`, as a trip `edit` does. If so, give the playbook variant an
  `edit` choice (its own output, not the account's) and an instruction that tells "add this to my
  trip" apart from a question about the day. Then add a classifier case for both playbook change
  prompts. If the cheap tier is good enough for these one-tool turns (both passed on Haiku at
  `87c01b0`), record that decision instead and close this entry as by design.
- **Cross-reference:** M45 D9; ADR-068; M45's retro, *Leftovers*
  (`docs/milestones/M45-the-assistant-beyond-one-trip.md`); PR 427, PR 429.
- **First noted:** 2026-10-13, M45 close: the live eval at `940df19`, seen again at `87c01b0`.
