# F-F11 — `AccountMenuFromSession` has no production caller; two files' comments say it is what `AppHeader` renders

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/components/AccountMenu.tsx:325-331` ("Kept for callers that have no user to hand (its own tests today)"); render calls only in `AccountMenu.test.tsx:177,190,207,230`; `AppHeader.tsx:11-14` names it as "the one client island this renders" while `:1,36` import and render `HeaderSessionChrome`; `AppHeader.test.tsx:5,44` repeat the stale claim.
- **Suggested fix:** delete the export; test the behaviour through `HeaderSessionChrome`; fix the three comments. ~8 lines.
- **Scope of the fix:** 4 files. Check subset: `AccountMenu.test.tsx`, `AppHeader.test.tsx`.
