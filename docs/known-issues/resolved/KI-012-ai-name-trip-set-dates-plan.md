### KI-12 — The AI cannot name a trip or set its dates, so "plan me a trip" can't produce a complete one — RESOLVED
- **Severity:** correctness (product gap — the headline AI flow cannot finish the job it advertises)
- **Area:** `packages/contracts/src/trip.ts` (`BatchableCommand` union), `apps/web/src/server/ai/handleAskRequest.ts` (`instructionsFor`) — the prompt moved there when ADR-033 Decision 4 deleted `handleAiRequest.ts`.
- **Symptom:** prompting "Create a 7 day itinerary for Rochester NY…" on a new trip yields days and activities but leaves the trip called **"New TRip"** with `startDate: null`. There is no `SetTripName` command anywhere in the contract — renaming is UI-only — so no tool for it can be derived (ADR-015 / Invariant 5: tool schemas are *derived*, never hand-written). `SetTripStartDate` *is* batchable and *is* exposed, but the model never calls it unprompted.
- **Why it isn't fixed:** the two halves need different work and a product decision. Naming needs a new `SetTripName` command through the full pipeline (command + event + `decideTripCommand`/`evolveTrip` + contracts changelog) — small but a genuine contract change, and it's worth deciding first whether an AI should silently rename a trip the user already named. Dates need only a prompt nudge, but "7 days starting when?" has no answer without asking the user, and the AI surface has no clarification round-trip.
- **Mitigation:** none today — the user renames and sets dates by hand after generation.
- **First noted:** 2026-07-26 (live test of the `MAX_STEPS` fix).
- **Milestone:** **M9 GATE BOX (assigned 2026-09-01)** — this is a written box in M9's exit gate: "the AI cannot leave a trip half-planned". Assignment rationale — why three of the twelve AI entries gate M9 and nine are carried — is in `docs/milestones/M9-ai-planning-partner.md`, section "The AI known issues".

- **RESOLVED 2026-09-16 (M9). The entry's diagnosis had gone stale; its symptom had not.**

  **What was no longer true.** *"There is no `SetTripName` command anywhere in
  the contract — renaming is UI-only"* stopped being true some time after this
  was filed. `SetTripName` and `SetTripDates` are both `BatchableCommand`
  members, both derived into tools by `tools/planning.ts`'s generator, and have
  been for a while. The contract work this entry says is needed was already
  done, by somebody else, for another reason.

  **What was still true, and why the symptom outlived its cause.** Two things
  arrived after this was filed and between them reproduced it exactly:

  1. **`TASK_CLASSES_FOR` removed `SetTripName` from the `plan` class**
     (M9 Phase 0 P5's tool-count cut, 17 → 13). Its own comment predicted this
     precisely — *"a user who says 'plan me a trip and rename it to Japan 2027'
     gets the plan and no rename… if it proves annoying, the fix is to delete an
     entry here and nothing else"* — and priced it at one extra turn. It was not
     annoying; it was a gate box. One entry deleted, nothing else, exactly as
     forecast. The `plan` turn goes 13 → 14 tools, still inside the band P5 moved
     it into.
  2. **Nothing told the model to name or date a trip that had neither.** The
     dates half was always only this: the entry says so.

  **The product question this entry says has to be decided first, decided.**
  *"Whether an AI should silently rename a trip the user already named"* — it
  must not. So the rule is conditional, and the condition is the interesting
  part: **there is no default name to compare against.** A trip's name is
  whatever the person typed into the wizard, and `"New TRip"` — this entry's own
  example — is indistinguishable from a considered one. The condition is
  therefore **emptiness**: a trip with no stops anywhere, on any day or in the
  backlog, is one nobody has invested anything in, and naming it is the flow
  finishing what it advertised. One stop in, the name is somebody's and the
  assistant leaves it alone unless asked. That is a fact about the document
  rather than a guess about intent (`TripStanding`, `handleAskRequest.ts`).

  **The dates half deliberately does not invent a departure.** This entry's own
  note is that *"7 days starting when?" has no answer without asking the user*,
  and a model that picks one is the fabrication M9 exists to stop. The rule says
  to set the dates the request IMPLIES — "six days from March 3" — and to ask
  otherwise. The clarification round-trip the entry says is missing is still
  missing; what changed is that the model is now told to ask rather than to
  guess or to stay silent.

  **A trip with both a name and dates is told byte-identically what it was told
  before this existed**, which a test asserts — the parameter is additive, and
  the rules are inside the `canWrite` branch, so a turn holding no write tool is
  never told to use a tool it was not handed.

  **Proved rather than asserted.** Six cases in `route.int.test.ts` under
  *"write tools"*: both rules fire on an empty undated trip; neither renames a
  trip with stops; a complete trip gets neither and renders identically; neither
  reaches a `withheld` or `read-only` turn; `standingOf` reads both facts off
  the trip (counting backlog stops); and the `plan` turn is actually offered
  `SetTripName`. Each was watched failing for its own reason.

  **What this does NOT close.** The gate box also wants the walk — "plan me a
  trip" driven end to end against a real model, producing a named, dated trip in
  one approved batch. The mechanism is built and the simulated model cannot
  demonstrate it, because it does not call these tools.
- **Cross-reference:** KI-81 and KI-93 (resolved in the same milestone), `docs/plans/2026-09-16-M9-remainder.md` §C.
