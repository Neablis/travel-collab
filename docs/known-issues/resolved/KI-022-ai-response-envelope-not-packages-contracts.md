### KI-22 — The AI response envelope is not in `packages/contracts` — RESOLVED
- **Severity:** cleanup
- **Area:** `packages/contracts/src/assistant.ts` (new), `apps/web/src/server/ai/handleAskRequest.ts` (the stream's `messageMetadata`), `apps/web/src/server/ai/writeTools.ts`, `apps/web/src/lib/apiClient.ts`
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
- **2026-09-05 overnight review ([F-E07](../../reviews/2026-09-05-overnight-review/findings/F-E07-ask-handler-is-one-455-line-function.md), [F-E03](../../reviews/2026-09-05-overnight-review/findings/F-E03-api-client-is-35-hand-mirrored-wrappers.md)):**
  still open, and stream E places it in a larger pattern — the client side of
  the same wire is 35 hand-mirrored fetch wrappers plus a second client
  (`pagesClient.ts`) plus three raw fetches, with MSW mocks that two guidelines
  call "generated from contracts" and which are hand-written. Moving the stream
  envelope into `packages/contracts` is one of the three steps in F-E07's
  suggested fix; the client-side half is KI-2026-09-05-q.

- **Two things this entry got wrong about where it lived, found while closing
  it.** (a) The key was renamed: ADR-035 decision 5 made it `pageInserts` and
  the client parser `pageInsertsFrom` — *inserted, not composed* — so
  `composedPage`/`composedPageFrom` above name nothing that existed by
  2026-09-11. (b) There are FOUR shapes, not three: a page turn that inserted
  nothing sends `{}`, which is silence rather than a refusal, and a schema that
  admitted only the three named here would have rejected it. The "smaller than
  the original: three keys rather than six fields" estimate was also low for a
  different reason — the payloads inside two of them are contract types, but the
  proposal WRAPPER around `commands` was hand-written twice, once per side, and
  moving it was the larger half of the work.
- **Fixed (2026-09-11, M9 Phase 0 P6 — its own PR, per `AGENTS.md`).**
  `packages/contracts/src/assistant.ts` holds `AskStreamMetadata` — the union of
  the four shapes — plus `AssistantProposal`, `ProposedChange`, `ProposedInsert`
  and `SIMULATED_HEADER`. The server's `messageMetadata` callback is typed
  against it, so a misspelled key is a compile error; the client `safeParse`s
  through it, so a payload the contract does not accept is dropped rather than
  acted on. The two hand-written `AssistantProposal` declarations are gone, and
  with them the divergence they had already grown: `ProposedChange.type` was
  `BatchableCommand["type"]` on the server and `string` on the client, which is
  how a fixture asserting `type: "activity.move"` — a name no command has ever
  had — passed. `docs/contracts/CHANGELOG.md`, 2026-09-11.
- **The `simulated` half, decided rather than dropped.** This entry names
  `simulated` as part of the envelope, read with a `=== true` guard. It is now a
  response header (`x-tc-ai-simulated`), and it **stays** one: it is set before a
  byte of the stream so a turn that fails mid-answer is still badged, where
  stream metadata rides the final chunk that failure path never sends. Folding it
  into `AskStreamMetadata` would reintroduce exactly the bug the header was built
  to fix. What the entry was really complaining about is ownership, and that is
  fixed: the name was declared in `handleAskRequest.ts` and re-declared as a
  literal in `apiClient.ts` (with a comment saying it could not import the
  server's copy), and it is now one `@tc/contracts` constant both import. A
  constant and not a schema because there is nothing to parse — a header value is
  `string | null` and the comparison is already total.
- **Proven by:** the pre-P6 client run against the new cases, which waved two of
  them through — `changes: [{"type":"AddDay","text":"Add a day"},{"type":"AddDay"}]`
  produced a proposal event carrying ONE change beside one command
  (`expected [ { type: 'proposal', …(1) } ] to deeply equal []`), and
  `skipped: ["could not find “Fuglen”", 7]` produced one whose `7` had silently
  vanished. Both now fail the parse and no card is rendered. Plus
  `packages/contracts/test/ask-stream-envelope.test.ts` (15 cases, including a
  fast-check property over six corruption positions with a measured
  per-arm floor), the `/ask` and `/ask/apply` integration suites unedited, and
  the milestone e2e — the envelope's bytes did not change.
- **What is NOT closed by this, and is not this entry.** The client-side half of
  the same wire — 35 hand-mirrored fetch wrappers, a second client, three raw
  fetches and hand-written MSW mocks two guidelines call generated — is
  KI-2026-09-05-q and stays open. F-E07's other two steps (splitting the handler,
  landing KI-9's wrapper) landed in P1 and P3.
- **First noted:** 2026-08-19. **Fixed:** 2026-09-11 (M9 Phase 0 P6).
