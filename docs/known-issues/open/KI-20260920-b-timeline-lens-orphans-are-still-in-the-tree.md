### KI-2026-09-20-b — three orphans of the deleted Timeline lens are still in the tree

- **Severity:** cosmetic, but actively misleading. The code reads as shipped
  behaviour, is maintained by lint and type checks, and describes a surface
  users cannot reach.
- **Area:** `apps/web/src/components/lenses/OverlapWarning.tsx`,
  `apps/web/src/components/trip/EndOfTrip.tsx`,
  `apps/web/src/components/lenses/timelineData.ts`, and their tests.
- **Symptom / What happens:** SPEC §24 deleted the Timeline lens. These three
  modules were its, and none has a production importer. `OverlapWarning` and
  `EndOfTrip` survive only as prose in other files' comments —
  `ActivityCard.tsx:39` ("the columns' compact form of the timeline's
  `OverlapWarning`"), `overlapData.ts:55`, `ActivityConflicts.tsx:13`, and
  `Board.tsx:68-75`, which is the clearest account of what happened: *"§24
  deleted that lens, which took `EndOfTrip` — and with it this button, its
  dialog and the whole insert half of the keep-a-day loop — out of the running
  app entirely."*

  `timelineData.ts` has no references at all, in code or comment.

- **Why this is worth an entry rather than a silent delete:** the comments
  above are load-bearing — they explain why `Board` carries controls that look
  misplaced. Deleting the modules without reading those four references would
  strand explanations that point at files which no longer exist. The cleanup is
  small; the reading is the work.

- **How it was found:** the 2026-09-20 no-production-importer sweep, described
  in `KI-2026-09-20-a`.

- **Fix sketch (not done):** delete the three modules and their tests, then fix
  the four comments to describe the behaviour rather than the vanished
  component — `ActivityCard.tsx:39`'s "the timeline's `OverlapWarning`" wants to
  become a description of the overlap rule itself. Check `Board.tsx:68-75`
  survives as the record of §24's deletion, because that note is the reason
  anyone can follow the keep-a-day loop today.

- **First noted:** 2026-09-20.
