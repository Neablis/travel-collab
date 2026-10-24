### KI-2026-10-24-o — the eval's place stub treats a title-cased category ("Japanese Garden") as a named place and echoes it back

- **Severity:** test quality (minor). A live eval case can fail on the stub, not the model.
- **Area:** `apps/web/src/server/ai/eval/placeStub.ts` (`namesFor`: `if (/\s\p{Lu}/u.test(what))
  return [what, `${what} North Gate`, `${what} South Gate`]`), added by PR 546.
- **Symptom / What happens:** a query with a capital after its first word is taken as a place
  someone named, so "Japanese Garden" comes back as "Japanese Garden", "Japanese Garden North
  Gate" and "Japanese Garden South Gate". A real search would answer a category with real
  gardens. The model may distrust names that are only the query repeated, as it did on
  2026-10-24 when an earlier stub answered "Garden Park House"/"Japanese Garden Room" and
  `d-closed-find-similar` run 3 refused to swap one in (2/3, fixed for the case's own queries in
  `31835b8`; 5/5 after).
- **Why not fixed here:** the case passes 5/5 on `31835b8`, and telling a named place from a
  title-cased kind needs a list of kinds or a real geocoder. Fix direction: match the query's last
  word against the `KINDS` table before the named-place rule, so "Japanese Garden" gets invented
  garden names and "Fushimi Inari Shrine" still comes back under its own name first.
- **Cross-reference:** M52 box 8; PR 546's red-first table (placeStub tests).
- **First noted:** 2026-10-24, Mitchell's live run of PR 546 at `7d8e09f`, recorded on M52's part 0.
