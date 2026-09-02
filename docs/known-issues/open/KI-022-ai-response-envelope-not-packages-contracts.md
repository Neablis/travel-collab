### KI-22 — The AI response envelope is not in `packages/contracts`
- **Severity:** cleanup
- **Area:** `apps/web/src/server/ai/handleAskRequest.ts` (the stream's `messageMetadata`), `apps/web/src/lib/apiClient.ts` (`proposalFrom`, `composedPageFrom`)
- **As filed (2026-08-19):** the `/api/trips/:id/ai` response (`message`, `meta`,
  `simulated`, `resolvedCommands`, `resolutionErrors`, `locationReport`) was
  assembled ad hoc in the handler and parsed loosely by the client — `message`
  and `simulated` read with `typeof` / `=== true` guards rather than through a
  schema. This sits against Invariant 5 ("contracts change by protocol, not by
  drift"): the envelope is a cross-boundary type that lives in neither
  `packages/contracts` nor the contracts changelog. It surfaced while adding
  `simulated`, which needed no changelog entry precisely because there is no
  contract to change.
- **Where it lives now (ADR-033 Decision 4, 2026-09-02).** That endpoint and its
  envelope are deleted, and the entry does NOT close with them: the same shape
  moved to `/ask`'s stream, one layer down. The turn's outcome rides the final
  chunk as `messageMetadata` — `{ proposal }`, `{ composedPage }` or
  `{ composeError }` — written as an object literal in `handleAskRequest.ts` and
  read back by hand-written parsers in `apiClient.ts` (`proposalFrom`,
  `composedPageFrom`). Those parsers are careful (both re-parse their payload
  against a real contract schema — `BatchableCommand`, `PageContent` — before
  acting on it), which is what keeps this a cleanup rather than a correctness
  entry. What is still unschematized is the ENVELOPE around them: the metadata
  key names and the `composeError` string are a wire contract asserted only by
  two files agreeing.
- **Fix path:** schematize the message-metadata union in `packages/contracts`
  and route both sides through it. Smaller than the original: three keys rather
  than six fields, and the payloads inside two of them are already contract
  types.
- **Milestone:** **M9, carried (assigned 2026-09-01)** — owned by M9, not a gate box: `AGENTS.md` reserves a contracts change as its own reviewed PR, so it cannot sit inside another milestone's gate. Assignment rationale — why three of the twelve AI entries gate M9 and nine are carried — is in `docs/milestones/M9-ai-planning-partner.md`, section "The AI known issues".
