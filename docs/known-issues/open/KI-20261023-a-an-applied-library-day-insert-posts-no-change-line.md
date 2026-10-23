### KI-2026-10-23-a — An applied library day inserted as tomorrow posts no change line

- **Severity:** correctness. Narrow: a line M52 decision 17 promises is missing in one case.
- **Area:**
  - `apps/web/src/server/ai/handleAskRequest.ts` (`handleApplyProposalRequest`, the
    `announceChange` call after `commitProposal`): it passes `commands.commands`, the batch as
    proposed, and not the commands the library inserts expanded into.
  - `apps/web/src/server/ai/writeTools.ts` (`commitProposal`): the fix site. It runs the
    inserts' own commands and does not return them.
  - `apps/web/src/server/chat/changeLine.ts` (`namedStops`): names only the stops the commands it
    is given name.
- **Symptom / What happens:** the trip is under way and today is its last day. A member applies
  an Ask-tab proposal that inserts a library day. `AddDay` has no position
  (`packages/contracts/src/trip.ts`), so the day is appended and becomes tomorrow, with its stops.
  No change line is posted, because the inserted stops are named by no command `changeLine`
  sees. An insert on any other day lands after tomorrow, which decision 17 does not announce.
- **Why not fixed here:** found in review of M52 part 6 (PR 535, round 2, finding 3). The fix
  changes `commitProposal`, which is outside part 6's files, and the case needs today to be the
  trip's last day.
- **Fix direction:** have `commitProposal` return the commands it ran, the inserts' included, and
  pass those to `announceChange`. Cover it in `chat.int.test.ts`'s *a change line* block: a trip
  whose last day is today, an applied insert, and the line naming the first inserted stop on the
  new day. See it red without the change.
- **Cross-reference:** M52 decision 17; ADR-073's 2026-10-23 amendment; PR 535.
- **First noted:** 2026-10-23, review of M52 part 6, round 2.
