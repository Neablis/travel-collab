### KI-2026-10-20-b — "Accept all" over suggestions from two people names the reviewer as each stop's adder

- **Severity:** cosmetic. The stop says "Dana added this" where Sam or Ana suggested it; nothing is
  lost, and the suggestion history still records who suggested what.
- **Area:** `packages/domain/src/trip/evolve.ts` (`evolveTripEnvelope`, the `addedBy` fold);
  `apps/web/src/server/suggestions/accept.ts` (builds the batch's `suggestions` origin);
  `Origin` in `packages/contracts/src/history.ts`.
- **Symptom / What happens:** Sam and Ana each suggest a stop. Dana presses *Accept all*
  (`SuggestionsChip`, `SuggestedNote`). Both stops name Dana. A single accept, or *Accept all* over
  one person's suggestions, names the suggester as Mitchell ruled on PR 508.
- **Why:** a batch accept writes one `suggestions` origin for every event in it, carrying the set
  of authors (`authorIds`) and the changes, but no mapping from an event (or its `activityId`) to
  the change that produced it. With one author the fold names `authorIds[0]`; with several it
  cannot tell whose stop is whose, so it falls back to the envelope's actor, the reviewer. The
  live fold (`foldEnvelopes`) and the rebuild (`projectTripDetails`) both go through
  `evolveTripEnvelope`, so they agree on the fallback: no projection drift (Invariant 2). Reading
  the suggestion tables from the fold would fix the name and break rebuild-from-events.
- **Why not fixed here:** the fix is a contract change, and that is Mitchell's call.
- **Fix direction:** `accept.ts` knows each change's author and each `AddActivity` command's
  `activityId`, so `Origin.suggestions` could gain an optional `addedBy: Record<activityId,
  authorId>` (additive, with a CHANGELOG entry), which the fold reads before the one-author and
  actor fallbacks. Events already in the log keep today's name.
- **Cross-reference:** M51 part 4 (PR 508), review round 4 BLOCKER 1; `docs/contracts/CHANGELOG.md`
  (`addedBy` entry); the pinned fallback is `packages/domain/test/detail.test.ts`, "is the
  reviewer when a batch mixes suggesters".
- **First noted:** 2026-10-20, M51 part 4 (PR 508).
