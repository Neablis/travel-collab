# F-F05 — Saved-day row parsing (the KI-71 read boundary) exists twice, with identical log strings

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/server/savedDays.ts:81-88,99-106` (`fromRow`) and `playbooks.ts:230-244` (`toDiscoverDay`): identical `SavedStop.array().safeParse` + `SavedDayVisibility.safeParse` + `console.error` + `return null`.
- **What is wrong:** a third parsed column, a changed log message, or F-C04's version wrapper has to land in both. (The three-file split `savedDays.ts` / `playbooks.ts` / `savedDayAdds.ts` is by concern and fine; this parse is the one real overlap.)
- **Suggested fix:** `parseSavedDayColumns(row): { stops, visibility } | null` exported from `savedDays.ts`, used by both — and the natural home for F-C04's `v`. ~28 → ~14 lines.
- **Scope of the fix:** 2 files. Check subset: `savedDays.int.test.ts:78-264`, `api/playbooks/route.int.test.ts:132-312`, `board/route.int.test.ts:136-239`.
- **Cross-reference:** KI-071 (resolved), F-C04.
