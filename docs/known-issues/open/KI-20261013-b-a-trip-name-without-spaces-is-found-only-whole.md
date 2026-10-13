### KI-2026-10-13-b — a trip name in a script without spaces is found only by its whole name

- **Severity:** minor. It fails safe: the assistant asks which trip, and never picks a wrong one.
  The UI is `en_US` only (`apps/web/src/app/layout.tsx`), so such names arrive only when a person
  types them.
- **Area:** `apps/web/src/server/assistant/tools/navigate.ts` (`wordsOf` and `tripsCalled`), used
  by `open_trip` and the playbook pages' `add_playbook_to_trip`.
- **Symptom:** `wordsOf` splits a name into words only at characters that are not letters, marks
  or numbers. Japanese, Chinese and Thai are written without spaces, so there a whole name is one
  "word". Since PR 429, `tripsCalled`'s last tier matches only the leading whole words of a
  name. So "京都" no longer finds "京都旅行" or "京都と大阪", and "เชียงใหม่" no longer finds
  "ทริปเชียงใหม่". Main found all three by substring. Exact names still match ("京都" finds
  "京都"), and so does a name with a space in it ("京都" finds "京都 2026"). "私の京都旅行" ("my
  Kyoto trip") against "京都" refused before PR 429 and still does.
- **Why it is left like this:** PR 429 closed a run of partial matches that picked the wrong trip
  ("my York trip" opened "New York"). Its rule is that the person names the trip, and that when
  unsure the assistant asks. These names now ask, which that rule allows.
- **Known fix:** in `wordsOf`, split with `Intl.Segmenter(undefined, { granularity: "word" })`
  and keep the segments with `isWordLike`. In Node this splits 京都旅行 → 京都|旅行,
  京都と大阪 → 京都|と|大阪, ทริปเชียงใหม่ → ทริป|เชียงใหม่ and 私の京都旅行 → 私|の|京都|旅行.
  Note that ทริปเชียงใหม่ starts with "trip", so the leading-words rule still would not find it
  from เชียงใหม่. Stripping "my … trip" in Japanese or Thai is a separate question.
- **First noted:** 2026-10-13, M45, PR 429 review round 3.
