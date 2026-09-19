### KI-81 — An approved AI plan carries the model's own place names, ungrounded: `SearchPlaces` is M9's named remainder — RESOLVED
- **Severity:** correctness (a model guess is laundered into a stored fact — the same species as KI-15, one layer up)
- **Area:** `apps/web/src/server/ai/writeTools.ts` (`commitProposal`), `apps/web/src/server/ai/geocodeEnrichment.ts`, ADR-022 §1 (the fourth read tool it foresees)
- **What is missing:** M9's grounding half. The assistant can now propose and commit a batch (propose → review → approve), but a proposed `AddActivity`'s `location` is still whatever the model wrote. ADR-022 already names the fix and calls it earned under its own rule: a `search_places` READ tool the model must call, and a `placeRef` it must cite, so a stored place is a place the vendor returned rather than a name the model produced.
- **Why the floor is not zero:** an approved batch runs the SAME `enrichCommandLocations` the command endpoint runs — region-biased, "refine, never relocate", everything unverified reported (`commitProposal` is asserted to call it before the batch, in `writeTools.test.ts` and in the apply route's integration suite). So approval is not a second door around KI-15's protection, and locations from the assistant are **no worse than the command path's today**. They are also no better.
- **Why it was not built here:** it needs LocationIQ throttling at 2 req/s inside a streaming turn, a `placeRef` the resolver understands, and a review step that shows the user which candidate was chosen. That is its own scoped unit; folding it into the write-tools task was the single largest way to not finish either.
- **Tripwire:** the day `ai-live` is switched on for a real user, this is the entry to read first — an unreviewed model-authored place name is the failure KI-15 already cost a day to.
- **Found by:** the Task 6 implementer, 2026-08-29, recording it as the deliberate remainder its brief named.
- **Cross-reference:** KI-15 (the enrichment rewrite this rests on), ADR-022 §1, `docs/milestones/` M9.
- **First noted:** 2026-08-29.

- **RESOLVED 2026-09-16 — grounding is built, and the guarantee is structural rather than prompted.**

  The shape is the one ADR-022 §1 named and this entry predicted:
  `search_places` is a fourth read tool (`domain: "places"`, `effect: "read"`,
  **`spend: "vendor"` — the first tool to declare it**) that numbers what the
  vendor returned into a per-turn cache; `AddActivity`/`UpdateActivity` cite
  `placeRef: N`; and **the server resolves N** into the candidate's name and
  coordinates before a human ever sees the card.

  **The guarantee, stated the way `idFields.ts` states its own:** a place the
  model did not search for has no number, so it cannot be cited. There is no
  spelling of "somewhere in Shropshire" that resolves.

  **The three consequences, each of which is the point:**

  * The card a person approves **names the place the server found**, not the
    place the model typed — the same rule `insert_playbook_day` follows for a
    saved day's name.
  * **`placeRef` never leaves the server.** It is transport between the model
    and `groundCitedPlaces`, resolved before anything is serialised, so the
    apply door needs no new trust — and `contracts/test/m9-place-ref.test.ts`
    already pinned its absence from the stored event, from the other end.
  * A cited stop **arrives at enrichment already located**, so the blind
    post-hoc geocoder does not touch it. That is KI-15's demotion.

  **Two things the build found that the plan did not.**

  1. **Grounding has to run BEFORE `resolveBatch`, not after.** A test caught
     it: `UpdateActivity { activityRef, placeRef }` is a perfectly good emission
     and to the domain it is an update with no changed field, so
     `decideTripCommand` rejects it `no-op` and the proposal comes back null.
     `placeRef` is not a domain field, so the citation has to become a location
     before the domain is asked whether anything changed. `droppedWriteCalls`
     grounds too, or the analytics dry run disagrees with the proposal it is
     supposed to mirror.
  2. **`Location.precision` had to stop being model-writable**, which closes the
     gap `contracts/src/activity.ts` names in its own comment (*"NOT a fourth
     tier for the assistant's own unverified guess… a real gap and a deliberate
     omission"*). Enrichment now skips a location carrying `precision` and
     coordinates, so a model that could claim `precision: "venue"` beside a
     guessed lat/lng could have skipped the one check that would have caught it.
     `groundCitedPlaces` strips whatever the model claimed before it writes what
     the server found, so `precision` is server-written by construction.

  **What is NOT closed by this**, and the milestone's gate still wants it: the
  2026-08-02 Rochester prompt re-run verbatim against a real model. Grounding is
  the build; that box is a live call, and no lane in this repo has one.
- **Cross-reference:** KI-93 (resolved in the same change — the second door into the same vendor key), KI-15 (demoted to a fallback for user-typed text).
